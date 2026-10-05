import { EV_SERVICE_DONE, EV_TIMER, FREE, IN_SERVICE, NODE_DOWN, OK, QUEUE_FULL, READ } from '../codes.ts';
import { databaseServerPrice } from '../cost.ts';
import { makeSampler } from '../kernel/dist.ts';
import type { Sampler } from '../kernel/dist.ts';
import { RandomStream } from '../kernel/rng.ts';
import type { DatabaseNode, DesignNode } from '../model/schema.ts';
import type { Simulation } from '../sim.ts';
import { NodeRuntime } from './base.ts';

const TIMER_FAILOVER = 0;

/**
 * How much throughput is lost to queries getting in each other's way once there are more of them
 * than cores: locks, context switches, a cache that no longer fits. With twice as many queries as
 * cores each takes 2.5 times as long instead of 2, so the server completes a fifth less work. The
 * loss stops growing at five times as many queries as cores, where the server does half the work
 * it could.
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
}

/**
 * A primary that takes every write, and optional replicas that share the reads.
 *
 * A server has no queue of its own: every query it accepts runs at once. Up to `concurrency`
 * queries run at full speed. Beyond that they share the same cores, so each slows down in
 * proportion, and a little more for getting in each other's way. That is why a connection pool
 * larger than the database can use makes everything slower rather than faster.
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
    const sim = this.sim;
    const calls = sim.calls;
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

    server.active++;
    this.recount();
    calls.inst[call] = chosen;
    calls.state[call] = IN_SERVICE;
    const base = calls.cls[call] === READ ? this.readTime(this.workRng) : this.writeTime(this.workRng);
    const work = base * this.slowdown(server.active) * this.slowFactor;
    sim.queue.push(sim.now + work, EV_SERVICE_DONE, call, calls.gen[call]!, 0);
  }

  override serviceDone(call: number): void {
    const sim = this.sim;
    const calls = sim.calls;
    this.servers[calls.inst[call]!]!.active--;
    this.recount();
    if (calls.orphan[call] === 1) this.wasted++;
    this.countOk(sim.now - calls.tArrive[call]!);
    sim.finish(call, OK, -1, 0);
  }

  override timer(id: number, arg: number): void {
    if (id !== TIMER_FAILOVER) return;
    const failed = this.servers[arg]!;
    if (failed.up || failed.gone || this.primary !== arg) return;
    // A replica takes over if there is one; otherwise the old primary has to come back.
    const successor = this.servers.findIndex((server, index) => index !== arg && server.up);
    if (successor >= 0) {
      failed.gone = true;
      this.primary = successor;
    } else {
      failed.up = true;
    }
    this.recount();
  }

  reconfigure(node: DesignNode): void {
    if (node.type !== 'database') return;
    const params = node.params;
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

  /** How many times longer a query takes with `active` of them running. */
  private slowdown(active: number): number {
    if (active <= this.cores) return 1;
    const over = Math.min((active - this.cores) / this.cores, WORST_OVERLOAD);
    return (active / this.cores) * (1 + CONTENTION * over);
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
    this.servers.push({ active: 0, up: true, gone: false, killed: false });
  }

  /** Fails every query a server is running, because the server is gone. */
  private failServer(index: number): void {
    const sim = this.sim;
    const calls = sim.calls;
    for (let call = 0; call < calls.capacity; call++) {
      const state = calls.state[call]!;
      if (state === FREE || state !== IN_SERVICE || calls.node[call] !== this.index || calls.inst[call] !== index) continue;
      if (calls.orphan[call] === 1) this.wasted++;
      this.countFailure(NODE_DOWN);
      sim.abort(call, NODE_DOWN, this.index);
    }
    this.servers[index]!.active = 0;
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
