import { READ, WRITE } from './codes.ts';
import type { FloatRing, IntRing } from './kernel/ring.ts';
import type { RandomStream } from './kernel/rng.ts';
import type { EdgeParams } from './model/schema.ts';

/** The connections one instance of a caller may hold open over an edge. */
export interface Pool {
  inUse: number;
  /** Calls waiting for a connection, with the time each started waiting. */
  waiting: IntRing;
  since: FloatRing;
}

// States of an edge's circuit breaker.
export const CLOSED = 0;
export const OPEN = 1;
export const HALF_OPEN = 2;

/** The running form of one edge: the caller's policy, its state, and counters. */
export interface EdgeRuntime {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  /** Calls over this edge are a client's attempts. */
  readonly fromClient: boolean;
  readonly rng: RandomStream;
  params: EdgeParams;
  /** Whether reads, whether writes, and whether requests for files use the edge. */
  reads: boolean;
  writes: boolean;
  files: boolean;
  /** The route whose requests use the edge: its number, 0 for every route, -1 for one no client has. */
  route: number;
  async: boolean;

  // Injected faults.
  severed: boolean;
  extraLatencyMs: number;

  /** One pool per instance of the caller, created when first needed. */
  readonly pools: Pool[];

  // Circuit breaker: the outcomes of the most recent calls, and whether it is letting calls through.
  breakerState: number;
  breakerUntil: number;
  probing: boolean;
  recent: Uint8Array;
  recentAt: number;
  recentCount: number;
  recentFailures: number;
  /** How many times the breaker has opened. */
  opened: number;

  calls: number;
  ok: number;
  failed: number;
  /** Failures that were this edge's own timeout firing. */
  timeouts: number;
  retried: number;
  /** Attempts left unfinished because the caller's instance went away. */
  abandoned: number;
  /** Time callers have spent on calls over this edge, from making each to hearing its result. */
  waitMs: number;
  /** The part of that spent waiting for a free connection in the pool. */
  poolWaitMs: number;
  windowCalls: number;
  windowFailed: number;
  windowWaitMs: number;
  windowPoolWaitMs: number;
}

/** Whether a call of class `cls` that came in by `route` uses the edge. */
export function edgeCarries(edge: EdgeRuntime, cls: number, route: number): boolean {
  if (edge.route !== 0 && edge.route !== route) return false;
  return cls === READ ? edge.reads : cls === WRITE ? edge.writes : edge.files;
}

/**
 * Which of a node's outgoing edges a call leaves by, for a node that sends each call one way: the
 * edge that names the call most exactly. One for its route wins over one for every route, and
 * then one for its kind over one for everything, whichever was drawn first. -1 if none carries it.
 */
export function pickEdge(edges: EdgeRuntime[], out: number[], cls: number, route: number): number {
  const exact = cls === READ ? 'read' : cls === WRITE ? 'write' : 'file';
  let best = -1;
  let rank = 0;
  for (const edgeIndex of out) {
    const edge = edges[edgeIndex]!;
    if (!edgeCarries(edge, cls, route)) continue;
    const kinds = edge.params.appliesTo;
    const fits = (edge.route === 0 ? 0 : 4) + (kinds === exact ? 3 : kinds === 'data' ? 2 : 1);
    if (fits > rank) {
      rank = fits;
      best = edgeIndex;
    }
  }
  return best;
}
