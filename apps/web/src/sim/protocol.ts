import type { BlameReport, Bottleneck, Command, Design, Gauge, WindowSample } from '@loadline/engine';
import type { Outcome } from '@loadline/scenarios';

/** Running totals since the start of the run. */
export interface Totals {
  created: number;
  ok: number;
  failed: number;
  attempts: number;
  events: number;
}

/** The speed that means "as fast as the simulation will go". */
export const FULL_SPEED = Infinity;

/** What the page sends to the worker. */
export type ToWorker =
  /**
   * Start a run of a design from time zero, paused. With `levelId` it is a run of that level: the
   * level's traffic and faults, its warm-up left out of the score, and an end.
   */
  | { type: 'load'; design: Design; seed: number; multiplier: number; levelId: string | null }
  /** New settings for the design that is running; its nodes and edges are the same. */
  | { type: 'reconfigure'; design: Design }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'speed'; value: number }
  | { type: 'multiplier'; value: number }
  /** Inject a fault. */
  | { type: 'command'; command: Command };

/** How a run of a level stands. */
export interface LevelFrame {
  /** Judged on what has happened so far; final once `finished`. */
  outcome: Outcome;
  /** The run has reached the end of the level. */
  finished: boolean;
}

/** The state of a run, posted about ten times a second while it plays. */
export interface Frame {
  /** Which `load` this frame belongs to; frames from an earlier one are stale. */
  run: number;
  /** Simulated time, in milliseconds. */
  now: number;
  /** Simulated time gained per unit of real time since the last frame. */
  measuredSpeed: number;
  playing: boolean;
  /** What every client's rate is multiplied by at this moment. */
  traffic: number;
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
  /** Present when the run is of a level. */
  level: LevelFrame | null;
}

/** What the worker sends to the page. */
export type FromWorker =
  | { type: 'frame'; frame: Frame }
  | { type: 'failed'; run: number; message: string };
