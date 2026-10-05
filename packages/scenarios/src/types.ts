import type { Design, Issue, NodeType, Score, Workload } from '@loadline/engine';

/** One thing a design has to achieve. All are judged over the scored period of the run. */
export type Objective =
  /** The slowest 1% of successful requests take no longer than this. */
  | { kind: 'p99'; maxMs: number }
  /** No more than this share of requests fail. */
  | { kind: 'errors'; maxRate: number }
  /** The design costs no more than this, in dollars a month, averaged over the run. */
  | { kind: 'cost'; maxMonthly: number }
  /** The queues hold no more than this many messages between them when the run ends. */
  | { kind: 'backlog'; maxDepth: number }
  /** No more than this many messages were refused, discarded or given up on by the queues. */
  | { kind: 'lost'; max: number };

/** The words of a level, in English. Other languages are in the web app's catalogs, by level id. */
export interface ScenarioText {
  title: string;
  /** The situation in one line, for a list of levels. It does not give the answer away. */
  summary: string;
  /** What is happening and what is asked, in two or three sentences. */
  brief: string;
  /** Nudges, from gentle to nearly the answer. */
  hints: string[];
  /** Shown after a pass: what the level was about, and why the fix works. */
  debrief: string;
  /** What each rule in `rules` means, by the id it returns. */
  rules?: Record<string, string>;
}

/** A level: a system with a problem, the traffic that exposes it, and what counts as solving it. */
export interface Scenario {
  id: string;
  text: ScenarioText;
  /** What the player starts with. */
  starter: Design;
  /** One design that passes. It proves the level can be solved, and is what "show a solution" shows. */
  reference: Design;
  /** The kinds of part the player may add. */
  palette: NodeType[];
  workload: Workload;
  durationMs: number;
  /** Requests that finish before this are warm-up and are not scored. */
  warmupMs: number;
  seed: number;
  /** All must be met to pass. */
  objectives: Objective[];
  /** Met on top of the objectives, the first set earns a second star and the second a third. */
  bonus: [Objective[], Objective[]];
  /**
   * Settings the player may not change, by the id of a starter node or edge. A list of dotted paths
   * locks those settings; `'*'` locks all of them. Anything listed here cannot be removed either,
   * unless it is also in `removable`.
   */
  locked: Record<string, string[] | '*'>;
  /** Locked parts the player may take out altogether. While they are there, their locks hold. */
  removable?: string[];
  /** Settings every part of a kind must have when the player adds one, by dotted path. */
  added?: Partial<Record<NodeType, Record<string, unknown>>>;
  /** Rules about the structure that settings cannot express. Returns the ids of those broken. */
  rules?: (design: Design) => string[];
}

export interface ObjectiveResult {
  objective: Objective;
  /** What the run achieved, in the objective's own unit. */
  value: number;
  met: boolean;
}

/** How a design did on a level. */
export interface Outcome {
  passed: boolean;
  stars: 0 | 1 | 2 | 3;
  results: ObjectiveResult[];
  bonus: [ObjectiveResult[], ObjectiveResult[]];
  /** Locked settings that were changed and rules that were broken. A design with any cannot pass. */
  broken: string[];
  /** Errors that stopped the design from running at all. */
  issues: Issue[];
  score: Score;
  monthlyCost: number;
}
