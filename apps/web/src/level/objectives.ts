import type { Objective, ObjectiveResult, Outcome } from '@loadline/scenarios';
import type { Messages } from '../i18n/en.ts';
import { formatCount, formatDuration, formatShare } from '../metrics/format.ts';

// How an objective and a result against it are put into words.

/** What an objective asks for. */
export function describeObjective(objective: Objective, m: Messages): string {
  const text = m.level.objective;
  switch (objective.kind) {
    case 'p99':
      return objective.route === undefined ? text.p99(formatDuration(objective.maxMs)) : text.p99Of(objective.route, formatDuration(objective.maxMs));
    case 'errors':
      if (objective.route !== undefined) return text.errorsOf(objective.route, formatShare(objective.maxRate));
      return objective.maxRate === 0 ? text.noErrors : text.errors(formatShare(objective.maxRate));
    case 'cost':
      return text.cost(m.metrics.dollars(formatCount(objective.maxMonthly)));
    case 'backlog':
      return text.backlog(formatCount(objective.maxDepth));
    case 'lost':
      return objective.max === 0 ? text.noneLost : text.lost(formatCount(objective.max));
    case 'wait':
      return text.wait(formatDuration(objective.maxMs));
  }
}

/** What the run has achieved against an objective. */
export function describeValue(result: ObjectiveResult, m: Messages): string {
  const text = m.level.value;
  switch (result.objective.kind) {
    case 'p99':
      return text.p99(formatDuration(result.value));
    case 'errors':
      return text.errors(formatShare(result.value));
    case 'cost':
      return text.cost(m.metrics.dollars(formatCount(result.value)));
    case 'backlog':
      return text.backlog(formatCount(result.value));
    case 'lost':
      return text.lost(formatCount(result.value));
    case 'wait':
      return text.wait(formatDuration(result.value));
  }
}

/**
 * Whether a result says anything yet. Before the scored period has seen a request there is no
 * latency or failure rate to speak of, and before the run has started there is nothing at all.
 */
export function isMeasured(result: ObjectiveResult, outcome: Outcome, now: number): boolean {
  if (now <= 0) return false;
  const { objective } = result;
  if (objective.kind !== 'p99' && objective.kind !== 'errors') return true;
  // An objective about one route is measured once that route has had a request finish.
  const seen =
    objective.route === undefined ? outcome.score : (outcome.score.routes?.find((route) => route.name === objective.route) ?? { ok: 0, failed: 0 });
  return objective.kind === 'p99' ? seen.ok > 0 : seen.ok + seen.failed > 0;
}
