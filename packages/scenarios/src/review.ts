import type { Bottleneck, Design, DesignEdge, DesignNode, Report, Workload } from '@loadline/engine';
import type { Objective, ObjectiveResult, Outcome, Scenario } from './types.ts';

// What is put in front of a language model that is asked to review a run: the design, what was
// asked of it, and what the run measured. One builder, used by the web app, the command line and
// anything else, so that every reviewer is given the same facts.
//
// Everything in it is a measurement or a setting. The model is told that, and told not to add to
// it: a review that invents a number is worse than no review.

export interface ReviewInput {
  design: Design;
  report: Report;
  /** Where the time went over the last seconds of the run. */
  bottleneck?: Bottleneck | null;
  /** The level the run was of, and how it did. */
  level?: { scenario: Scenario; outcome: Outcome };
  /** Traffic and faults the run followed, when it was not a level's. */
  workload?: Workload;
  /** The language to reply in. */
  language: 'en' | 'fa';
}

export interface ReviewPrompt {
  /** Who the reviewer is and how to review. The same for every run in a language. */
  system: string;
  /** This run. */
  user: string;
}

const trim = (value: number, digits: number) => String(Number(value.toFixed(digits)));
const count = (value: number) => Math.round(value).toLocaleString('en-US');
const dollars = (value: number) => `$${count(value)}`;

function duration(ms: number): string {
  if (!Number.isFinite(ms)) return 'n/a';
  if (ms < 10) return `${trim(ms, 1)} ms`;
  if (ms < 1000) return `${String(Math.round(ms))} ms`;
  return `${trim(ms / 1000, 2)} s`;
}

function share(fraction: number): string {
  const percent = fraction * 100;
  if (percent === 0) return '0%';
  if (percent < 0.005) return '<0.01%';
  return `${trim(percent, percent < 10 ? 2 : 1)}%`;
}

const REPLY_IN = {
  en: 'Reply in English.',
  fa: 'Reply in Persian (Farsi). Keep the names of parts and settings in English, as they appear in the design.',
};

function system(language: ReviewInput['language']): string {
  return [
    'You are reviewing a system design for someone who is learning how systems behave under load. They drew it in Loadline, ' +
      'a simulator that runs traffic through a design one request at a time, and have just run it. You are given the design, ' +
      'what was asked of it, and what the run measured.',
    '',
    'How the simulator works, so that you can read the numbers:',
    '- Clients send at a fixed rate whatever happens to their requests, so a system that falls behind stays behind.',
    '- A synchronous call holds a slot of its caller until it returns or times out. A timeout does not cancel the work downstream, which is still done, for nobody.',
    '- A service instance runs `concurrency` calls at once and holds `queue` more; beyond that it rejects. Without a load balancer in front, every call lands on the first instance.',
    '- A database runs `concurrency` queries at full speed. More than that share its cores and all of them slow down. `poolSize` on the connection into it limits how many a caller sends at once.',
    '- A cache holds real items. A hit skips the store behind it. A queue answers the publisher at once and a worker takes messages at its own pace.',
    '- A request is a read, a write, or a request for a file. A CDN answers for the files it holds and fetches the rest; it passes reads and writes on untouched. An object store takes the same time for any number of files at once.',
    '- A function runs each call in an environment of its own, up to `maxConcurrency`, and refuses the rest. A call that finds no environment ready waits `coldStartMs` for one. It is charged for the time its calls take, waiting included.',
    '- Latency percentiles are of the requests that succeeded. Costs are made-up dollars a month.',
    '',
    'Write a review they can act on:',
    '- Start with the one thing that mattered most in this run, and the numbers that show it.',
    '- Then say what to change: which part or connection, which setting, and roughly to what. Prefer the smallest change that removes the cause, and say in a sentence why it works, so that they learn the principle and not only the fix.',
    '- If the run met what was asked, say so, and say what the design is paying for that it does not need or where it would give way first.',
    '- Use only what is measured below. If the numbers do not show something, say that it is not shown.',
    '- If the run was of a level, its fixed settings are listed; do not suggest changing them.',
    '',
    `Keep it short: a few paragraphs or a short list, in plain Markdown, with no tables and no HTML. ${REPLY_IN[language]}`,
  ].join('\n');
}

function work(dist: { kind: string; mean: number; cv?: number | undefined }): string {
  const spread = dist.kind === 'const' ? 'every time' : dist.kind === 'exp' ? 'on average, varying a lot' : `on average, spread ${String(dist.cv ?? 1)}`;
  return `${duration(dist.mean)} ${spread}`;
}

/** The settings of a part that decide how it behaves, in a line. */
function describeNode(node: DesignNode): string {
  const name = node.name === '' ? node.id : `${node.id} ("${node.name}")`;
  switch (node.type) {
    case 'client': {
      const { rps, fileRatio, readRatio, keys, skew } = node.params;
      const files = fileRatio > 0 ? `${share(fileRatio)} of them for files and of the rest ` : '';
      return `${name}: client sending ${count(rps)} requests a second, ${files}${share(readRatio)} ${fileRatio > 0 ? '' : 'of them '}reads, over ${count(keys)} items (skew ${String(skew)})`;
    }
    case 'service':
    case 'worker': {
      const { instances, concurrency, serviceTime } = node.params;
      const extra =
        node.type === 'service'
          ? `, queue ${count(node.params.queue)} per instance${
              node.params.autoscale.enabled
                ? `, scaling by itself between ${String(node.params.autoscale.min)} and ${String(node.params.autoscale.max)} instances to keep ${share(node.params.autoscale.target)} of slots busy (an instance takes ${duration(node.params.autoscale.bootMs)} to start)`
                : ''
            }`
          : '';
      return `${name}: ${node.type}, ${String(instances)} instance(s) of ${String(concurrency)} slots, work ${work(serviceTime)}${extra}`;
    }
    case 'load-balancer':
      return `${name}: load balancer, ${node.params.algorithm}, health check every ${duration(node.params.healthCheckMs)}`;
    case 'rate-limiter':
      return `${name}: rate limiter, ${count(node.params.rate)} a second, burst ${count(node.params.burst)}`;
    case 'cache': {
      const { capacity, ttlMs, singleFlight } = node.params;
      return `${name}: cache of ${count(capacity)} items, ${ttlMs === 0 ? 'kept until pushed out' : `kept for ${duration(ttlMs)}`}, single flight ${singleFlight ? 'on' : 'off'}`;
    }
    case 'database': {
      const { concurrency, replicas, readTime, writeTime } = node.params;
      return `${name}: database, ${String(concurrency)} cores, ${String(replicas)} replica(s), a read ${work(readTime)}, a write ${work(writeTime)}`;
    }
    case 'queue':
      return `${name}: queue holding up to ${count(node.params.maxDepth)} messages`;
    case 'cdn': {
      const { capacity, ttlMs } = node.params;
      return `${name}: CDN holding up to ${count(capacity)} files, ${ttlMs === 0 ? 'kept until pushed out' : `kept for ${duration(ttlMs)}`}`;
    }
    case 'object-store':
      return `${name}: object store, a file handed over in ${work(node.params.readTime)}, taken in in ${work(node.params.writeTime)}`;
    case 'function': {
      const { maxConcurrency, serviceTime, coldStartMs, keepWarmMs, provisioned } = node.params;
      return `${name}: function, up to ${count(maxConcurrency)} calls at once, work ${work(serviceTime)}, ${duration(coldStartMs)} to start an environment, kept for ${duration(keepWarmMs)} after a call, ${String(provisioned)} kept ready`;
    }
  }
}

/** A connection and the caller's policy on it, leaving out what is at its usual value. */
function describeEdge(edge: DesignEdge): string {
  const { timeoutMs, retries, backoffMs, jitter, poolSize, breaker, appliesTo, mode } = edge.params;
  const policy = [
    timeoutMs === 0 ? 'no timeout' : `timeout ${duration(timeoutMs)}`,
    ...(retries > 0 ? [`${String(retries)} retries${backoffMs > 0 ? ` after ${duration(backoffMs)}${jitter > 0 ? ' with jitter' : ''}` : ' at once'}`] : []),
    ...(poolSize > 0 ? [`pool of ${String(poolSize)} connections per caller instance`] : []),
    ...(breaker.enabled ? [`circuit breaker (opens at ${share(breaker.failureRate)} failing, for ${duration(breaker.openMs)})`] : []),
    ...(appliesTo === 'all' ? [] : [appliesTo === 'data' ? 'everything but files' : `${appliesTo}s only`]),
    ...(mode === 'async' ? ['not waited for'] : []),
  ];
  return `${edge.from} -> ${edge.to}: ${policy.join(', ')}`;
}

function describeObjective(objective: Objective): string {
  switch (objective.kind) {
    case 'p99':
      return `p99 within ${duration(objective.maxMs)}`;
    case 'errors':
      return `no more than ${share(objective.maxRate)} of requests failing`;
    case 'cost':
      return `no more than ${dollars(objective.maxMonthly)} a month`;
    case 'backlog':
      return `no more than ${count(objective.maxDepth)} messages left in a queue at the end`;
    case 'lost':
      return `no more than ${count(objective.max)} messages lost`;
    case 'wait':
      return `no message waiting in a queue for more than ${duration(objective.maxMs)}`;
  }
}

function describeResult({ objective, value, met }: ObjectiveResult): string {
  const got =
    objective.kind === 'p99' ? duration(value) : objective.kind === 'errors' ? share(value) : objective.kind === 'cost' ? dollars(value) : count(value);
  return `${met ? 'met' : 'NOT met'}: ${describeObjective(objective)} (got ${got})`;
}

function describeWorkload(workload: Workload): string[] {
  const lines: string[] = [];
  for (const phase of workload.phases) lines.push(`- at ${duration(phase.atMs)}: traffic becomes ${String(phase.multiplier)} times the clients' base rate`);
  for (const { atMs, command } of workload.chaos) {
    const { type, ...rest } = command;
    lines.push(`- at ${duration(atMs)}: ${type} ${JSON.stringify(rest)}`);
  }
  return lines;
}

/** A dozen moments of the run, evenly spaced, so that a reader can see what changed and when. */
function timeline(report: Report): string[] {
  const samples = report.samples;
  if (samples.length === 0) return [];
  const rows = Math.min(12, samples.length);
  const lines: string[] = [];
  for (let row = 0; row < rows; row++) {
    const sample = samples[Math.floor(((row + 1) * samples.length) / rows) - 1]!;
    const finished = sample.ok + sample.failed;
    lines.push(
      `- ${duration(sample.t)}: ${count(sample.created)} requests in that second, ${share(finished > 0 ? sample.failed / finished : 0)} failing` +
        (sample.ok > 0 ? `, p99 ${duration(sample.p99)}` : ''),
    );
  }
  return lines;
}

function locks(scenario: Scenario): string[] {
  const lines = Object.entries(scenario.locked).map(([id, paths]) =>
    paths === '*' ? `- ${id}: everything` : paths.length === 0 ? `- ${id}: must stay in the design` : `- ${id}: ${paths.join(', ')}`,
  );
  const palette = scenario.palette.length === 0 ? 'none' : scenario.palette.join(', ');
  return [...lines, `Kinds of part that may be added: ${palette}.`];
}

/** The prompt for a review of one run. */
export function buildReviewPrompt(input: ReviewInput): ReviewPrompt {
  const { design, report, level } = input;
  const { requests, latency } = report;
  const lines: string[] = [];

  lines.push('## The design', '', 'Parts:');
  lines.push(...design.nodes.map((node) => `- ${describeNode(node)}`));
  lines.push('', 'Connections, in the order each caller makes them:');
  lines.push(...(design.edges.length === 0 ? ['- none'] : design.edges.map((edge) => `- ${describeEdge(edge)}`)));

  lines.push('', '## What was asked of it', '');
  if (level) {
    const { scenario } = level;
    lines.push(`This was the level "${scenario.text.title}". ${scenario.text.brief}`, '');
    lines.push(`To pass: ${scenario.objectives.map(describeObjective).join('; ')}.`);
    lines.push(`For a second star: ${scenario.bonus[0].map(describeObjective).join('; ')}. For a third: ${scenario.bonus[1].map(describeObjective).join('; ')}.`);
    lines.push(`The run is ${duration(scenario.durationMs)} long and is scored from ${duration(scenario.warmupMs)} on.`, '');
    lines.push('What happens during the level:', ...describeWorkload(scenario.workload), '');
    lines.push('Fixed in this level, and not to be changed:', ...locks(scenario));
  } else {
    lines.push('Nothing in particular: a free run in the sandbox.');
    if (input.workload && (input.workload.phases.length > 0 || input.workload.chaos.length > 0)) {
      lines.push('', 'What happened during the run:', ...describeWorkload(input.workload));
    }
  }

  lines.push('', '## What the run measured', '');
  lines.push(
    `${duration(report.timeMs)} simulated. ${count(requests.created)} requests sent, ${count(requests.ok)} succeeded, ${count(requests.failed)} failed ` +
      `(${share(report.rates.errorRate)}). Each request took ${trim(report.rates.attemptsPerRequest, 2)} attempts on average.`,
  );
  if (requests.ok > 0) lines.push(`Latency: p50 ${duration(latency.p50)}, p95 ${duration(latency.p95)}, p99 ${duration(latency.p99)}, slowest ${duration(latency.maxMs)}.`);
  lines.push(`Cost: ${dollars(report.monthlyCost)} a month.`, '', 'Each part over the whole run:');
  for (const node of report.nodes) {
    const facts = [
      `${count(node.arrivals)} arrived`,
      `${count(node.failed)} failed`,
      ...(node.type === 'service' || node.type === 'worker' || node.type === 'database' ? [`${share(node.utilization)} of its slots busy`] : []),
      ...(node.ok > 0 ? [`p99 ${duration(node.p99)}`] : []),
      ...(node.maxQueued > 0 ? [`up to ${count(node.maxQueued)} waiting`] : []),
      ...(node.wasted > 0 ? [`${count(node.wasted)} finished after their caller had given up`] : []),
      ...(node.type === 'cache' && (node.detail.hits ?? 0) + (node.detail.misses ?? 0) > 0
        ? [`${share((node.detail.hits ?? 0) / ((node.detail.hits ?? 0) + (node.detail.misses ?? 0)))} hits`]
        : []),
      ...(node.type === 'service' || node.type === 'worker' ? [`${String(node.instances)} instance(s) at the end`] : []),
      `${dollars(node.monthlyCost)} a month`,
    ];
    lines.push(`- ${node.id}: ${facts.join(', ')}`);
  }

  const busy = report.edges.filter((edge) => edge.failed > 0 || edge.retried > 0 || edge.breakerOpened > 0 || edge.poolWaitMs > 0);
  if (busy.length > 0) {
    lines.push('', 'Connections where something went wrong:');
    for (const edge of busy) {
      const facts = [
        `${count(edge.calls)} calls`,
        `${count(edge.failed)} failed`,
        ...(edge.timeouts > 0 ? [`${count(edge.timeouts)} timed out`] : []),
        ...(edge.retried > 0 ? [`${count(edge.retried)} retried`] : []),
        ...(edge.breakerOpened > 0 ? [`breaker opened ${count(edge.breakerOpened)} times`] : []),
        ...(edge.poolWaitMs > 0 && edge.calls > 0 ? [`${duration(edge.poolWaitMs / edge.calls)} waiting for a connection on average`] : []),
      ];
      lines.push(`- ${edge.id}: ${facts.join(', ')}`);
    }
  }

  if (report.blame.length > 0) {
    lines.push('', 'Why requests failed, most common first:');
    for (const group of report.blame.slice(0, 8)) {
      lines.push(`- ${count(group.count)}: ${group.cause} at ${group.nodeId}${group.where ? `, while the call was ${group.where}` : ''}`);
    }
  }

  const found = input.bottleneck;
  if (found) {
    lines.push('', `Where the time was going at the end of the run: ${found.nodeId} (${found.kind}), reached through ${found.path.join(' -> ')}.`);
  }

  const moments = timeline(report);
  if (moments.length > 0) lines.push('', 'Over time:', ...moments);

  if (level) {
    const { outcome } = level;
    lines.push('', '## The result', '');
    lines.push(outcome.passed ? `Passed, with ${String(outcome.stars)} of 3 stars.` : 'Not passed.');
    lines.push(...outcome.results.map((result) => `- ${describeResult(result)}`));
    outcome.bonus.forEach((tier, index) => {
      lines.push(...tier.map((result) => `- for star ${String(index + 2)}, ${describeResult(result)}`));
    });
    if (outcome.broken.length > 0) lines.push(`- a fixed setting was changed, so it cannot pass: ${outcome.broken.join(', ')}`);
  }

  return { system: system(input.language), user: lines.join('\n') };
}
