import {
  BACKOFF,
  CACHE_DELETE,
  CACHE_SET,
  EV_SERVICE_DONE,
  EV_TIMER,
  FREE,
  IN_SERVICE,
  NODE_DOWN,
  OK,
  POOL_WAIT,
  QUEUE_FULL,
  QUEUED,
  READ,
  REFUSED,
  WAITING,
} from '../codes.ts';
import { instancePrice } from '../cost.ts';
import { makeSampler } from '../kernel/dist.ts';
import type { Dist, Sampler } from '../kernel/dist.ts';
import { IntRing } from '../kernel/ring.ts';
import { RandomStream } from '../kernel/rng.ts';
import type { DesignNode, NodeType, ServiceNode } from '../model/schema.ts';
import { edgeCarries } from '../edge.ts';
import type { Simulation } from '../sim.ts';
import { NodeRuntime } from './base.ts';
import { CacheRuntime } from './cache.ts';

const TIMER_SCALE = 0;
const TIMER_BOOTED = 1;
/** How often an autoscaled service looks at its load. */
const SCALE_PERIOD_MS = 5000;
/** An instance is surplus when load is below this share of the target. */
const SCALE_IN_BELOW = 0.6;

export interface Instance {
  readonly index: number;
  /** Calls holding one of this instance's slots. */
  active: number;
  /** Calls waiting for one. */
  waiting: IntRing;
  up: boolean;
  /** Finishing what it has, taking nothing new, then going away. */
  draining: boolean;
  /** Taken down by a fault, and not to be reused until it is brought back. */
  killed: boolean;
}

export interface Scaling {
  enabled: boolean;
  min: number;
  max: number;
  target: number;
  bootMs: number;
  cooldownMs: number;
}

/** Everything that decides how a pool of instances works through calls. */
export interface PoolConfig {
  instances: number;
  concurrency: number;
  queue: number;
  serviceTime: Dist;
  autoscale: Scaling;
}

export const NO_SCALING: Scaling = { enabled: false, min: 1, max: 1, target: 1, bootMs: 0, cooldownMs: 0 };

/** Several calls that missed the same item in a cache, with one of them fetching it for all. */
interface Flight {
  leader: number;
  waiters: number[];
  /** Generation of each waiter's slot, to recognise one that has since gone. */
  generations: number[];
}

/**
 * A pool of identical instances, each working on up to `concurrency` calls at once and holding up
 * to `queue` more.
 *
 * A call takes a slot, does the service's own work, then goes through the outgoing edges in order,
 * making one downstream call for each that carries its kind of request. It keeps its slot the
 * whole time (docs/SPEC.md §4.1, rule 2): a slow dependency therefore fills this service's slots,
 * and its own callers start to queue.
 *
 * An edge to a cache is read-through: a read looks the item up there first, and a hit skips the
 * next edge, which is the store the cache stands in front of. A miss reads the store and then puts
 * the item in the cache. A write removes the item from the cache.
 */
export class ServiceRuntime extends NodeRuntime {
  protected concurrency = 1;
  protected readonly instances: Instance[] = [];
  private queueLimit = 0;
  private serviceTime: Sampler;
  private readonly serviceRng: RandomStream;
  private scaling: Scaling = NO_SCALING;
  /** Instances that have been started and are not up yet. */
  private booting = 0;
  private scaleTimerSet = false;
  private scaledAt = 0;
  // Slot-time at the autoscaler's last look.
  private seenBusy = 0;
  private seenCapacity = 0;
  private readonly flights = new Map<number, Flight>();
  /** The calls that are fetching an item for others. */
  private readonly leading = new Set<number>();

  constructor(sim: Simulation, index: number, id: string, type: NodeType, config: PoolConfig) {
    super(sim, index, id, type);
    this.serviceRng = new RandomStream(sim.seed, `${id}/service`);
    this.serviceTime = makeSampler(config.serviceTime);
    this.applyConfig(config);
  }

  static fromNode(sim: Simulation, index: number, node: ServiceNode): ServiceRuntime {
    return new ServiceRuntime(sim, index, node.id, 'service', node.params);
  }

  override get instanceCount(): number {
    let up = 0;
    for (const instance of this.instances) if (instance.up) up++;
    return this.down ? 0 : up;
  }

  /** How many instances there have ever been; valid indices are below this. */
  get instanceSlots(): number {
    return this.instances.length;
  }

  /** Whether instance `index` is running. */
  isUp(index: number): boolean {
    return this.instances[index]?.up === true && !this.down;
  }

  /** Whether instance `index` is finishing its work before going away, and should get no more. */
  isDraining(index: number): boolean {
    return this.instances[index]?.draining === true;
  }

  /** How much instance `index` has on its hands: calls in its slots plus calls waiting. */
  loadOf(index: number): number {
    const instance = this.instances[index]!;
    return instance.active + instance.waiting.length;
  }

  override start(): void {
    this.armScaling();
  }

  arrive(call: number): void {
    const calls = this.sim.calls;
    if (!this.admit(call)) return;
    // Without a load balancer in front, every call lands on the first instance.
    let chosen = calls.inst[call]!;
    if (chosen < 0) {
      chosen = 0;
      calls.inst[call] = 0;
    }
    const instance = this.instances[chosen];
    if (!instance?.up) {
      this.reject(call, NODE_DOWN);
      return;
    }
    if (instance.active < this.concurrency) {
      this.begin(call, instance);
    } else if (instance.waiting.length < this.queueLimit) {
      this.touch();
      this.queued++;
      this.noteQueued();
      instance.waiting.push(call);
      calls.state[call] = QUEUED;
    } else {
      this.reject(call, QUEUE_FULL);
    }
  }

  override serviceDone(call: number): void {
    this.sim.calls.step[call] = 0;
    this.advance(call);
  }

  override childDone(call: number, result: number, origin: number, stuck: number): void {
    const sim = this.sim;
    const calls = sim.calls;
    const step = calls.step[call]!;
    const cls = calls.cls[call]!;
    const target = sim.nodes[sim.edges[this.out[step]!]!.to]!;

    if (target instanceof CacheRuntime) {
      if (result === OK && calls.reply[call] === 1) {
        // Found: skip the store behind the cache.
        calls.step[call] = this.storeAfter(step, cls) + 1;
        this.advance(call);
        return;
      }
      // Not found. A cache that failed is treated the same way: the store still has the answer.
      calls.step[call] = step + 1;
      if (target.singleFlight && this.canShare(step, cls) && this.joinFlight(call, step)) return;
      this.advance(call);
      return;
    }

    // If this was the store behind a cache that the read missed, others may be waiting on it too.
    const cacheStep = this.cacheBefore(step, cls);
    if (cacheStep >= 0) this.landFlight(call, cacheStep, result, origin, stuck);
    if (result !== OK) {
      this.complete(call, result, origin, stuck);
      return;
    }
    if (cacheStep >= 0) sim.detach(this.out[cacheStep]!, READ, calls.key[call]!, CACHE_SET, calls.orphan[call]!);
    calls.step[call] = step + 1;
    this.advance(call);
  }

  override timer(id: number): void {
    if (id === TIMER_BOOTED) {
      this.booting--;
      if (this.scaling.enabled && this.serving() < this.scaling.max) this.addInstance();
      return;
    }
    this.scaleTimerSet = false;
    if (!this.scaling.enabled) return;
    this.scale();
    this.armScaling();
  }

  reconfigure(node: DesignNode): void {
    if (node.type === 'service') this.applyConfig(node.params);
  }

  override kill(count: number | undefined): boolean {
    if (count === undefined) {
      this.setDown(true);
      this.instances.forEach((_instance, index) => {
        this.failInstance(index);
      });
      this.recount();
      return true;
    }
    // Take the highest-numbered instances that are up.
    let left = count;
    for (let index = this.instances.length - 1; index >= 0 && left > 0; index--) {
      const instance = this.instances[index]!;
      if (!instance.up) continue;
      this.failInstance(index);
      instance.up = false;
      instance.killed = true;
      left--;
    }
    this.recount();
    return true;
  }

  override revive(count: number | undefined): void {
    if (count === undefined) {
      this.setDown(false);
    } else {
      let left = count;
      for (const instance of this.instances) {
        if (left === 0) break;
        if (!instance.killed) continue;
        instance.killed = false;
        instance.up = true;
        instance.draining = false;
        left--;
      }
    }
    this.recount();
    for (const instance of this.instances) this.drain(instance);
  }

  /** Applies the settings shared by services and workers, at the start and when they change. */
  protected applyConfig(config: PoolConfig): void {
    this.touch();
    this.concurrency = config.concurrency;
    this.queueLimit = config.queue;
    this.serviceTime = makeSampler(config.serviceTime);
    this.scaling = config.autoscale;
    const wanted = this.scaling.enabled
      ? Math.min(Math.max(this.instances.length === 0 ? config.instances : this.serving(), this.scaling.min), this.scaling.max)
      : config.instances;
    this.resize(wanted);
    this.recount();
    this.armScaling();
    // More slots may let waiting calls start.
    for (const instance of this.instances) this.drain(instance);
  }

  /** Hook for subclasses: an instance has a free slot and nothing waiting for it. */
  protected idle(_instance: Instance): void {}

  /** Hook for subclasses: a call has ended here, with this result. */
  protected ended(_call: number, _result: number): void {}

  protected begin(call: number, instance: Instance): void {
    const sim = this.sim;
    this.touch();
    this.busy++;
    instance.active++;
    sim.calls.state[call] = IN_SERVICE;
    const work = this.serviceTime(this.serviceRng) * this.slowFactor;
    sim.queue.push(sim.now + work, EV_SERVICE_DONE, call, sim.calls.gen[call]!, 0);
  }

  /** Ends a call: frees its slot, counts it, and hands it back. */
  protected complete(call: number, result: number, origin: number, stuck: number): void {
    const sim = this.sim;
    const calls = sim.calls;
    const instance = this.instances[calls.inst[call]!]!;
    this.touch();
    this.busy--;
    instance.active--;
    if (calls.orphan[call] === 1) this.wasted++;
    if (result === OK) this.countOk(sim.now - calls.tArrive[call]!);
    else this.countFailure(result);
    // Normally a fetch for others is passed on when the store answers; this covers every other end.
    if (this.leading.has(call)) this.dropFlight(call, result === OK ? NODE_DOWN : result, origin, stuck);
    this.ended(call, result);
    sim.finish(call, result, origin, stuck);
    this.drain(instance);
  }

  /** Instances that are up and taking new calls. */
  protected serving(): number {
    let count = 0;
    for (const instance of this.instances) if (instance.up && !instance.draining) count++;
    return count;
  }

  /** Starts waiting calls while the instance has room, then lets a subclass find it more work. */
  private drain(instance: Instance): void {
    if (!instance.up || this.down) return;
    while (instance.active < this.concurrency && instance.waiting.length > 0) {
      this.touch();
      this.queued--;
      this.begin(instance.waiting.shift(), instance);
    }
    if (instance.draining) {
      if (instance.active === 0) {
        instance.up = false;
        this.recount();
      }
      return;
    }
    if (instance.active < this.concurrency) this.idle(instance);
  }

  /** Makes the next downstream call, or completes the call when there are none left. */
  private advance(call: number): void {
    const sim = this.sim;
    const calls = sim.calls;
    const cls = calls.cls[call]!;
    for (;;) {
      const step = calls.step[call]!;
      if (step >= this.out.length) {
        this.complete(call, OK, -1, 0);
        return;
      }
      const edgeIndex = this.out[step]!;
      const edge = sim.edges[edgeIndex]!;
      if (!edgeCarries(edge, cls)) {
        calls.step[call] = step + 1;
        continue;
      }
      const toCache = sim.nodes[edge.to]!.type === 'cache';
      if (toCache && cls !== READ) {
        // A write makes the cached copy stale, so it is removed. The write does not wait for that.
        sim.detach(edgeIndex, cls, calls.key[call]!, CACHE_DELETE, calls.orphan[call]!);
        calls.step[call] = step + 1;
        continue;
      }
      if (edge.async && !toCache) {
        sim.detach(edgeIndex, cls, calls.key[call]!, 0, calls.orphan[call]!);
        calls.step[call] = step + 1;
        continue;
      }
      calls.attempt[call] = 0;
      sim.issue(call, edgeIndex);
      return;
    }
  }

  /** The step of the store that a cache at `step` stands in front of: the next edge this call uses. */
  private storeAfter(step: number, cls: number): number {
    for (let next = step + 1; next < this.out.length; next++) {
      if (edgeCarries(this.sim.edges[this.out[next]!]!, cls)) return next;
    }
    return this.out.length;
  }

  /** If the edge at `step` is the store behind a cache this read went through, that cache's step. */
  private cacheBefore(step: number, cls: number): number {
    if (cls !== READ) return -1;
    for (let previous = step - 1; previous >= 0; previous--) {
      const edge = this.sim.edges[this.out[previous]!]!;
      if (!edgeCarries(edge, cls)) continue;
      return this.sim.nodes[edge.to]!.type === 'cache' ? previous : -1;
    }
    return -1;
  }

  /**
   * After a miss at the cache at `cacheStep`: if another call is already fetching the same item,
   * waits for that call and returns true. Otherwise this call becomes the one that fetches it.
   */
  private joinFlight(call: number, cacheStep: number): boolean {
    const calls = this.sim.calls;
    const id = cacheStep * 1_048_576 + calls.key[call]!;
    const flight = this.flights.get(id);
    if (!flight) {
      this.flights.set(id, { leader: call, waiters: [], generations: [] });
      this.leading.add(call);
      return false;
    }
    flight.waiters.push(call);
    flight.generations.push(calls.gen[call]!);
    calls.state[call] = WAITING;
    return true;
  }

  /** The call fetching an item for others has its answer: pass it on to those waiting for it. */
  private landFlight(leader: number, cacheStep: number, result: number, origin: number, stuck: number): void {
    const calls = this.sim.calls;
    const id = cacheStep * 1_048_576 + calls.key[leader]!;
    const flight = this.flights.get(id);
    if (flight?.leader !== leader) return;
    this.flights.delete(id);
    this.leading.delete(leader);
    const after = calls.step[leader]! + 1;
    flight.waiters.forEach((waiter, i) => {
      // Skip a waiter that was cut short in the meantime.
      if (calls.gen[waiter] !== flight.generations[i] || calls.state[waiter] !== WAITING) return;
      if (result === OK) {
        calls.step[waiter] = after;
        this.advance(waiter);
      } else {
        this.complete(waiter, result, origin, stuck);
      }
    });
  }

  /** Fails every call an instance has, because the instance is gone. */
  private failInstance(index: number): void {
    const sim = this.sim;
    const calls = sim.calls;
    const instance = this.instances[index]!;
    this.touch();
    for (let call = 0; call < calls.capacity; call++) {
      if (calls.node[call] !== this.index || calls.inst[call] !== index) continue;
      const state = calls.state[call]!;
      const holdsSlot =
        state === IN_SERVICE || state === WAITING || state === BACKOFF || state === POOL_WAIT || state === REFUSED;
      if (state === FREE || (state !== QUEUED && !holdsSlot)) continue;
      if (holdsSlot) {
        this.busy--;
        instance.active--;
      } else {
        this.queued--;
      }
      if (calls.orphan[call] === 1) this.wasted++;
      this.countFailure(NODE_DOWN);
      if (this.leading.has(call)) this.dropFlight(call, NODE_DOWN, this.index, 0);
      this.ended(call, NODE_DOWN);
      sim.abort(call, NODE_DOWN, this.index);
    }
    instance.waiting.clear();
  }

  /** A call that was fetching an item for others ended without the item: fail those waiting for it. */
  private dropFlight(leader: number, result: number, origin: number, stuck: number): void {
    const calls = this.sim.calls;
    this.leading.delete(leader);
    for (const [id, flight] of this.flights) {
      if (flight.leader !== leader) continue;
      this.flights.delete(id);
      flight.waiters.forEach((waiter, i) => {
        if (calls.gen[waiter] === flight.generations[i] && calls.state[waiter] === WAITING) {
          this.complete(waiter, result, origin < 0 ? this.index : origin, stuck);
        }
      });
      return;
    }
  }

  /** Whether a miss at the cache at `cacheStep` is followed by a store call that others could wait for. */
  private canShare(cacheStep: number, cls: number): boolean {
    const store = this.storeAfter(cacheStep, cls);
    if (store >= this.out.length) return false;
    const edge = this.sim.edges[this.out[store]!]!;
    return !edge.async && this.sim.nodes[edge.to]!.type !== 'cache';
  }

  private addInstance(): void {
    // Reuse the place of an instance that has gone away, so indices stay small.
    const spare = this.instances.find((instance) => !instance.up && !instance.killed && instance.active === 0);
    if (spare) {
      spare.up = true;
      spare.draining = false;
    } else {
      this.instances.push({
        index: this.instances.length,
        active: 0,
        waiting: new IntRing(),
        up: true,
        draining: false,
        killed: false,
      });
    }
    this.recount();
  }

  /** Brings the number of instances taking calls to `count`. */
  private resize(count: number): void {
    let serving = this.serving();
    while (serving < count) {
      this.addInstance();
      serving++;
    }
    for (let index = this.instances.length - 1; index >= 0 && serving > count; index--) {
      const instance = this.instances[index]!;
      if (!instance.up || instance.draining) continue;
      this.retire(instance);
      serving--;
    }
  }

  /** Stops an instance taking new calls; it goes once it has finished the ones it has. */
  private retire(instance: Instance): void {
    instance.draining = true;
    if (instance.active === 0 && instance.waiting.length === 0) instance.up = false;
  }

  /** Recomputes capacity from the instances that are up, and price from the ones being paid for. */
  private recount(): void {
    this.touch();
    let paidFor = 0;
    for (const instance of this.instances) if (instance.up || instance.killed) paidFor++;
    this.capacity = this.instanceCount * this.concurrency;
    this.setPrice(paidFor * instancePrice(this.concurrency));
  }

  private armScaling(): void {
    if (!this.scaling.enabled || this.scaleTimerSet) return;
    this.scaleTimerSet = true;
    this.sim.queue.push(this.sim.now + SCALE_PERIOD_MS, EV_TIMER, this.index, TIMER_SCALE, 0);
  }

  /**
   * One look by the autoscaler. It sizes the service for the slots that were busy over the period
   * just ended, so it is always reacting to what has already happened, and a new instance takes
   * `bootMs` to arrive. A service that is flat out cannot show more busy slots than it has, so
   * under a large surge it under-orders and has to look again.
   */
  private scale(): void {
    const { busy, capacity } = this.slotTime();
    const used = busy - this.seenBusy;
    const room = capacity - this.seenCapacity;
    this.seenBusy = busy;
    this.seenCapacity = capacity;
    if (room <= 0) return;

    const { min, max, target, bootMs, cooldownMs } = this.scaling;
    const serving = this.serving();
    const load = used / room;
    const planned = serving + this.booting;
    const busySlots = used / SCALE_PERIOD_MS;
    const wanted = Math.min(max, Math.max(min, Math.ceil(busySlots / (this.concurrency * target))));

    if (wanted > planned) {
      for (let i = planned; i < wanted; i++) {
        this.booting++;
        this.sim.queue.push(this.sim.now + bootMs, EV_TIMER, this.index, TIMER_BOOTED, 0);
      }
      this.scaledAt = this.sim.now;
    } else if (load < target * SCALE_IN_BELOW && serving > min && this.sim.now - this.scaledAt >= cooldownMs) {
      // One at a time, and only once things have been quiet for a while.
      const surplus = this.instances.findLast((instance) => instance.up && !instance.draining);
      if (surplus) this.retire(surplus);
      this.recount();
      this.scaledAt = this.sim.now;
    }
  }
}
