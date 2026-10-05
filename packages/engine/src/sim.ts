import {
  BACKOFF,
  CALL_STATES,
  EV_ARRIVE,
  EV_PHASE,
  EV_RETRY,
  EV_RETURN,
  EV_SAMPLE,
  EV_SERVICE_DONE,
  EV_TIMEOUT,
  EV_TIMER,
  OK,
  OUTCOMES,
  RETURNING,
  TIMEOUT,
  TRAVELING,
  WAITING,
} from './codes.ts';
import { CallPool } from './kernel/calls.ts';
import { EventQueue } from './kernel/eventQueue.ts';
import { RandomStream } from './kernel/rng.ts';
import { Histogram } from './metrics/histogram.ts';
import { DesignError, hasErrors, lintDesign } from './model/lint.ts';
import type { Design, Workload } from './model/schema.ts';
import type { NodeRuntime, NodeWindow } from './nodes/base.ts';
import { ClientRuntime } from './nodes/client.ts';
import { ServiceRuntime } from './nodes/service.ts';

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

/** The running form of one edge: the caller's policy, plus counters. */
export interface EdgeRuntime {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  /** Calls over this edge are a client's attempts. */
  readonly fromClient: boolean;
  readonly latencyMs: number;
  readonly timeoutMs: number;
  readonly retries: number;
  readonly backoffMs: number;
  readonly backoffFactor: number;
  readonly jitter: number;
  readonly rng: RandomStream;
  calls: number;
  ok: number;
  failed: number;
  /** Failures that were this edge's own timeout firing. */
  timeouts: number;
  retried: number;
  windowCalls: number;
  windowFailed: number;
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
  /** The workload's current traffic multiplier. */
  multiplier = 1;

  created = 0;
  ok = 0;
  failed = 0;
  attempts = 0;
  readonly failedBy = new Float64Array(OUTCOMES.length);
  /** Latency of every request that succeeded, as clients saw it. */
  readonly latency = new Histogram();

  private readonly phases: Workload['phases'];
  private readonly sampleMs: number;
  private readonly maxSamples: number;
  private readonly windowLatency = new Histogram();
  private windowCreated = 0;
  private windowOk = 0;
  private windowFailed = 0;
  private windowAttempts = 0;
  private handedOver = 0;
  private readonly blame = new Map<number, number>();

  constructor(design: Design, options: SimOptions) {
    const issues = lintDesign(design);
    if (hasErrors(issues)) throw new DesignError(issues.filter((issue) => issue.level === 'error'));

    this.seed = options.seed;
    this.sampleMs = options.sampleMs ?? 1000;
    this.maxSamples = options.maxSamples ?? 3600;
    this.calls = new CallPool(options.maxLiveCalls ?? 2_097_152);
    this.phases = [...(options.workload?.phases ?? [])].sort((a, b) => a.atMs - b.atMs);

    const indexOf = new Map<string, number>();
    design.nodes.forEach((node, index) => {
      indexOf.set(node.id, index);
      switch (node.type) {
        case 'client':
          this.nodes.push(new ClientRuntime(this, index, node));
          break;
        case 'service':
          this.nodes.push(new ServiceRuntime(this, index, node));
          break;
      }
    });

    design.edges.forEach((edge, index) => {
      const from = indexOf.get(edge.from)!;
      this.edges.push({
        id: edge.id,
        from,
        to: indexOf.get(edge.to)!,
        fromClient: this.nodes[from]!.type === 'client',
        ...edge.params,
        rng: new RandomStream(this.seed, `${edge.id}/policy`),
        calls: 0,
        ok: 0,
        failed: 0,
        timeouts: 0,
        retried: 0,
        windowCalls: 0,
        windowFailed: 0,
      });
      this.nodes[from]!.out.push(index);
    });

    this.phases.forEach((phase, index) => {
      // A phase at time zero is the starting rate, not a change of rate.
      if (phase.atMs <= 0) this.multiplier = phase.multiplier;
      else this.queue.push(phase.atMs, EV_PHASE, index, 0, 0);
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

      switch (queue.poppedKind) {
        case EV_ARRIVE:
          calls.tArrive[a] = this.now;
          nodes[calls.node[a]!]!.arrive(a);
          break;
        case EV_SERVICE_DONE:
          if (calls.gen[a] === queue.poppedB) nodes[calls.node[a]!]!.serviceDone(a);
          break;
        case EV_RETURN:
          this.onReturn(a);
          break;
        case EV_TIMEOUT:
          this.onTimeout(a, queue.poppedB, queue.poppedC);
          break;
        case EV_RETRY:
          if (calls.gen[a] === queue.poppedB && calls.state[a] === BACKOFF) this.issue(a, queue.poppedC);
          break;
        case EV_TIMER:
          nodes[a]!.timer(queue.poppedB, queue.poppedC);
          break;
        case EV_PHASE:
          this.multiplier = this.phases[a]!.multiplier;
          for (const node of nodes) node.rateChanged();
          break;
        case EV_SAMPLE:
          this.closeWindow();
          break;
      }
    }

    this.events += processed;
    if (untilMs > this.now) this.now = untilMs;
    return true;
  }

  /**
   * Makes a downstream call for `parent` over an edge, under the edge's timeout. The parent's node
   * hears the result through `childDone` once the attempt, and any retries, are settled.
   */
  issue(parent: number, edgeIndex: number): void {
    const edge = this.edges[edgeIndex]!;
    const calls = this.calls;
    const child = calls.alloc();
    calls.node[child] = edge.to;
    calls.parent[child] = parent;
    calls.edge[child] = edgeIndex;
    calls.orphan[child] = calls.orphan[parent]!;
    calls.state[child] = TRAVELING;
    calls.awaited[parent] = child;
    calls.state[parent] = WAITING;

    edge.calls++;
    edge.windowCalls++;
    if (edge.fromClient) {
      this.attempts++;
      this.windowAttempts++;
    }

    this.queue.push(this.now + edge.latencyMs, EV_ARRIVE, child, 0, 0);
    if (edge.timeoutMs > 0) {
      this.queue.push(this.now + edge.timeoutMs, EV_TIMEOUT, parent, child, calls.gen[child]!);
    }
  }

  /** Hands a finished call back to its caller. The reply takes the edge's latency to arrive. */
  finish(call: number, result: number, origin: number, stuck: number): void {
    const calls = this.calls;
    calls.result[call] = result;
    calls.origin[call] = origin;
    calls.stuck[call] = stuck;
    calls.state[call] = RETURNING;
    this.queue.push(this.now + this.edges[calls.edge[call]!]!.latencyMs, EV_RETURN, call, 0, 0);
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

  private onReturn(call: number): void {
    const calls = this.calls;
    const parent = calls.parent[call]!;
    const edgeIndex = calls.edge[call]!;
    const result = calls.result[call]!;
    const origin = calls.origin[call]!;
    const stuck = calls.stuck[call]!;
    // The caller may have timed out and moved on; then nobody is waiting for this reply.
    const expected = calls.awaited[parent] === call;
    calls.release(call);
    if (!expected) return;
    calls.awaited[parent] = -1;
    this.settle(parent, edgeIndex, result, origin, stuck);
  }

  private onTimeout(parent: number, child: number, childGen: number): void {
    const calls = this.calls;
    // Stale unless the parent is still waiting for this very call.
    if (calls.awaited[parent] !== child || calls.gen[child] !== childGen) return;
    calls.awaited[parent] = -1;

    // The child carries on (rule 3). Follow the chain of calls each waiting on the next: the last
    // one is where the time was going. Everything on the chain is now working for nobody.
    let deepest = child;
    for (;;) {
      calls.orphan[deepest] = 1;
      const next = calls.awaited[deepest]!;
      if (next < 0) break;
      deepest = next;
    }

    const edgeIndex = calls.edge[child]!;
    this.edges[edgeIndex]!.timeouts++;
    this.settle(parent, edgeIndex, TIMEOUT, calls.node[deepest]!, calls.state[deepest]!);
  }

  /** Applies the edge's retry policy to a finished attempt, then tells the caller's node. */
  private settle(parent: number, edgeIndex: number, result: number, origin: number, stuck: number): void {
    const edge = this.edges[edgeIndex]!;
    const calls = this.calls;
    const node = this.nodes[calls.node[parent]!]!;
    if (result === OK) {
      edge.ok++;
      node.childDone(parent, OK, -1, 0);
      return;
    }
    edge.failed++;
    edge.windowFailed++;

    const attempt = calls.attempt[parent]!;
    if (attempt >= edge.retries) {
      node.childDone(parent, result, origin, stuck);
      return;
    }
    calls.attempt[parent] = attempt + 1;
    edge.retried++;
    let delay = edge.backoffMs;
    for (let i = 0; i < attempt; i++) delay *= edge.backoffFactor;
    if (edge.jitter > 0) delay *= 1 - edge.jitter * edge.rng.next();
    calls.state[parent] = BACKOFF;
    this.queue.push(this.now + delay, EV_RETRY, parent, calls.gen[parent]!, edgeIndex);
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
        const window = { calls: edge.windowCalls, failed: edge.windowFailed };
        edge.windowCalls = 0;
        edge.windowFailed = 0;
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
