import { CALL_STATES, OUTCOMES, TIMEOUT } from './codes.ts';
import type { CallStateName, OutcomeName } from './codes.ts';
import type { NodeType } from './model/schema.ts';
import type { RouteScore, Simulation, WindowSample } from './sim.ts';

export type FailureName = Exclude<OutcomeName, 'ok'>;
export type FailureCounts = Record<FailureName, number>;

export interface NodeReport {
  id: string;
  type: NodeType;
  arrivals: number;
  ok: number;
  failed: number;
  failedBy: FailureCounts;
  /** Calls finished after a caller upstream had stopped waiting. */
  wasted: number;
  /** Time from arrival to completion, for calls that succeeded. For a queue: time a message waited. */
  meanMs: number;
  p50: number;
  p99: number;
  utilization: number;
  meanQueued: number;
  maxQueued: number;
  /** Instances up at the end of the run. */
  instances: number;
  /** Average cost over the run, in dollars a month. */
  monthlyCost: number;
  /** Numbers particular to the kind of node: a cache's hits and misses, a queue's deliveries. */
  detail: Record<string, number>;
}

export interface EdgeReport {
  id: string;
  calls: number;
  ok: number;
  failed: number;
  timeouts: number;
  retried: number;
  /** Attempts left unfinished because the caller's instance went away. */
  abandoned: number;
  /** How many times the edge's circuit breaker opened. */
  breakerOpened: number;
  /** Time callers spent on calls over the edge, and the part of it spent waiting for a connection. */
  waitMs: number;
  poolWaitMs: number;
}

/** A group of failed requests with the same cause, attributed to the same place. */
export interface BlameReport {
  cause: FailureName;
  nodeId: string;
  /** For a timeout: what the call holding things up was doing. */
  where: CallStateName | null;
  count: number;
}

/** What clients saw of one route over the whole run. */
export type RouteReport = RouteScore;

/** Everything a run produced. Two runs of the same design, workload and seed give equal reports. */
export interface Report {
  version: 1;
  seed: number;
  /** Simulated time covered, in milliseconds. */
  timeMs: number;
  events: number;
  requests: {
    created: number;
    ok: number;
    failed: number;
    inFlight: number;
    /** Attempts made by clients, retries included. */
    attempts: number;
    failedBy: FailureCounts;
  };
  /** Latency of the requests that succeeded, as clients saw it. */
  latency: { meanMs: number; p50: number; p90: number; p95: number; p99: number; p999: number; maxMs: number };
  rates: { offeredRps: number; goodputRps: number; errorRate: number; attemptsPerRequest: number };
  /** What the whole design cost to run, averaged over the run, in dollars a month. */
  monthlyCost: number;
  nodes: NodeReport[];
  edges: EdgeReport[];
  blame: BlameReport[];
  /** Present when the design names routes: a report of a design without any is what it always was. */
  routes?: RouteReport[];
  samples: WindowSample[];
}

function failureCounts(counts: Float64Array): FailureCounts {
  const result = {} as FailureCounts;
  for (let i = 1; i < OUTCOMES.length; i++) result[OUTCOMES[i] as FailureName] = counts[i]!;
  return result;
}

/** The failures clients have seen so far, most common first, with each node named by its id. */
export function describeBlame(sim: Simulation): BlameReport[] {
  return sim.blames().map((blame) => ({
    cause: OUTCOMES[blame.cause] as FailureName,
    nodeId: sim.nodes[blame.node]!.id,
    where: blame.cause === TIMEOUT ? CALL_STATES[blame.stuck]! : null,
    count: blame.count,
  }));
}

/** What the whole design has cost to run so far, in dollars a month. */
export function totalMonthlyCost(sim: Simulation): number {
  return sim.nodes.reduce((total, node) => total + node.monthlyCost(), 0);
}

export function buildReport(sim: Simulation): Report {
  const seconds = sim.now / 1000;
  const finished = sim.ok + sim.failed;
  const nodes = sim.nodes.map(
    (node): NodeReport => ({
      id: node.id,
      type: node.type,
      arrivals: node.arrivals,
      ok: node.ok,
      failed: node.failed,
      failedBy: failureCounts(node.failedBy),
      wasted: node.wasted,
      meanMs: node.latency.mean(),
      p50: node.latency.quantile(0.5),
      p99: node.latency.quantile(0.99),
      utilization: node.utilization(),
      meanQueued: node.meanQueued(),
      maxQueued: node.maxQueued,
      instances: node.instanceCount,
      monthlyCost: node.monthlyCost(),
      detail: node.detail(),
    }),
  );
  return {
    version: 1,
    seed: sim.seed,
    timeMs: sim.now,
    events: sim.events,
    requests: {
      created: sim.created,
      ok: sim.ok,
      failed: sim.failed,
      inFlight: sim.created - finished,
      attempts: sim.attempts,
      failedBy: failureCounts(sim.failedBy),
    },
    latency: {
      meanMs: sim.latency.mean(),
      p50: sim.latency.quantile(0.5),
      p90: sim.latency.quantile(0.9),
      p95: sim.latency.quantile(0.95),
      p99: sim.latency.quantile(0.99),
      p999: sim.latency.quantile(0.999),
      maxMs: sim.latency.max(),
    },
    rates: {
      offeredRps: seconds > 0 ? sim.created / seconds : 0,
      goodputRps: seconds > 0 ? sim.ok / seconds : 0,
      errorRate: finished > 0 ? sim.failed / finished : 0,
      attemptsPerRequest: sim.created > 0 ? sim.attempts / sim.created : 0,
    },
    monthlyCost: nodes.reduce((total, node) => total + node.monthlyCost, 0),
    nodes,
    edges: sim.edges.map((edge) => ({
      id: edge.id,
      calls: edge.calls,
      ok: edge.ok,
      failed: edge.failed,
      timeouts: edge.timeouts,
      retried: edge.retried,
      abandoned: edge.abandoned,
      breakerOpened: edge.opened,
      waitMs: edge.waitMs,
      poolWaitMs: edge.poolWaitMs,
    })),
    blame: describeBlame(sim),
    ...(sim.routeTotals().length > 0 ? { routes: sim.routeTotals() } : {}),
    samples: sim.samples.slice(),
  };
}

/**
 * A short fingerprint of a report (cyrb53 over its JSON). Equal reports hash equal on every JS
 * engine, which is what the determinism tests compare.
 */
export function hashReport(report: Report): string {
  const text = JSON.stringify(report);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}
