import { EV_TIMER, FREE, IN_SERVICE, NODE_DOWN, OK, QUEUE_FULL, READ } from '../codes.ts';
import { databaseServerPrice } from '../cost.ts';
import { makeSampler } from '../kernel/dist.ts';
import type { Sampler } from '../kernel/dist.ts';
import { RandomStream } from '../kernel/rng.ts';
import { TagHeap } from '../kernel/tagHeap.ts';
import type { DatabaseNode, DesignNode } from '../model/schema.ts';
import type { Simulation } from '../sim.ts';
import { NodeRuntime } from './base.ts';

const TIMER_FAILOVER = 0;
// Timer ids from here up mean "a query finishes on server (id - 1)".
const TIMER_FINISH = 1;

/**
 * How much throughput is lost to queries getting in each other's way once there are more of them
 * than cores: locks, context switches, a cache that no longer fits. With twice as many queries as
 * cores each runs at 40% of full speed instead of 50%, so the server completes a fifth less work.
 * The loss stops growing at five times as many queries as cores, where the server does half the
 * work it could.
 */
const CONTENTION = 0.25;
const WORST_OVERLOAD = 4;

interface Server {
  /** Queries running on it. */
  active: number;
  up: boolean;
  /** Removed for good: it was a failed primary that has been replaced, or a replica taken away. */
  gone: boolean;
  /** Taken down by a fault, and to be brought back by the matching `revive`. */
  killed: boolean;
  /**
   * How much work, in milliseconds at full speed, each running query has been given so far. Every
   * query gets the same share, so one number serves for all of them.
   */
  progress: number;
  /** When `progress` was last brought up to date. */
  progressAt: number;
  /** The running queries, each tagged with the `progress` at which it will be done. */
  running: TagHeap;
  /** Bumped whenever the next finish is rescheduled, so the event for the old one is ignored. */
  epoch: number;
}

/**
 * A primary that takes every write, and optional replicas that share the reads.
 *
 * A server has no queue of its own: every query it accepts runs at once, and they share its cores
 * equally. Up to `concurrency` queries each have a core and run at full speed. Beyond that each gets
 * a fraction of a core, and a little less still for getting in each other's way, so all of them
 * slow down together, including the ones that were already running. That is why a connection pool
 * larger than the database can use makes everything slower rather than faster.
 *
 * Sharing is tracked with one running total per server (`progress`) rather than by revisiting
 * every query whenever one starts or ends: a query that needs `w` milliseconds of work is done
 * when the total has moved on by `w` from where it started.
 */
export class DatabaseRuntime extends NodeRuntime {
  private cores: number;
  private maxConnections: number;
  private failoverMs: number;
  private readTime: Sampler;
  private writeTime: Sampler;
  private readonly workRng: RandomStream;
  private readonly servers: Server[] = [];
  private primary = 0;
  private nextReplica = 0;

  constructor(sim: Simulation, index: number, node: DatabaseNode) {
    super(sim, index, node.id, 'database');
    const params = node.params;
    this.cores = params.concurrency;
    this.maxConnections = params.maxConnections;
    this.failoverMs = params.failoverMs;
    this.readTime = makeSampler(params.readTime);
    this.writeTime = makeSampler(params.writeTime);
    this.workRng = new RandomStream(sim.seed, `${node.id}/work`);
    for (let i = 0; i <= params.replicas; i++) this.addServer();
    this.recount();
  }

  override get instanceCount(): number {
    let up = 0;
    for (const server of this.servers) if (server.up) up++;
    return this.down ? 0 : up;
  }

  arrive(call: number): void {
    const calls = this.sim.calls;
    if (!this.admit(call)) return;

    const chosen = calls.cls[call] === READ ? this.pickReader() : this.primary;
    const server = this.servers[chosen]!;
    if (!server.up) {
      this.reject(call, NODE_DOWN);
      return;
    }
    if (server.active >= this.maxConnections) {
      this.reject(call, QUEUE_FULL);
      return;
    }

    const work = (calls.cls[call] === READ ? this.readTime(this.workRng) : this.writeTime(this.workRng)) * this.slowFactor;
    this.catchUp(server);
    server.active++;
    server.running.push(server.progress + work, call);
    calls.inst[call] = chosen;
    calls.state[call] = IN_SERVICE;
    this.recount();
    this.scheduleFinish(server, chosen);
  }

  override timer(id: number, arg: number): void {
    if (id === TIMER_FAILOVER) {
      this.endFailover(arg);
      return;
    }
    const index = id - TIMER_FINISH;
    const server = this.servers[index]!;
    // The set of running queries has changed since this was scheduled, and so has the finish time.
    if (arg !== server.epoch || server.running.size === 0) return;

    const sim = this.sim;
    const calls = sim.calls;
    this.catchUp(server);
    const call = server.running.minItem();
    server.running.pop();
    server.active--;
    this.recount();
    if (calls.orphan[call] === 1) this.wasted++;
    this.countOk(sim.now - calls.tArrive[call]!);
    sim.finish(call, OK, -1, 0);
    this.scheduleFinish(server, index);
  }

  reconfigure(node: DesignNode): void {
    if (node.type !== 'database') return;
    const params = node.params;
    // The number of cores sets how fast queries progress, so settle the old rate first.
    for (const server of this.servers) this.catchUp(server);
    this.cores = params.concurrency;
    this.maxConnections = params.maxConnections;
    this.failoverMs = params.failoverMs;
    this.readTime = makeSampler(params.readTime);
    this.writeTime = makeSampler(params.writeTime);

    let replicas = this.servers.filter((server, index) => !server.gone && index !== this.primary).length;
    while (replicas < params.replicas) {
      this.addServer();
      replicas++;
    }
    for (let index = this.servers.length - 1; index >= 0 && replicas > params.replicas; index--) {
      const server = this.servers[index]!;
      if (server.gone || index === this.primary) continue;
      this.failServer(index);
      server.up = false;
      server.gone = true;
      replicas--;
    }
    this.recount();
    this.servers.forEach((server, index) => {
      this.scheduleFinish(server, index);
    });
  }

  /** Takes replicas down, or the whole database when `count` is undefined. */
  override kill(count: number | undefined): boolean {
    if (count === undefined) {
      this.setDown(true);
      this.servers.forEach((_server, index) => {
        this.failServer(index);
      });
      this.recount();
      return true;
    }
    let left = count;
    for (let index = this.servers.length - 1; index >= 0 && left > 0; index--) {
      const server = this.servers[index]!;
      if (!server.up || index === this.primary) continue;
      this.failServer(index);
      server.up = false;
      server.killed = true;
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
      for (const server of this.servers) {
        if (left === 0) break;
        if (!server.killed) continue;
        server.killed = false;
        server.up = true;
        left--;
      }
    }
    this.recount();
  }

  /** The primary fails. Writes are refused until a replica has taken over, or it has restarted. */
  override failover(): boolean {
    const server = this.servers[this.primary]!;
    if (!server.up) return false;
    this.failServer(this.primary);
    server.up = false;
    this.recount();
    this.sim.queue.push(this.sim.now + this.failoverMs, EV_TIMER, this.index, TIMER_FAILOVER, this.primary);
    return true;
  }

  override detail(): Record<string, number> {
    let replicas = 0;
    this.servers.forEach((server, index) => {
      if (server.up && index !== this.primary) replicas++;
    });
    return { replicas, primaryUp: this.servers[this.primary]!.up && !this.down ? 1 : 0 };
  }

  /** How many milliseconds one of `active` queries needs to do a millisecond of work. */
  private slowdown(active: number): number {
    if (active <= this.cores) return 1;
    const over = Math.min((active - this.cores) / this.cores, WORST_OVERLOAD);
    return (active / this.cores) * (1 + CONTENTION * over);
  }

  /** Credits the running queries with the work they have been given since the last look. */
  private catchUp(server: Server): void {
    const now = this.sim.now;
    if (server.active > 0) server.progress += (now - server.progressAt) / this.slowdown(server.active);
    server.progressAt = now;
  }

  /**
   * Schedules the moment the query closest to done will finish, at the pace the server is going
   * now. Anything that changes the pace calls this again, which makes the earlier event stale.
   */
  private scheduleFinish(server: Server, index: number): void {
    server.epoch = (server.epoch + 1) | 0;
    if (server.running.size === 0 || !server.up) return;
    const left = Math.max(server.running.minTag() - server.progress, 0);
    this.sim.queue.push(this.sim.now + left * this.slowdown(server.active), EV_TIMER, this.index, index + TIMER_FINISH, server.epoch);
  }

  private endFailover(index: number): void {
    const failed = this.servers[index]!;
    if (failed.up || failed.gone || this.primary !== index) return;
    // A replica takes over if there is one; otherwise the old primary has to come back.
    const successor = this.servers.findIndex((server, other) => other !== index && server.up);
    if (successor >= 0) {
      failed.gone = true;
      this.primary = successor;
    } else {
      failed.up = true;
    }
    this.recount();
  }

  /** The next replica that is up, in turn; the primary if there is none. */
  private pickReader(): number {
    const count = this.servers.length;
    for (let i = 0; i < count; i++) {
      const index = (this.nextReplica + i) % count;
      if (index === this.primary || !this.servers[index]!.up) continue;
      this.nextReplica = index + 1;
      return index;
    }
    return this.primary;
  }

  private addServer(): void {
    this.servers.push({
      active: 0,
      up: true,
      gone: false,
      killed: false,
      progress: 0,
      progressAt: this.sim.now,
      running: new TagHeap(),
      epoch: 0,
    });
  }

  /** Fails every query a server is running, because the server is gone. */
  private failServer(index: number): void {
    const sim = this.sim;
    const calls = sim.calls;
    const server = this.servers[index]!;
    for (let call = 0; call < calls.capacity; call++) {
      const state = calls.state[call]!;
      if (state === FREE || state !== IN_SERVICE || calls.node[call] !== this.index || calls.inst[call] !== index) continue;
      if (calls.orphan[call] === 1) this.wasted++;
      this.countFailure(NODE_DOWN);
      sim.abort(call, NODE_DOWN, this.index);
    }
    server.active = 0;
    server.running.clear();
    server.epoch = (server.epoch + 1) | 0;
  }

  /**
   * Recomputes what the node reports from its servers. Cores in use count as busy; queries beyond
   * the cores are the ones being slowed down, and are reported as queued.
   */
  private recount(): void {
    this.touch();
    let busy = 0;
    let over = 0;
    let up = 0;
    let paidFor = 0;
    for (const server of this.servers) {
      if (!server.gone) paidFor++;
      if (!server.up) continue;
      up++;
      busy += Math.min(server.active, this.cores);
      over += Math.max(0, server.active - this.cores);
    }
    this.busy = busy;
    this.queued = over;
    this.noteQueued();
    this.capacity = (this.down ? 0 : up) * this.cores;
    this.setPrice(paidFor * databaseServerPrice(this.cores));
  }
}
