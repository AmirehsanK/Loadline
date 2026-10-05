import type { Gauge, Issue, WindowSample } from '@loadline/engine';
import { create } from 'zustand';
import type { Totals } from './protocol.ts';

/** How many sampling windows the page keeps for charts. */
export const HISTORY = 240;

export const NO_TOTALS: Totals = { created: 0, ok: 0, failed: 0, attempts: 0, events: 0 };

export interface SimState {
  /** `blocked` means the design has errors and cannot run. */
  status: 'blocked' | 'paused' | 'running' | 'failed';
  /** Why a run stopped, when `status` is `failed`. */
  failure: string | null;
  issues: Issue[];
  /** Simulated time, in milliseconds. */
  now: number;
  /** Speed asked for. */
  speed: number;
  /** Speed achieved; lower than `speed` when the simulation cannot keep up. */
  measuredSpeed: number;
  multiplier: number;
  totals: Totals;
  samples: WindowSample[];
  gauges: Gauge[];
  /** Position of each node and edge in the arrays of a sample. */
  nodeIndex: Record<string, number>;
  edgeIndex: Record<string, number>;
}

export const useSim = create<SimState>(() => ({
  status: 'paused',
  failure: null,
  issues: [],
  now: 0,
  speed: 1,
  measuredSpeed: 0,
  multiplier: 1,
  totals: NO_TOTALS,
  samples: [],
  gauges: [],
  nodeIndex: {},
  edgeIndex: {},
}));

/** The most recent sampling window, if the run has closed one. */
export const latestSample = (state: SimState): WindowSample | undefined => state.samples[state.samples.length - 1];
