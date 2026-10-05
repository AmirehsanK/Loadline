import type { BlameReport, Bottleneck, Gauge, Issue, WindowSample } from '@loadline/engine';
import { create } from 'zustand';
import type { LevelFrame, Totals } from './protocol.ts';

/** How many sampling windows the page keeps for charts. */
export const HISTORY = 240;

export const NO_TOTALS: Totals = { created: 0, ok: 0, failed: 0, attempts: 0, events: 0 };

export interface SimState {
  /**
   * `blocked` means the design has errors and cannot run. `finished` is a run of a level that has
   * reached the level's end.
   */
  status: 'blocked' | 'paused' | 'running' | 'finished' | 'failed';
  /** Why a run stopped, when `status` is `failed`. */
  failure: string | null;
  issues: Issue[];
  /** Simulated time, in milliseconds. */
  now: number;
  /** Speed asked for. */
  speed: number;
  /** Speed achieved; lower than `speed` when the simulation cannot keep up. */
  measuredSpeed: number;
  /** What the traffic control is set to. */
  multiplier: number;
  /** What every client's rate is multiplied by at this moment: the control, the workload, spikes. */
  traffic: number;
  totals: Totals;
  samples: WindowSample[];
  gauges: Gauge[];
  /** The failures clients have seen since the run started, most common first. */
  blame: BlameReport[];
  /** Where the time has been going over the last few seconds. */
  bottleneck: Bottleneck | null;
  /** What the design has cost to run so far, in dollars a month. */
  monthlyCost: number;
  /** How the run stands against its level, when it is a run of one. */
  level: LevelFrame | null;
  /** Position of each node and edge in the arrays of a sample. */
  nodeIndex: Record<string, number>;
  edgeIndex: Record<string, number>;
}

/** What a run that has not produced anything yet looks like. */
export const EMPTY_RUN = {
  now: 0,
  measuredSpeed: 0,
  traffic: 1,
  totals: NO_TOTALS,
  samples: [] as WindowSample[],
  gauges: [] as Gauge[],
  blame: [] as BlameReport[],
  bottleneck: null,
  failure: null,
  level: null,
  monthlyCost: 0,
} satisfies Partial<SimState>;

export const useSim = create<SimState>(() => ({
  ...EMPTY_RUN,
  status: 'paused',
  issues: [],
  speed: 1,
  multiplier: 1,
  nodeIndex: {},
  edgeIndex: {},
}));

/** The most recent sampling window, if the run has closed one. */
export const latestSample = (state: SimState): WindowSample | undefined => state.samples[state.samples.length - 1];
