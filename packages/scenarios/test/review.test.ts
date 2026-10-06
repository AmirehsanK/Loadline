import { buildReport, createSimulation, designSchema, findBottleneck, summarize } from '@loadline/engine';
import type { Design } from '@loadline/engine';
import { describe, expect, it } from 'vitest';
import { LEVELS, buildReviewPrompt, evaluate, findLevel, startScenario } from '../src/index.ts';
import type { ReviewInput, Scenario } from '../src/index.ts';

/** Everything a review of a level run is given, for a design. */
function levelRun(scenario: Scenario, design: Design, language: ReviewInput['language'] = 'en'): ReviewInput {
  const sim = startScenario(scenario, design);
  sim.advance(scenario.durationMs);
  const recent = summarize(sim.samples.slice(-5));
  return {
    design,
    report: buildReport(sim),
    bottleneck: recent ? findBottleneck(design, recent) : null,
    level: { scenario, outcome: evaluate(scenario, design, sim) },
    language,
  };
}

const firstTraffic = findLevel('first-traffic')!;

describe('the prompt for a review', () => {
  it('gives the design, what was asked, what was measured and the result', () => {
    const { system, user } = buildReviewPrompt(levelRun(firstTraffic, firstTraffic.starter));

    expect(system).toContain('A timeout does not cancel the work downstream');
    expect(system).toContain('Use only what is measured below.');
    expect(system).toContain('Reply in English.');

    expect(user).toContain('- users ("Users"): client sending 100 requests a second');
    expect(user).toContain('- api ("API"): service, 1 instance(s) of 8 slots, work 40 ms on average, varying a lot, queue 64 per instance');
    expect(user).toContain('- users -> api: timeout 2 s');
    expect(user).toContain('This was the level "First traffic".');
    expect(user).toContain('To pass: p99 within 500 ms; no more than 1% of requests failing; no more than $140 a month.');
    expect(user).toContain('- api: concurrency, serviceTime, autoscale.enabled');
    expect(user).toContain('Kinds of part that may be added: load-balancer.');
    expect(user).toMatch(/\d[\d,]* requests sent, [\d,]+ succeeded, [\d,]+ failed \(\d+(\.\d+)?%\)/);
    expect(user).toMatch(/- [\d,]+: queue-full at api/);
    expect(user).toContain('Where the time was going at the end of the run: api (saturated)');
    expect(user).toContain('Not passed.');
    expect(user).toContain('- NOT met: no more than 1% of requests failing (got 32.9%)');
    expect(user).toContain('- met: no more than $140 a month (got $39)');
  });

  it('says so when a level was passed, and what it earned', () => {
    const { user } = buildReviewPrompt(levelRun(firstTraffic, firstTraffic.reference));
    expect(user).toContain('Passed, with 3 of 3 stars.');
    expect(user).toContain('- lb ("Balancer"): load balancer, round-robin');
    expect(user).not.toContain('Why requests failed');
  });

  it('asks for the reply in the language of the interface', () => {
    const { system } = buildReviewPrompt(levelRun(firstTraffic, firstTraffic.starter, 'fa'));
    expect(system).toContain('Reply in Persian (Farsi). Keep the names of parts and settings in English');
  });

  it('describes a free run with the traffic it followed', () => {
    const design = designSchema.parse({
      nodes: [
        { id: 'users', type: 'client', params: { rps: 50 } },
        { id: 'api', type: 'service', params: { concurrency: 4, serviceTime: { kind: 'const', mean: 10 } } },
      ],
      edges: [{ id: 'users--api', from: 'users', to: 'api', params: { retries: 2, backoffMs: 50, jitter: 1, poolSize: 3, breaker: { enabled: true } } }],
    });
    const workload = { phases: [{ atMs: 5000, multiplier: 3 }], chaos: [{ atMs: 8000, command: { type: 'kill' as const, nodeId: 'api', durationMs: 2000 } }] };
    const sim = createSimulation(design, { seed: 1, workload });
    sim.advance(15_000);
    const { user } = buildReviewPrompt({ design, report: buildReport(sim), workload, language: 'en' });
    expect(user).toContain('Nothing in particular: a free run in the sandbox.');
    expect(user).toContain("- at 5 s: traffic becomes 3 times the clients' base rate");
    expect(user).toContain('- at 8 s: kill {"nodeId":"api","durationMs":2000}');
    expect(user).toContain('- users -> api: timeout 3 s, 2 retries after 50 ms with jitter, pool of 3 connections per caller instance, circuit breaker (opens at 50% failing, for 5 s)');
    expect(user).not.toContain('## The result');
  });

  it('is the same text for the same run, and holds nothing that failed to format', () => {
    for (const level of LEVELS) {
      for (const design of [level.starter, level.reference]) {
        const input = levelRun(level, design);
        const prompt = buildReviewPrompt(input);
        expect(buildReviewPrompt(input), level.id).toEqual(prompt);
        expect(prompt.user, level.id).not.toMatch(/undefined|NaN|\[object|Infinity/);
        // Long enough to say something, short enough to read: no samples dumped in.
        expect(prompt.user.length, level.id).toBeGreaterThan(1500);
        expect(prompt.user.length, level.id).toBeLessThan(9000);
      }
    }
  });
});
