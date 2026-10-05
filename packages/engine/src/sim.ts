import {
  BACKOFF,
  CALL_STATES,
  CIRCUIT_OPEN,
  EV_ARRIVE,
  EV_COMMAND,
  EV_PHASE,
  EV_POOL_TIMEOUT,
  EV_REFUSE,
  EV_RESTORE,
  EV_RETRY,
  EV_RETURN,
  EV_SAMPLE,
  EV_SERVICE_DONE,
  EV_TIMEOUT,
  EV_TIMER,
  IN_SERVICE,
  NETWORK_DROP,
  NODE_DOWN,
  NO_ROUTE,
  OK,
  OUTCOMES,
  POOL_WAIT,
  REFUSED,
  RETURNING,
  TIMEOUT,
  TRAVELING,
  WAITING,
} from './codes.ts';
import { CallPool } from './kernel/calls.ts';
import { EventQueue } from './kernel/eventQueue.ts';
import { FloatRing, IntRing } from './kernel/ring.ts';
import { RandomStream } from './kernel/rng.ts';
import { Histogram } from './metrics/histogram.ts';
import { DesignError, hasErrors, lintDesign } from './model/lint.ts';
import type { Command, Design, EdgeParams, Workload } from './model/schema.ts';
import { CLOSED, HALF_OPEN, OPEN } from './edge.ts';
import type { EdgeRuntime, Pool } from './edge.ts';
import type { NodeRuntime, NodeWindow } from './nodes/base.ts';
import { CacheRuntime } from './nodes/cache.ts';
import { ClientRuntime } from './nodes/client.ts';
import { DatabaseRuntime } from './nodes/database.ts';
import { LoadBalancerRuntime } from './nodes/loadBalancer.ts';
import { QueueRuntime } from './nodes/queue.ts';
import { RateLimiterRuntime } from './nodes/rateLimiter.ts';
import { ServiceRuntime } from './nodes/service.ts';
import { WorkerRuntime } from './nodes/worker.ts';

export interface SimOptions {
  /** Same design, workload and seed give the same run. */
  seed: number;
  workload?: Workload;
  /** Length of one sampling window of simulated time. */
  sampleMs?: number;
  /** Sampling windows kept; older ones are dropped. */
  maxSamples?: number;
  /** Calls allowed in flight at once before the run is stopped. */
  maxLiveCalls?: number;
}

export interface EdgeWindow {
  calls: number;
  failed: number;
  /** Time callers spent on calls over the edge that ended in this window. */
  waitMs: number;
  /** The part of that spent waiting for a free connection in the pool. */
  poolWaitMs: number;
}

/** What one node is holding at an instant. */
export interface Gauge {
  /** Calls holding a slot. For a client: requests it is waiting on. */
  inFlight: number;
  /** Calls waiting for a slot. For a queue: messages waiting. */
  queued: number;
  /** Instances that are up. */
  instances: number;
}

/** What happened during one sampling window. */
export interface WindowSample {
  /** End of the window, in simulated milliseconds. */
  t: number;
  /** Requests clients started. */
  created: number;
  ok: number;
  failed: number;
  /** Attempts clients made, retries included. */
  attempts: number;
  /** Latency of the requests that succeeded in this window, as clients saw it. */
  meanMs: number;
  p50: number;
  p95: number;
  p99: number;
  /** One entry per node, in design order. */
  nodes: NodeWindow[];
  /** One entry per edge, in design order. */
  edges: EdgeWindow[];
}

/** A failure seen by a client, attributed to where it came from. */
export interface Blame {
  /** Index into `OUTCOMES`. */
  cause: number;
  /** Index of the node the failure is attributed to. */
  node: number;
  /** For a timeout: the state of the call that was holding things up. Otherwise 0. */
  stuck: number;
  count: number;
}

/**
 * A running simulation.
 *
 * Time only moves in `advance`. Everything else — arrivals, service, replies, timeouts, retries —
 * is an event in the queue, processed in time order.
 */
export class Simulation {
  readonly seed: number;
  readonly queue = new EventQueue();
  readonly calls: CallPool;
  readonly nodes: NodeRuntime[] = [];
  readonly edges: EdgeRuntime[] = [];
  readonly samples: WindowSample[] = [];

  /** Simulated time, in milliseconds. */
  now = 0;
  /** Events processed so far. */
  events = 0;
  /** What every client's rate is multiplied by right now. */
  multiplier = 1;

  created = 0;
  ok = 0;
  failed = 0;
  attempts = 0;
  readonly failedBy = new Float64Array(OUTCOMES.length);
  /** Latency of every request that succeeded, as clients saw it. */
  readonly latency = new Histogram();
  /** Commands that named a node or edge the design does not have, or that did not apply to it. */
  readonly ignored: Command[] = [];

  private readonly phases: Workload['phases'];
  private readonly chaos: Workload['chaos'];
  private readonly sampleMs: number;
  private readonly maxSamples: number;
  private readonly windowLatency = new Histogram();
  private windowCreated = 0;
  private windowOk = 0;
  private windowFailed = 0;
  private windowAttempts = 0;
  private handedOver = 0;
  private readonly blame = new Map<number, number>();
  private readonly nodeIndex = new Map<string, number>();
  private readonly edgeIndex = new Map<string, number>();

  // The traffic multiplier is the workload's own level times every spike in force.
  private baseMultiplier = 1;
  private readonly spikes = new Map<number, number>();
  // What to undo when a timed command runs out, by the number its EV_RESTORE event carries.
  private readonly restores = new Map<number, () => void>();
  private nextRestore = 0;

  constructor(design: Design, options: SimOptions) {
    const issues = lintDesign(design);
    if (hasErrors(issues)) throw new DesignError(issues.filter((issue) => issue.level === 'error'));

    this.seed = options.seed;
    this.sampleMs = options.sampleMs ?? 1000;
    this.maxSamples = options.maxSamples ?? 3600;
    this.calls = new CallPool(options.maxLiveCalls ?? 2_097_152);
    this.phases = [...(options.workload?.phases ?? [])].sort((a, b) => a.atMs - b.atMs);
    this.chaos = [...(options.workload?.chaos ?? [])].sort((a, b) => a.atMs - b.atMs);

    design.nodes.forEach((node, index) => {
      this.nodeIndex.set(node.id, index);
      this.nodes.push(this.build(node, index));
    });

    design.edges.forEach((edge, index) => {
      const from = this.nodeIndex.get(edge.from)!;
      this.edgeIndex.set(edge.id, index);
      const runtime: EdgeRuntime = {
        id: edge.id,
        from,
        to: this.nodeIndex.get(edge.to)!,
        fromClient: this.nodes[from]!.type === 'client',
        rng: new RandomStream(this.seed, `${edge.id}/policy`),
        params: edge.params,
        reads: true,
        writes: true,
        async: false,
        severed: false,
        extraLatencyMs: 0,
        pools: [],
        breakerState: CLOSED,
        breakerUntil: 0,
        probing: false,
        recent: new Uint8Array(0),
        recentAt: 0,
        recentCount: 0,
        recentFailures: 0,
        opened: 0,
        calls: 0,
        ok: 0,
        failed: 0,
        timeouts: 0,
        retried: 0,
        abandoned: 0,
        waitMs: 0,
        poolWaitMs: 0,
        windowCalls: 0,
        windowFailed: 0,
        windowWaitMs: 0,
        windowPoolWaitMs: 0,
      };
      this.configure(runtime, edge.params);
      this.edges.push(runtime);
      this.nodes[from]!.out.push(index);
    });

    this.phases.forEach((phase, index) => {
      // A phase at time zero is the starting rate, not a change of rate.
      if (phase.atMs <= 0) this.baseMultiplier = phase.multiplier;
      else this.queue.push(phase.atMs, EV_PHASE, index, 0, 0);
    });
    this.multiplier = this.baseMultiplier;
    this.chaos.forEach((entry, index) => {
      this.queue.push(entry.atMs, EV_COMMAND, index, 0, 0);
    });
    this.queue.push(this.sampleMs, EV_SAMPLE, 0, 0, 0);
    for (const node of this.nodes) node.start();
  }

  /**
   * Runs the simulation up to `untilMs`, or until `maxEvents` events have been processed. Returns
   * false when it stopped on the event limit, in which case `now` is short of `untilMs`.
   */
  advance(untilMs: number, maxEvents = Infinity): boolean {
    const queue = this.queue;
    const calls = this.calls;
    const nodes = this.nodes;
    let processed = 0;

    while (queue.peekTime() <= untilMs) {
      if (processed >= maxEvents) {
        this.events += processed;
        return false;
      }
      queue.pop();
      processed++;
      this.now = queue.poppedTime;
      const a = queue.poppedA;
      const b = queue.poppedB;
      const c = queue.poppedC;

      switch (queue.poppedKind) {
        case EV_ARRIVE:
          calls.tArrive[a] = this.now;
          nodes[calls.node[a]!]!.arrive(a);
          break;
        case EV_SERVICE_DONE:
          // The call may have been cut short since this was scheduled, when its instance went down.
          if (calls.gen[a] === b && calls.state[a] === IN_SERVICE) nodes[calls.node[a]!]!.serviceDone(a);
          break;
        case EV_RETURN:
          this.onReturn(a);
          break;
        case EV_TIMEOUT:
          this.onTimeout(a, b, c);
          break;
        case EV_RETRY:
          if (calls.gen[a] === b && calls.state[a] === BACKOFF) this.issue(a, c);
          break;
        case EV_REFUSE:
          if (calls.gen[a] === b && calls.state[a] === REFUSED) {
            const edgeIndex = c >> 3;
            this.settle(a, edgeIndex, c & 7, this.edges[edgeIndex]!.to, 0);
          }
          break;
        case EV_POOL_TIMEOUT:
          if (calls.gen[a] === b && calls.state[a] === POOL_WAIT) {
            // It gave up before a connection came free: the caller's own pool is where it was stuck.
            this.edges[c]!.timeouts++;
            this.notePoolWait(this.edges[c]!, this.now - calls.tAttempt[a]!);
            this.settle(a, c, TIMEOUT, calls.node[a]!, POOL_WAIT);
          }
          break;
        case EV_TIMER:
          nodes[a]!.timer(b, c);
          break;
        case EV_PHASE:
          this.setMultiplier(this.phases[a]!.multiplier);
          break;
        case EV_COMMAND:
          this.command(this.chaos[a]!.command);
          break;
        case EV_RESTORE: {
          const restore = this.restores.get(a);
          this.restores.delete(a);
          restore?.();
          break;
        }
        case EV_SAMPLE:
          this.closeWindow();
          break;
      }
    }

    this.events += processed;
    if (untilMs > this.now) this.now = untilMs;
    return true;
  }

  /** Sets the level of traffic, as a multiple of every client's rate. A later phase replaces it. */
  setMultiplier(value: number): void {
    this.baseMultiplier = value;
    this.applyMultiplier();
  }

  /** What each node is holding right now, in design order. */
  gauges(): Gauge[] {
    return this.nodes.map((node) => ({ inFlight: node.inFlight, queued: node.waiting, instances: node.instanceCount }));
  }

  /**
   * Does something to the running system. Returns false, and remembers the command in `ignored`,
   * when it names something the design does not have or does not apply to what it names.
   */
  command(command: Command): boolean {
    const applied = this.apply(command);
    if (!applied) this.ignored.push(command);
    return applied;
  }

  /**
   * Takes on a design with new parameters without restarting. The design must have the same
   * nodes and edges as the one the run started with; only their settings may differ.
   */
  reconfigure(design: Design): void {
    const same =
      design.nodes.length === this.nodes.length &&
      design.edges.length === this.edges.length &&
      design.nodes.every((node, i) => node.id === this.nodes[i]!.id && node.type === this.nodes[i]!.type) &&
      design.edges.every((edge, i) => {
        const runtime = this.edges[i]!;
        return (
          edge.id === runtime.id &&
          this.nodeIndex.get(edge.from) === runtime.from &&
          this.nodeIndex.get(edge.to) === runtime.to
        );
      });
    if (!same) throw new Error('reconfigure needs the same nodes and edges; start a new run for a new structure');
    const issues = lintDesign(design);
    if (hasErrors(issues)) throw new DesignError(issues.filter((issue) => issue.level === 'error'));

    design.nodes.forEach((node, i) => {
      this.nodes[i]!.reconfigure(node);
    });
    design.edges.forEach((edge, i) => {
      this.configure(this.edges[i]!, edge.params);
    });
  }

  /**
   * Makes a downstream call for `parent` over an edge, under the edge's policy. The parent's node
   * hears the result through `childDone` once the attempt, and any retries, are settled.
   */
  issue(parent: number, edgeIndex: number): void {
    const edge = this.edges[edgeIndex]!;
    const calls = this.calls;
    calls.tAttempt[parent] = this.now;
    calls.pending[parent] = edgeIndex;
    edge.calls++;
    edge.windowCalls++;
    if (edge.fromClient) {
      this.attempts++;
      this.windowAttempts++;
    }

    if (edge.severed) {
      // Nothing gets through; the caller finds out after the trip it would have taken.
      this.refuse(parent, edgeIndex, NETWORK_DROP, edge.params.latencyMs + edge.extraLatencyMs);
      return;
    }
    if (edge.params.breaker.enabled && !this.breakerAllows(edge)) {
      this.refuse(parent, edgeIndex, CIRCUIT_OPEN, 0);
      return;
    }
    if (edge.params.poolSize === 0) {
      this.send(parent, edgeIndex, -1);
      return;
    }

    const poolIndex = Math.max(calls.inst[parent]!, 0);
    const pool = this.poolOf(edge, poolIndex);
    if (pool.inUse < edge.params.poolSize) {
      pool.inUse++;
      this.send(parent, edgeIndex, poolIndex);
      return;
    }
    pool.waiting.push(parent);
    pool.since.push(this.now);
    calls.state[parent] = POOL_WAIT;
    calls.awaited[parent] = -1;
    if (edge.params.timeoutMs > 0) {
      this.queue.push(this.now + edge.params.timeoutMs, EV_POOL_TIMEOUT, parent, calls.gen[parent]!, edgeIndex);
    }
  }

  /**
   * Hands a call over an edge without waiting for the result: a message published, a cache entry
   * written. Nothing hears how it turns out.
   */
  detach(edgeIndex: number, cls: number, key: number, tag: number, orphan: number): void {
    const edge = this.edges[edgeIndex]!;
    const calls = this.calls;
    edge.calls++;
    edge.windowCalls++;
    if (edge.severed) {
      edge.failed++;
      edge.windowFailed++;
      return;
    }
    const call = calls.alloc();
    calls.node[call] = edge.to;
    calls.edge[call] = edgeIndex;
    calls.cls[call] = cls;
    calls.key[call] = key;
    calls.tag[call] = tag;
    calls.orphan[call] = orphan;
    calls.state[call] = TRAVELING;
    this.queue.push(this.now + edge.params.latencyMs + edge.extraLatencyMs, EV_ARRIVE, call, 0, 0);
  }

  /** Hands a finished call back to its caller. The reply takes the edge's latency to arrive. */
  finish(call: number, result: number, origin: number, stuck: number): void {
    const calls = this.calls;
    const edge = this.edges[calls.edge[call]!]!;
    if (calls.parent[call] === -1) {
      // Nobody is waiting: it was handed over, or it is a message a worker took from a queue.
      if (result === OK) edge.ok++;
      else {
        edge.failed++;
        edge.windowFailed++;
      }
      calls.release(call);
      return;
    }
    calls.result[call] = result;
    calls.origin[call] = origin;
    calls.stuck[call] = stuck;
    calls.state[call] = RETURNING;
    this.queue.push(this.now + edge.params.latencyMs + edge.extraLatencyMs, EV_RETURN, call, 0, 0);
  }

  /**
   * Fails a call that was part-way through its work, because the instance doing it has gone. Any
   * call it was waiting for carries on, for nobody.
   */
  abort(call: number, result: number, origin: number): void {
    const calls = this.calls;
    const child = calls.awaited[call]!;
    if (child >= 0) {
      calls.awaited[call] = -1;
      this.orphan(child);
    }
    // Whatever it had asked for downstream will never be heard about.
    const pending = calls.pending[call]!;
    if (pending >= 0) {
      this.edges[pending]!.abandoned++;
      calls.pending[call] = -1;
    }
    this.finish(call, result, origin, 0);
  }

  requestCreated(): void {
    this.created++;
    this.windowCreated++;
  }

  requestOk(latencyMs: number): void {
    this.ok++;
    this.windowOk++;
    this.latency.record(latencyMs);
    this.windowLatency.record(latencyMs);
  }

  requestFailed(result: number, origin: number, stuck: number): void {
    this.failed++;
    this.windowFailed++;
    this.failedBy[result]!++;
    const key = (origin * OUTCOMES.length + result) * CALL_STATES.length + stuck;
    this.blame.set(key, (this.blame.get(key) ?? 0) + 1);
  }

  /** The failures clients saw, grouped by cause and by the node each is attributed to. */
  blames(): Blame[] {
    const list: Blame[] = [];
    for (const [key, count] of this.blame) {
      const rest = Math.floor(key / CALL_STATES.length);
      list.push({
        cause: rest % OUTCOMES.length,
        node: Math.floor(rest / OUTCOMES.length),
        stuck: key % CALL_STATES.length,
        count,
      });
    }
    return list.sort((a, b) => b.count - a.count || a.node - b.node || a.cause - b.cause || a.stuck - b.stuck);
  }

  /** The sampling windows closed since the last call. */
  takeSamples(): WindowSample[] {
    const fresh = this.samples.slice(this.handedOver);
    this.handedOver = this.samples.length;
    return fresh;
  }

  private build(node: Design['nodes'][number], index: number): NodeRuntime {
    switch (node.type) {
      case 'client':
        return new ClientRuntime(this, index, node);
      case 'service':
        return ServiceRuntime.fromNode(this, index, node);
      case 'worker':
        return new WorkerRuntime(this, index, node);
      case 'load-balancer':
        return new LoadBalancerRuntime(this, index, node);
      case 'cache':
        return new CacheRuntime(this, index, node);
      case 'database':
        return new DatabaseRuntime(this, index, node);
      case 'queue':
        return new QueueRuntime(this, index, node);
      case 'rate-limiter':
        return new RateLimiterRuntime(this, index, node);
    }
  }

  /** Applies an edge's parameters, at the start and whenever they are changed. */
  private configure(edge: EdgeRuntime, params: EdgeParams): void {
    edge.params = params;
    edge.reads = params.appliesTo !== 'write';
    edge.writes = params.appliesTo !== 'read';
    edge.async = params.mode === 'async';
    if (edge.recent.length !== params.breaker.window) {
      edge.recent = new Uint8Array(params.breaker.window);
      edge.recentAt = 0;
      edge.recentCount = 0;
      edge.recentFailures = 0;
    }
    if (!params.breaker.enabled) {
      edge.breakerState = CLOSED;
      edge.probing = false;
    }
    // A larger pool can serve calls that were waiting for the smaller one.
    edge.pools.forEach((_pool, index) => {
      this.grant(edge, this.edgeIndex.get(edge.id)!, index);
    });
  }

  private poolOf(edge: EdgeRuntime, index: number): Pool {
    while (edge.pools.length <= index) {
      edge.pools.push({ inUse: 0, waiting: new IntRing(), since: new FloatRing() });
    }
    return edge.pools[index]!;
  }

  /** Gives free connections to the calls that have waited longest and still want one. */
  private grant(edge: EdgeRuntime, edgeIndex: number, poolIndex: number): void {
    const calls = this.calls;
    const pool = edge.pools[poolIndex]!;
    const unlimited = edge.params.poolSize === 0;
    while (pool.waiting.length > 0 && (unlimited || pool.inUse < edge.params.poolSize)) {
      const waiter = pool.waiting.shift();
      const since = pool.since.shift();
      // Skip a call that timed out or was cut short while it waited.
      if (calls.state[waiter] !== POOL_WAIT || calls.tAttempt[waiter] !== since) continue;
      this.notePoolWait(edge, this.now - since);
      pool.inUse++;
      this.send(waiter, edgeIndex, poolIndex);
    }
  }

  /** Puts a call on the wire. `poolIndex` is the pool it holds a connection from, or -1. */
  private send(parent: number, edgeIndex: number, poolIndex: number): void {
    const edge = this.edges[edgeIndex]!;
    const calls = this.calls;
    const instance = this.nodes[calls.node[parent]!]!.route(parent, edgeIndex);
    if (instance === NO_ROUTE) {
      if (poolIndex >= 0) edge.pools[poolIndex]!.inUse--;
      this.refuse(parent, edgeIndex, NODE_DOWN, 0);
      return;
    }

    const child = calls.alloc();
    calls.node[child] = edge.to;
    calls.parent[child] = parent;
    calls.edge[child] = edgeIndex;
    calls.inst[child] = instance;
    calls.from[child] = poolIndex;
    calls.cls[child] = calls.cls[parent]!;
    calls.key[child] = calls.key[parent]!;
    calls.orphan[child] = calls.orphan[parent]!;
    calls.state[child] = TRAVELING;
    calls.awaited[parent] = child;
    calls.state[parent] = WAITING;

    this.queue.push(this.now + edge.params.latencyMs + edge.extraLatencyMs, EV_ARRIVE, child, 0, 0);
    if (edge.params.timeoutMs > 0) {
      // Time spent waiting for a connection has already come out of the caller's patience.
      const left = edge.params.timeoutMs - (this.now - calls.tAttempt[parent]!);
      this.queue.push(this.now + Math.max(left, 0), EV_TIMEOUT, parent, child, calls.gen[child]!);
    }
  }

  /** Fails an attempt without making the call. The caller hears after `delayMs`. */
  private refuse(parent: number, edgeIndex: number, result: number, delayMs: number): void {
    const calls = this.calls;
    calls.state[parent] = REFUSED;
    calls.awaited[parent] = -1;
    this.queue.push(this.now + delayMs, EV_REFUSE, parent, calls.gen[parent]!, (edgeIndex << 3) | result);
  }

  private onReturn(call: number): void {
    const calls = this.calls;
    const parent = calls.parent[call]!;
    const edgeIndex = calls.edge[call]!;
    const result = calls.result[call]!;
    const origin = calls.origin[call]!;
    const stuck = calls.stuck[call]!;
    const reply = calls.reply[call]!;
    const poolIndex = calls.from[call]!;
    // The caller may have timed out and moved on; then nobody is waiting for this reply.
    const expected = calls.awaited[parent] === call;
    calls.release(call);

    // Its connection is free again either way. A call that timed out held on to it until now.
    if (poolIndex >= 0) {
      const edge = this.edges[edgeIndex]!;
      edge.pools[poolIndex]!.inUse--;
      this.grant(edge, edgeIndex, poolIndex);
    }
    if (!expected) return;
    calls.awaited[parent] = -1;
    calls.reply[parent] = reply;
    this.settle(parent, edgeIndex, result, origin, stuck);
  }

  private onTimeout(parent: number, child: number, childGen: number): void {
    const calls = this.calls;
    // Stale unless the parent is still waiting for this very call.
    if (calls.awaited[parent] !== child || calls.gen[child] !== childGen) return;
    calls.awaited[parent] = -1;

    // The child carries on (rule 3). Follow the chain of calls each waiting on the next: the last
    // one is where the time was going.
    const deepest = this.orphan(child);
    const edgeIndex = calls.edge[child]!;
    this.edges[edgeIndex]!.timeouts++;
    this.settle(parent, edgeIndex, TIMEOUT, calls.node[deepest]!, calls.state[deepest]!);
  }

  /**
   * Marks a call, and every call down the chain it is waiting on, as working for nobody. Returns
   * the last call of the chain.
   */
  private orphan(call: number): number {
    const calls = this.calls;
    let deepest = call;
    for (;;) {
      calls.orphan[deepest] = 1;
      const next = calls.awaited[deepest]!;
      if (next < 0) return deepest;
      deepest = next;
    }
  }

  /** Applies the edge's retry policy to a finished attempt, then tells the caller's node. */
  private settle(parent: number, edgeIndex: number, result: number, origin: number, stuck: number): void {
    const edge = this.edges[edgeIndex]!;
    const calls = this.calls;
    const node = this.nodes[calls.node[parent]!]!;
    const waited = this.now - calls.tAttempt[parent]!;
    calls.pending[parent] = -1;
    edge.waitMs += waited;
    edge.windowWaitMs += waited;
    // A refusal by the breaker itself says nothing new about the dependency.
    if (edge.params.breaker.enabled && result !== CIRCUIT_OPEN) this.breakerRecord(edge, result === OK);
    if (result === OK) {
      edge.ok++;
      node.childDone(parent, OK, -1, 0);
      return;
    }
    edge.failed++;
    edge.windowFailed++;

    const attempt = calls.attempt[parent]!;
    // Retrying into an open breaker would only be refused again.
    if (result === CIRCUIT_OPEN || attempt >= edge.params.retries) {
      node.childDone(parent, result, origin, stuck);
      return;
    }
    calls.attempt[parent] = attempt + 1;
    edge.retried++;
    let delay = edge.params.backoffMs;
    for (let i = 0; i < attempt; i++) delay *= edge.params.backoffFactor;
    if (edge.params.jitter > 0) delay *= 1 - edge.params.jitter * edge.rng.next();
    calls.state[parent] = BACKOFF;
    this.queue.push(this.now + delay, EV_RETRY, parent, calls.gen[parent]!, edgeIndex);
  }

  private notePoolWait(edge: EdgeRuntime, waited: number): void {
    edge.poolWaitMs += waited;
    edge.windowPoolWaitMs += waited;
  }

  /** Whether the breaker lets a call through now. */
  private breakerAllows(edge: EdgeRuntime): boolean {
    if (edge.breakerState === CLOSED) return true;
    if (edge.breakerState === OPEN) {
      if (this.now < edge.breakerUntil) return false;
      edge.breakerState = HALF_OPEN;
      edge.probing = false;
    }
    // Half open: one call goes through to test the dependency, and the rest still wait.
    if (edge.probing) return false;
    edge.probing = true;
    return true;
  }

  private breakerRecord(edge: EdgeRuntime, ok: boolean): void {
    const { breaker } = edge.params;
    if (edge.breakerState === OPEN) return;
    if (edge.breakerState === HALF_OPEN) {
      edge.probing = false;
      if (ok) {
        edge.breakerState = CLOSED;
        edge.recent.fill(0);
        edge.recentCount = 0;
        edge.recentFailures = 0;
      } else {
        this.breakerOpen(edge);
      }
      return;
    }
    // Closed: slide the window over the newest outcome.
    const failed = ok ? 0 : 1;
    if (edge.recentCount === breaker.window) edge.recentFailures -= edge.recent[edge.recentAt]!;
    else edge.recentCount++;
    edge.recent[edge.recentAt] = failed;
    edge.recentFailures += failed;
    edge.recentAt = (edge.recentAt + 1) % breaker.window;
    if (edge.recentCount === breaker.window && edge.recentFailures >= breaker.failureRate * breaker.window) {
      this.breakerOpen(edge);
    }
  }

  private breakerOpen(edge: EdgeRuntime): void {
    edge.breakerState = OPEN;
    edge.breakerUntil = this.now + edge.params.breaker.openMs;
    edge.opened++;
  }

  private applyMultiplier(): void {
    let multiplier = this.baseMultiplier;
    for (const spike of this.spikes.values()) multiplier *= spike;
    this.multiplier = multiplier;
    for (const node of this.nodes) node.rateChanged();
  }

  /** Runs `undo` after `durationMs`, if a duration was given. */
  private later(durationMs: number | undefined, undo: () => void): void {
    if (durationMs === undefined) return;
    const token = this.nextRestore++;
    this.restores.set(token, undo);
    this.queue.push(this.now + durationMs, EV_RESTORE, token, 0, 0);
  }

  private apply(command: Command): boolean {
    if (command.type === 'traffic') {
      const token = this.nextRestore++;
      this.spikes.set(token, command.multiplier);
      this.applyMultiplier();
      this.later(command.durationMs, () => {
        this.spikes.delete(token);
        this.applyMultiplier();
      });
      return true;
    }

    if (command.type === 'sever' || command.type === 'delay') {
      const index = this.edgeIndex.get(command.edgeId);
      if (index === undefined) return false;
      const edge = this.edges[index]!;
      if (command.type === 'sever') {
        edge.severed = true;
        this.later(command.durationMs, () => {
          edge.severed = false;
        });
      } else {
        edge.extraLatencyMs += command.addMs;
        this.later(command.durationMs, () => {
          edge.extraLatencyMs -= command.addMs;
        });
      }
      return true;
    }

    const index = this.nodeIndex.get(command.nodeId);
    if (index === undefined) return false;
    const node = this.nodes[index]!;
    switch (command.type) {
      case 'kill':
        if (!node.kill(command.count)) return false;
        this.later(command.durationMs, () => {
          node.revive(command.count);
        });
        return true;
      case 'slow':
        if (!node.setSlow(command.factor)) return false;
        this.later(command.durationMs, () => {
          node.setSlow(1);
        });
        return true;
      case 'errors':
        if (!node.setErrorRate(command.rate)) return false;
        this.later(command.durationMs, () => {
          node.setErrorRate(0);
        });
        return true;
      case 'flush':
        return node.flush();
      case 'failover':
        return node.failover();
    }
  }

  private closeWindow(): void {
    const latency = this.windowLatency;
    this.samples.push({
      t: this.now,
      created: this.windowCreated,
      ok: this.windowOk,
      failed: this.windowFailed,
      attempts: this.windowAttempts,
      meanMs: latency.mean(),
      p50: latency.quantile(0.5),
      p95: latency.quantile(0.95),
      p99: latency.quantile(0.99),
      nodes: this.nodes.map((node) => node.sample()),
      edges: this.edges.map((edge) => {
        const window = {
          calls: edge.windowCalls,
          failed: edge.windowFailed,
          waitMs: edge.windowWaitMs,
          poolWaitMs: edge.windowPoolWaitMs,
        };
        edge.windowCalls = 0;
        edge.windowFailed = 0;
        edge.windowWaitMs = 0;
        edge.windowPoolWaitMs = 0;
        return window;
      }),
    });
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
      if (this.handedOver > 0) this.handedOver--;
    }
    latency.reset();
    this.windowCreated = 0;
    this.windowOk = 0;
    this.windowFailed = 0;
    this.windowAttempts = 0;
    this.queue.push(this.now + this.sampleMs, EV_SAMPLE, 0, 0, 0);
  }
}

export function createSimulation(design: Design, options: SimOptions): Simulation {
  return new Simulation(design, options);
}
