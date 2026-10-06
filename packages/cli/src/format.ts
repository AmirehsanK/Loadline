import type { Bottleneck, Issue, Report } from '@loadline/engine';
import type { ObjectiveResult } from '@loadline/scenarios';
import { isLatency } from './assert.ts';
import type { Verdict } from './assert.ts';
import type { Document } from './document.ts';
import type { Run } from './run.ts';

// What the command line prints. Plain text in columns: it is read in a terminal, pasted into a
// pull request, and read by an agent, and all three want the same thing.

const trim = (value: number, digits: number) => String(Number(value.toFixed(digits)));

export function duration(ms: number): string {
  if (!Number.isFinite(ms)) return '–';
  if (ms < 10) return `${trim(ms, 1)} ms`;
  if (ms < 1000) return `${String(Math.round(ms))} ms`;
  return `${trim(ms / 1000, 2)} s`;
}

export const count = (value: number) => Math.round(value).toLocaleString('en-US');

export function share(fraction: number): string {
  const percent = fraction * 100;
  if (percent === 0) return '0%';
  if (percent < 0.005) return '<0.01%';
  return `${trim(percent, percent < 10 ? 2 : 1)}%`;
}

export const dollars = (value: number) => `$${count(value)}`;

/**
 * Rows as a table, each column as wide as its widest cell. The first `words` columns hold text
 * and line up on the left; the rest hold numbers and line up on the right.
 */
function table(rows: string[][], words = 1): string[] {
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)));
  return rows.map((row) =>
    row
      .map((cell, column) => (column < words ? cell.padEnd(widths[column]!) : cell.padStart(widths[column]!)))
      .join('  ')
      .trimEnd(),
  );
}

/** The kinds of part that have slots or cores to be busy; for the others the share means nothing. */
const HAS_SLOTS = new Set(['service', 'worker', 'database']);

export function describeIssues(issues: Issue[]): string[] {
  return issues.map((issue) => `${issue.level === 'error' ? 'error  ' : 'warning'}  ${issue.message}`);
}

function describeBottleneck(found: Bottleneck): string {
  const through = found.path.length > 1 ? ` (reached through ${found.path.slice(0, -1).join(', then ')})` : '';
  switch (found.kind) {
    case 'saturated':
      return `${found.nodeId} is full: every slot is busy and calls are waiting${through}.`;
    case 'contended':
      return `${found.nodeId} is running more queries than it has cores for, so all of them are slow${through}.`;
    case 'pool':
      return `${found.nodeId} is waiting for a free connection over ${found.edgeId ?? 'a pool'}, which is too small${through}.`;
    case 'down':
      return `${found.nodeId} is down${through}.`;
    case 'work':
      return `Most of the time is ${found.nodeId}'s own work; it has room to spare${through}.`;
  }
}

function describeObjective({ objective, value, met }: ObjectiveResult): string {
  const mark = met ? 'met   ' : 'missed';
  switch (objective.kind) {
    case 'p99':
      return `${mark}  p99 within ${duration(objective.maxMs)}: ${duration(value)}`;
    case 'errors':
      return `${mark}  no more than ${share(objective.maxRate)} failing: ${share(value)}`;
    case 'cost':
      return `${mark}  no more than ${dollars(objective.maxMonthly)} a month: ${dollars(value)}`;
    case 'backlog':
      return `${mark}  no more than ${count(objective.maxDepth)} messages left waiting: ${count(value)}`;
    case 'lost':
      return `${mark}  no more than ${count(objective.max)} messages lost: ${count(value)}`;
    case 'wait':
      return `${mark}  no message waiting more than ${duration(objective.maxMs)}: ${duration(value)}`;
  }
}

/** The report of a run, for reading. */
export function describeRun(document: Document, run: Run): string {
  const { report } = run;
  const { requests, latency } = report;
  const lines: string[] = [];
  const name = document.design.name === '' ? 'Design' : document.design.name;
  lines.push(
    `${name}: ${String(document.design.nodes.length)} parts, ${String(document.design.edges.length)} connections. ` +
      `Seed ${String(report.seed)}, ${trim(report.timeMs / 1000, 1)} s simulated, ${count(report.events)} events.`,
  );
  if (!run.complete) lines.push('The run was cut short by the limit on events; the figures cover the time shown.');
  lines.push('');
  lines.push(
    ...table([
      ['Requests', `${count(requests.created)} sent`, `${count(requests.ok)} ok`, `${count(requests.failed)} failed`, `${share(report.rates.errorRate)} failing`],
    ]),
  );
  if (requests.ok > 0) {
    lines.push(`Latency   p50 ${duration(latency.p50)}, p95 ${duration(latency.p95)}, p99 ${duration(latency.p99)}, max ${duration(latency.maxMs)}`);
  }
  lines.push(`Cost      ${dollars(report.monthlyCost)} a month`);
  lines.push('');
  lines.push(
    ...table(
      [
        ['Part', 'Kind', 'Busy', 'Arrived', 'Failed', 'p99', 'Most waiting'],
        ...report.nodes.map((node) => [
          node.id,
          node.type,
          HAS_SLOTS.has(node.type) ? share(node.utilization) : '–',
          count(node.arrivals),
          count(node.failed),
          node.ok > 0 ? duration(node.p99) : '–',
          count(node.maxQueued),
        ]),
      ],
      2,
    ),
  );
  lines.push('');
  lines.push(`Where the time goes: ${run.bottleneck ? describeBottleneck(run.bottleneck) : 'nothing is flowing.'}`);
  if (report.blame.length > 0) {
    lines.push('Why requests failed:');
    const groups = report.blame
      .slice(0, 6)
      .map((group) => [count(group.count), `${group.cause} at ${group.nodeId}${group.where ? ` (${group.where})` : ''}`]);
    lines.push(...table(groups, 0).map((line) => `  ${line}`));
  }

  if (run.level) {
    const { scenario, outcome } = run.level;
    lines.push('');
    lines.push(`Level "${scenario.text.title}": ${outcome.passed ? `passed, ${String(outcome.stars)} of 3 stars` : 'not passed'}.`);
    lines.push(...outcome.results.map((result) => `  ${describeObjective(result)}`));
    outcome.bonus.forEach((tier, index) => {
      lines.push(...tier.map((result) => `  ${describeObjective(result)}  (for star ${String(index + 2)})`));
    });
    for (const rule of outcome.broken) lines.push(`  broken  ${scenario.text.rules?.[rule] ?? `a setting this level has fixed was changed (${rule})`}`);
  }
  return lines.join('\n');
}

export function describeVerdicts(verdicts: Verdict[]): string {
  const rows = verdicts.map(({ assertion, value, holds }) => {
    const got = isLatency(assertion.metric)
      ? duration(value)
      : assertion.metric === 'errors'
        ? share(value)
        : assertion.metric === 'cost'
          ? dollars(value)
          : count(value);
    return [holds ? 'pass' : 'FAIL', assertion.text, `got ${got}`];
  });
  return table(rows, 3).join('\n');
}

/** A compact form of a report for an agent: the figures that decide things, without the samples. */
export function summarizeReport(report: Report): Omit<Report, 'samples' | 'edges'> {
  const summary: Partial<Report> = { ...report };
  delete summary.samples;
  delete summary.edges;
  return summary as Omit<Report, 'samples' | 'edges'>;
}
