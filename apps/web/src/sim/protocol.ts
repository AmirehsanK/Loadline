import type { BlameReport, Bottleneck, Command, Design, Gauge, WindowSample } from '@loadline/engine';

/** Running totals since the start of the run. */
export interface Totals {
  created: number;
  ok: number;
  failed: number;
  attempts: number;
  events: number;
}

/** What the page sends to the worker. */
export type ToWorker =
  | { type: 'load'; design: Design; seed: number; multiplier: number }
  /** New settings for the design that is running; its nodes and edges are the same. */
  | { type: 'reconfigure'; design: Design }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'speed'; value: number }
  | { type: 'multiplier'; value: number }
  /** Inject a fault. */
  | { type: 'command'; command: Command };

/** The state of a run, posted about ten times a second while it plays. */
export interface Frame {
  /** Which `load` this frame belongs to; frames from an earlier one are stale. */
  run: number;
  /** Simulated time, in milliseconds. */
  now: number;
  /** Simulated time gained per unit of real time since the last frame. */
  measuredSpeed: number;
  playing: boolean;
  /** Sampling windows closed since the last frame. */
  samples: WindowSample[];
  /** One entry per node, in design order. */
  gauges: Gauge[];
  totals: Totals;
  /** The failures clients have seen since the run started, most common first. */
  blame: BlameReport[];
  /** Where the time has been going over the last few seconds. */
  bottleneck: Bottleneck | null;
  /** What the design has cost to run so far, in dollars a month. */
  monthlyCost: number;
}

/** What the worker sends to the page. */
export type FromWorker =
  | { type: 'frame'; frame: Frame }
  | { type: 'failed'; run: number; message: string };
