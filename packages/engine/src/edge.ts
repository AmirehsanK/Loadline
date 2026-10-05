import { READ } from './codes.ts';
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
  /** Whether reads, and whether writes, use the edge. */
  reads: boolean;
  writes: boolean;
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

/** Whether a call of class `cls` uses the edge. */
export function edgeCarries(edge: EdgeRuntime, cls: number): boolean {
  return cls === READ ? edge.reads : edge.writes;
}
