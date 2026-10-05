import type { BlameReport, Bottleneck, Gauge, Issue, WindowSample } from '@loadline/engine';
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
  /** The failures clients have seen since the run started, most common first. */
  blame: BlameReport[];
  /** Where the time has been going over the last few seconds. */
  bottleneck: Bottleneck | null;
  /** What the design has cost to run so far, in dollars a month. */
  monthlyCost: number;
  /** Position of each node and edge in the arrays of a sample. */
  nodeIndex: Record<string, number>;
  edgeIndex: Record<string, number>;
}

/** What a run that has not produced anything yet looks like. */
export const EMPTY_RUN = {
  now: 0,
  measuredSpeed: 0,
  totals: NO_TOTALS,
  samples: [] as WindowSample[],
  gauges: [] as Gauge[],
  blame: [] as BlameReport[],
  bottleneck: null,
  failure: null,
} satisfies Partial<SimState>;

export const useSim = create<SimState>(() => ({
  ...EMPTY_RUN,
  status: 'paused',
  issues: [],
  speed: 1,
  multiplier: 1,
  monthlyCost: 0,
  nodeIndex: {},
  edgeIndex: {},
}));

/** The most recent sampling window, if the run has closed one. */
export const latestSample = (state: SimState): WindowSample | undefined => state.samples[state.samples.length - 1];
