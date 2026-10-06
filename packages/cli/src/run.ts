import { buildReport, createSimulation, findBottleneck, summarize } from '@loadline/engine';
import type { Bottleneck, Report } from '@loadline/engine';
import { evaluate, findLevel, startScenario } from '@loadline/scenarios';
import type { Outcome, Scenario } from '@loadline/scenarios';
import type { Document } from './document.ts';

/** The seed of a run that was not given one. The same as the web app's, so the numbers match. */
export const DEFAULT_SEED = 2026;
export const DEFAULT_DURATION_MS = 60_000;

/** How much one run may be asked for. A caller that serves others (the MCP server) sets these low. */
export interface Limits {
  /** The longest simulated time. */
  maxDurationMs: number;
  /** The most events processed before the run is cut short. */
  maxEvents: number;
  /** The most requests a second all the clients of a design may send between them, at any time. */
  maxRate: number;
}

/** For someone at their own terminal: an hour of simulated time, and patience. */
export const GENEROUS: Limits = { maxDurationMs: 3_600_000, maxEvents: 500_000_000, maxRate: Infinity };

export interface RunOptions {
  durationMs?: number;
  seed?: number;
  /** The id of a level to run the design against, in place of the one the document names. */
  level?: string;
  limits?: Limits;
}

export interface Run {
  report: Report;
  /** False when the run was cut short by the limit on events; the report then covers less time. */
  complete: boolean;
  /** Where the time went over the last seconds of the run. */
  bottleneck: Bottleneck | null;
  /** Present when the run was of a level. */
  level?: { scenario: Scenario; outcome: Outcome };
}

export class RunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunError';
  }
}

/** The most requests a second a design's clients send, at the busiest point of its traffic. */
export function peakRate(document: Document, scenario?: Scenario): number {
  const workload = scenario?.workload ?? document.workload;
  const peak = Math.max(1, ...(workload?.phases ?? []).map((phase) => phase.multiplier));
  const base = document.design.nodes.reduce((sum, node) => (node.type === 'client' ? sum + node.params.rps : sum), 0);
  return base * peak;
}

/**
 * Runs a design and reports on it. With a level (named in `options` or by the document) the run is
 * the level's: its traffic, faults, seed and length, and it is scored. Otherwise it runs for
 * `durationMs` with the traffic the document came with, if any.
 */
export function simulate(document: Document, options: RunOptions = {}): Run {
  const limits = options.limits ?? GENEROUS;
  const levelId = options.level ?? document.level;
  const scenario = levelId === undefined ? undefined : findLevel(levelId);
  if (levelId !== undefined && !scenario) throw new RunError(`There is no level "${levelId}".`);

  const durationMs = scenario?.durationMs ?? options.durationMs ?? DEFAULT_DURATION_MS;
  if (durationMs > limits.maxDurationMs) {
    throw new RunError(`The run is ${String(durationMs / 1000)} s long; the most allowed here is ${String(limits.maxDurationMs / 1000)} s.`);
  }
  const rate = peakRate(document, scenario);
  if (rate > limits.maxRate) {
    throw new RunError(`The design sends up to ${String(Math.round(rate))} requests a second; the most allowed here is ${String(limits.maxRate)}.`);
  }

  const seed = options.seed ?? (scenario ? scenario.seed : (document.seed ?? DEFAULT_SEED));
  const sim = scenario
    ? startScenario(scenario, document.design, seed)
    : createSimulation(document.design, { seed, ...(document.workload ? { workload: document.workload } : {}) });
  const complete = sim.advance(durationMs, limits.maxEvents);
  const recent = summarize(sim.samples.slice(-5));
  return {
    report: buildReport(sim),
    complete,
    bottleneck: recent ? findBottleneck(document.design, recent) : null,
    ...(scenario ? { level: { scenario, outcome: evaluate(scenario, document.design, sim) } } : {}),
  };
}
