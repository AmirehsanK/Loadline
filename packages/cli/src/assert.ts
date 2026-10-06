import type { Run } from './run.ts';

// Assertions for `loadline test`: a condition on what a run achieved, written the way it would be
// said. `p99<200ms`, `errors<=1%`, `cost<300`, `stars>=2`.

const METRICS = ['p50', 'p95', 'p99', 'mean', 'max', 'errors', 'cost', 'sent', 'ok', 'failed', 'stars'] as const;
export type Metric = (typeof METRICS)[number];
export type Operator = '<' | '<=' | '>' | '>=' | '=';

export interface Assertion {
  /** As it was written. */
  text: string;
  metric: Metric;
  operator: Operator;
  /** In the metric's own unit: milliseconds, a fraction, dollars, a count. */
  limit: number;
}

export interface Verdict {
  assertion: Assertion;
  /** What the run achieved, in the same unit as the limit. */
  value: number;
  holds: boolean;
}

export class AssertionSyntaxError extends Error {
  constructor(text: string, reason: string) {
    super(`Cannot read the assertion "${text}": ${reason}. Examples: p99<200ms, errors<=1%, cost<300, stars>=2.`);
    this.name = 'AssertionSyntaxError';
  }
}

const LATENCY = new Set<Metric>(['p50', 'p95', 'p99', 'mean', 'max']);

/** Reads one assertion. A latency is in ms unless it says s; a share of errors is a fraction unless it says %. */
export function parseAssertion(text: string): Assertion {
  const match = /^\s*([a-z0-9]+)\s*(<=|>=|<|>|==?)\s*(\$?)\s*([0-9]*\.?[0-9]+)\s*(ms|s|%|)\s*$/i.exec(text);
  if (!match) throw new AssertionSyntaxError(text, 'it should be a metric, a comparison and a number');
  const [, name, comparison, dollar, number, unit] = match as unknown as [string, string, string, string, string, string];
  const metric = name.toLowerCase() as Metric;
  if (!METRICS.includes(metric)) throw new AssertionSyntaxError(text, `"${name}" is not one of ${METRICS.join(', ')}`);

  let limit = Number(number);
  if (LATENCY.has(metric)) {
    if (unit === '%' || dollar !== '') throw new AssertionSyntaxError(text, `${metric} is a time, in ms or s`);
    if (unit === 's') limit *= 1000;
  } else if (metric === 'errors') {
    if (unit === 'ms' || unit === 's' || dollar !== '') throw new AssertionSyntaxError(text, 'errors is a share: 1% or 0.01');
    if (unit === '%') limit /= 100;
  } else if (metric === 'cost') {
    if (unit !== '') throw new AssertionSyntaxError(text, 'cost is in dollars a month, with no unit');
  } else if (unit !== '' || dollar !== '') {
    throw new AssertionSyntaxError(text, `${metric} is a count, with no unit`);
  }
  return { text: text.trim(), metric, operator: comparison === '==' ? '=' : (comparison as Operator), limit };
}

/** What a run achieved on a metric. A level's stars need the run to have been of a level. */
function measure(metric: Metric, run: Run): number {
  // A level is judged over its scored period; anything else over the whole run.
  const score = run.level?.outcome.score;
  const { report } = run;
  switch (metric) {
    case 'p50':
      return score ? score.p50 : report.latency.p50;
    case 'p95':
      return score ? score.p95 : report.latency.p95;
    case 'p99':
      return score ? score.p99 : report.latency.p99;
    case 'mean':
      return score ? score.meanMs : report.latency.meanMs;
    case 'max':
      return report.latency.maxMs;
    case 'errors': {
      const ok = score ? score.ok : report.requests.ok;
      const failed = score ? score.failed : report.requests.failed;
      // A run in which nothing finished has not shown that it works.
      return ok + failed > 0 ? failed / (ok + failed) : 1;
    }
    case 'cost':
      return report.monthlyCost;
    case 'sent':
      return report.requests.created;
    case 'ok':
      return report.requests.ok;
    case 'failed':
      return report.requests.failed;
    case 'stars':
      if (!run.level) throw new AssertionSyntaxError('stars', 'stars are earned on a level; give one with --level');
      return run.level.outcome.stars;
  }
}

const HOLDS: Record<Operator, (value: number, limit: number) => boolean> = {
  '<': (value, limit) => value < limit,
  '<=': (value, limit) => value <= limit,
  '>': (value, limit) => value > limit,
  '>=': (value, limit) => value >= limit,
  '=': (value, limit) => value === limit,
};

export function check(assertion: Assertion, run: Run): Verdict {
  const value = measure(assertion.metric, run);
  // A latency with no successful request to measure is not a latency under any limit.
  const measurable = !LATENCY.has(assertion.metric) || (run.level ? run.level.outcome.score.ok : run.report.requests.ok) > 0;
  return { assertion, value, holds: measurable && HOLDS[assertion.operator](value, assertion.limit) };
}

export const isLatency = (metric: Metric) => LATENCY.has(metric);
