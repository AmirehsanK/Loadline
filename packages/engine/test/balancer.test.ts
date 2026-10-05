import { describe, expect, it } from 'vitest';
import { lintDesign } from '../src/index.ts';
import type { LoadBalancerNode } from '../src/index.ts';
import { during, edgeOf, exp, nodeOf, run, system } from './helpers.ts';

type Algorithm = LoadBalancerNode['params']['algorithm'];

/** Eight single-slot instances at 90% load, behind a balancer using `algorithm`. */
function fleet(algorithm: Algorithm) {
  return system(
    [
      { id: 'users', type: 'client', params: { rps: 720 } },
      { id: 'lb', type: 'load-balancer', params: { algorithm } },
      { id: 'api', type: 'service', params: { instances: 8, concurrency: 1, queue: 100_000, serviceTime: exp(10) } },
    ],
    [
      ['users', 'lb'],
      ['lb', 'api'],
    ],
  );
}

describe('a load balancer', () => {
  it('puts every instance to work, where a direct call uses only the first', () => {
    const service = { id: 'api', type: 'service', params: { instances: 3, concurrency: 4, serviceTime: exp(10) } } as const;
    const users = { id: 'users', type: 'client', params: { rps: 300 } } as const;
    const direct = system([users, service], [['users', 'api']]);
    const balanced = system([users, { id: 'lb', type: 'load-balancer' }, service], [
      ['users', 'lb'],
      ['lb', 'api'],
    ]);

    expect(lintDesign(direct).map((issue) => issue.code)).toEqual(['needs-balancer']);
    expect(lintDesign(balanced)).toEqual([]);

    const alone = nodeOf(run(direct, { sendMs: 120_000 }).report, 'api');
    const shared = nodeOf(run(balanced, { sendMs: 120_000 }).report, 'api');
    // The same work either way, so the same share of all twelve slots is busy.
    expect(alone.utilization).toBeCloseTo(0.25, 1);
    expect(shared.utilization).toBeCloseTo(0.25, 1);
    // But one instance at 75% queues, and three at 25% hardly do.
    expect(alone.meanMs).toBeGreaterThan(14);
    expect(shared.meanMs).toBeLessThan(10.5);
    expect(alone.maxQueued).toBeGreaterThan(shared.maxQueued * 2);
  });

  it('waits less the more it knows about each instance', { timeout: 120_000 }, () => {
    const waited = (algorithm: Algorithm) => nodeOf(run(fleet(algorithm), { sendMs: 300_000 }).report, 'api').meanMs;
    const random = waited('random');
    const roundRobin = waited('round-robin');
    const twoChoices = waited('two-choices');
    const leastConnections = waited('least-connections');

    // Random sends each instance a Poisson stream: eight M/M/1 queues at 90%, ten times the work.
    expect(random).toBeGreaterThan(80);
    expect(random).toBeLessThan(125);
    // Taking turns evens out the arrivals; comparing two instances avoids the long queues;
    // comparing all of them does better still.
    expect(roundRobin).toBeLessThan(random * 0.75);
    expect(twoChoices).toBeLessThan(roundRobin * 0.65);
    expect(leastConnections).toBeLessThan(twoChoices * 0.85);
  });

  it('keeps sending to a dead instance until its next health check', () => {
    const target = system(
      [
        { id: 'users', type: 'client', params: { rps: 300 } },
        { id: 'lb', type: 'load-balancer', params: { healthCheckMs: 5000 } },
        { id: 'api', type: 'service', params: { instances: 3, concurrency: 8, serviceTime: exp(10) } },
      ],
      [
        ['users', 'lb'],
        ['lb', 'api'],
      ],
    );
    // The instance dies at 11 s; the checks run at 5, 10, 15 s.
    const chaos = [{ atMs: 11_000, command: { type: 'kill', nodeId: 'api', count: 1 } as const }];
    const { report } = run(target, { sendMs: 30_000, drainMs: 2000, workload: { chaos } });
    const failed = (from: number, to: number) => during(report, from, to, (sample) => sample.failed);

    expect(failed(0, 11_000)).toBe(0);
    // A third of the calls for four seconds, give or take.
    expect(failed(11_000, 15_000)).toBeGreaterThan(300);
    expect(failed(11_000, 15_000)).toBeLessThan(500);
    expect(failed(16_000, 32_000)).toBe(0);
    expect(report.blame).toEqual([{ cause: 'node-down', nodeId: 'api', where: null, count: report.requests.failed }]);
    expect(nodeOf(report, 'api').instances).toBe(2);
    expect(report.requests.inFlight).toBe(0);
  });

  // Three instances, one of which dies at 11 s; the checks run at 5, 10, 15 s.
  const withADeath = (algorithm: Algorithm, retries: number) => {
    const target = system(
      [
        { id: 'users', type: 'client', params: { rps: 300 } },
        { id: 'lb', type: 'load-balancer', params: { algorithm, healthCheckMs: 5000 } },
        { id: 'api', type: 'service', params: { instances: 3, concurrency: 8, serviceTime: exp(10) } },
      ],
      [
        ['users', 'lb'],
        ['lb', 'api', { retries, backoffMs: 0 }],
      ],
    );
    const chaos = [{ atMs: 11_000, command: { type: 'kill', nodeId: 'api', count: 1 } as const }];
    return run(target, { sendMs: 30_000, drainMs: 2000, workload: { chaos } }).report;
  };

  it('retries on another instance, so a dead one that has not been noticed fails nobody', () => {
    // The share of the 1,200 calls of those four seconds that went to the dead instance first.
    const sentToTheDeadOne: Record<Algorithm, [number, number]> = {
      random: [0.28, 0.39],
      // A retry takes a turn like any other call, so it is every second new call, not every third.
      'round-robin': [0.45, 0.55],
      // Whenever it is one of the two, it is the one with fewer calls.
      'two-choices': [0.4, 0.6],
      'least-connections': [0.8, 1],
    };
    for (const [algorithm, [least, most]] of Object.entries(sentToTheDeadOne) as [Algorithm, [number, number]][]) {
      const report = withADeath(algorithm, 1);
      expect(report.requests.failed, algorithm).toBe(0);
      const retried = edgeOf(report, 'lb-api').retried;
      expect(retried / 1200, algorithm).toBeGreaterThan(least);
      expect(retried / 1200, algorithm).toBeLessThan(most);
    }
  });

  it('sends a dead instance more than its share when it counts connections, because a dead one has none', () => {
    const failed = (algorithm: Algorithm) => during(withADeath(algorithm, 0), 11_000, 15_000, (sample) => sample.failed);
    // Taking turns loses a third of the 1,200 calls. Counting connections, the dead instance
    // always looks the least busy, and it loses to the other two only when they are idle as well.
    expect(failed('round-robin')).toBeLessThan(480);
    expect(failed('least-connections')).toBeGreaterThan(600);
  });

  it('retries on the same instance when it is the only one', () => {
    const target = system(
      [
        { id: 'users', type: 'client', params: { rps: 100 } },
        { id: 'lb', type: 'load-balancer' },
        { id: 'api', type: 'service', params: { instances: 1, concurrency: 8, serviceTime: exp(10) } },
      ],
      [
        ['users', 'lb'],
        ['lb', 'api', { retries: 2, backoffMs: 0 }],
      ],
    );
    const chaos = [{ atMs: 2000, command: { type: 'errors', nodeId: 'api', rate: 0.5 } as const }];
    const { report } = run(target, { sendMs: 20_000, drainMs: 2000, workload: { chaos } });
    // Three tries at an even chance each: one request in eight fails.
    expect(report.requests.failed / report.requests.created).toBeGreaterThan(0.08);
    expect(report.requests.failed / report.requests.created).toBeLessThan(0.15);
  });

  it('fails every call at once when no instance is left', () => {
    const target = system(
      [
        { id: 'users', type: 'client', params: { rps: 100 } },
        { id: 'lb', type: 'load-balancer', params: { healthCheckMs: 1000 } },
        { id: 'api', type: 'service', params: { instances: 2, serviceTime: exp(10) } },
      ],
      [
        ['users', 'lb'],
        ['lb', 'api'],
      ],
    );
    const chaos = [{ atMs: 5000, command: { type: 'kill', nodeId: 'api', count: 2, durationMs: 10_000 } as const }];
    const { report } = run(target, { sendMs: 30_000, drainMs: 2000, workload: { chaos } });

    expect(during(report, 7000, 15_000, (sample) => sample.ok)).toBe(0);
    expect(during(report, 7000, 15_000, (sample) => sample.failed)).toBeGreaterThan(600);
    // The instances come back at 15 s and the next check finds them.
    expect(during(report, 17_000, 30_000, (sample) => sample.failed)).toBe(0);
    expect(nodeOf(report, 'api').instances).toBe(2);
  });
});
