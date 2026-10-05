import { describe, expect, it } from 'vitest';
import type { Design } from '../src/index.ts';
import { during, edgeOf, exp, fixed, nodeOf, run, system } from './helpers.ts';

describe('a rate limiter', () => {
  // The service behind it can do 250 a second.
  const api = { id: 'api', type: 'service', params: { concurrency: 5, queue: 256, serviceTime: exp(20) } } as const;
  const users = { id: 'users', type: 'client', params: { rps: 400 } } as const;

  it('turns away what is over its rate, and what gets through is served well', () => {
    const target = system([users, { id: 'limit', type: 'rate-limiter', params: { rate: 200, burst: 20 } }, api], [
      ['users', 'limit', { timeoutMs: 1000 }],
      ['limit', 'api'],
    ]);
    const { report } = run(target, { sendMs: 60_000, drainMs: 5000 });

    // Half the traffic is refused, at once and on purpose.
    expect(report.requests.ok / 60).toBeGreaterThan(195);
    expect(report.requests.ok / 60).toBeLessThan(205);
    expect(report.blame).toEqual([{ cause: 'rate-limited', nodeId: 'limit', where: null, count: report.requests.failed }]);
    // The service is at 80% and answers quickly.
    expect(nodeOf(report, 'api').utilization).toBeLessThan(0.85);
    expect(report.latency.p50).toBeLessThan(40);
  });

  it('is the difference between shedding load and drowning in it', () => {
    const target = system([users, api], [['users', 'api', { timeoutMs: 1000 }]]);
    const { report } = run(target, { sendMs: 60_000, drainMs: 5000 });

    // Without the limiter the service is flat out, its queue is full, and every answer is slow:
    // a call waits behind 256 others, at 250 a second, for about a second.
    expect(nodeOf(report, 'api').maxQueued).toBe(256);
    expect(report.latency.p50).toBeGreaterThan(700);
    expect(report.rates.errorRate).toBeGreaterThan(0.5);
  });

  it('lets a burst through after a quiet spell', () => {
    const target = system(
      [
        { id: 'users', type: 'client', params: { rps: 1000 } },
        { id: 'limit', type: 'rate-limiter', params: { rate: 10, burst: 500 } },
        { id: 'api', type: 'service', params: { concurrency: 1000, serviceTime: fixed(1) } },
      ],
      [
        ['users', 'limit'],
        ['limit', 'api'],
      ],
    );
    const { report } = run(target, { sendMs: 10_000, drainMs: 1000 });
    // The 500 saved up go in the first half second; after that, ten a second.
    expect(during(report, 0, 1000, (sample) => sample.ok)).toBeGreaterThan(495);
    expect(during(report, 0, 1000, (sample) => sample.ok)).toBeLessThan(515);
    expect(during(report, 5000, 10_000, (sample) => sample.ok)).toBe(50);
  });
});

describe('a circuit breaker', () => {
  // Reads need only the service itself. Writes also call a payments service, which turns slow
  // from 10 s to 40 s: 2 s a call, against a 1 s timeout.
  const shop = (enabled: boolean): Design =>
    system(
      [
        { id: 'users', type: 'client', params: { rps: 200, readRatio: 0.8 } },
        { id: 'api', type: 'service', params: { concurrency: 32, queue: 64, serviceTime: fixed(5) } },
        { id: 'payments', type: 'service', params: { concurrency: 64, queue: 64, serviceTime: fixed(20) } },
      ],
      [
        ['users', 'api', { timeoutMs: 3000 }],
        ['api', 'payments', { appliesTo: 'write', timeoutMs: 1000, breaker: { enabled, window: 20, openMs: 5000 } }],
      ],
    );
  const slow = [{ atMs: 10_000, command: { type: 'slow', nodeId: 'payments', factor: 100, durationMs: 30_000 } as const }];
  const outcome = (enabled: boolean) => run(shop(enabled), { sendMs: 60_000, drainMs: 10_000, workload: { chaos: slow } }).report;

  it('is missed when a slow dependency ties up every slot of its caller', () => {
    const report = outcome(false);
    const failed = during(report, 15_000, 40_000, (sample) => sample.failed);
    const ok = during(report, 15_000, 40_000, (sample) => sample.ok);
    // Forty writes a second each hold a slot for a second, and there are thirty-two slots. So
    // reads, which never touch payments, queue behind them: some are turned away, and the rest
    // take most of a second instead of 5 ms.
    expect(failed / (failed + ok)).toBeGreaterThan(0.33);
    expect(nodeOf(report, 'api').maxQueued).toBe(64);
    expect(during(report, 15_000, 40_000, (sample) => sample.p50) / 25).toBeGreaterThan(300);
    expect(report.blame.map((blame) => blame.cause)).toContain('queue-full');
    expect(edgeOf(report, 'api-payments').breakerOpened).toBe(0);
  });

  it('fails the affected calls at once, so the rest are untouched', () => {
    const report = outcome(true);
    const failed = during(report, 15_000, 40_000, (sample) => sample.failed);
    const ok = during(report, 15_000, 40_000, (sample) => sample.ok);
    // Only the writes fail: a fifth of the traffic.
    expect(failed / (failed + ok)).toBeGreaterThan(0.17);
    expect(failed / (failed + ok)).toBeLessThan(0.24);
    expect(Math.max(...report.samples.slice(15, 40).map((sample) => sample.nodes[1]!.queued))).toBe(0);
    // Reads stay as fast as ever.
    expect(during(report, 15_000, 40_000, (sample) => sample.p50) / 25).toBeLessThan(10);

    const refused = report.blame.find((blame) => blame.cause === 'circuit-open');
    expect(refused).toMatchObject({ nodeId: 'payments', where: null });
    expect(refused!.count).toBeGreaterThan(900);
    // It opened, tried one call every five seconds while payments was slow, and closed afterwards.
    const edge = edgeOf(report, 'api-payments');
    expect(edge.breakerOpened).toBeGreaterThanOrEqual(5);
    expect(edge.breakerOpened).toBeLessThanOrEqual(8);
    expect(during(report, 47_000, 60_000, (sample) => sample.failed)).toBe(0);
  });

  it('protects the dependency too: it gets almost no calls while it is struggling', () => {
    const calls = (enabled: boolean) => {
      const report = outcome(enabled);
      return during(report, 15_000, 40_000, (sample) => sample.nodes[2]!.arrivals);
    };
    expect(calls(true)).toBeLessThan(calls(false) / 20);
  });
});
