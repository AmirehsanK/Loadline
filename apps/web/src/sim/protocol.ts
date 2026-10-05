import type { Design, Gauge, WindowSample } from '@loadline/engine';

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
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'speed'; value: number }
  | { type: 'multiplier'; value: number };

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
}

/** What the worker sends to the page. */
export type FromWorker =
  | { type: 'frame'; frame: Frame }
  | { type: 'failed'; run: number; message: string };
