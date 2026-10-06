import { exp, system } from './helpers.ts';
import type { RunInput } from './helpers.ts';

// One system that uses every kind of part and every edge policy, and a scripted bad day for it.
// golden.test.ts records what it does. scripts/browsers.mjs runs the same thing in the browsers
// that are installed and checks that each of them computes the same report.

export const storefront = system(
  [
    { id: 'users', type: 'client', params: { rps: 300, readRatio: 0.9, keys: 5000, skew: 1 } },
    { id: 'limit', type: 'rate-limiter', params: { rate: 600, burst: 100 } },
    { id: 'lb', type: 'load-balancer', params: { algorithm: 'least-connections', healthCheckMs: 2000 } },
    {
      id: 'api',
      type: 'service',
      params: { instances: 3, concurrency: 16, queue: 64, serviceTime: { kind: 'lognormal', mean: 8, cv: 1 } },
    },
    { id: 'cache', type: 'cache', params: { capacity: 2000, ttlMs: 30_000, ttlJitter: 0.2, singleFlight: true } },
    { id: 'db', type: 'database', params: { concurrency: 8, maxConnections: 100, replicas: 1, readTime: exp(6), writeTime: exp(12) } },
    { id: 'jobs', type: 'queue', params: { maxDepth: 5000 } },
    { id: 'worker', type: 'worker', params: { instances: 2, concurrency: 4, serviceTime: exp(30), failureRate: 0.05 } },
  ],
  [
    ['users', 'limit', { latencyMs: 5, timeoutMs: 2000, retries: 1, backoffMs: 100, jitter: 1 }],
    ['limit', 'lb', { latencyMs: 0.5 }],
    ['lb', 'api', { latencyMs: 0.5, timeoutMs: 1500, retries: 1 }],
    ['api', 'cache', { latencyMs: 0.3, timeoutMs: 50 }],
    ['api', 'db', { latencyMs: 0.5, timeoutMs: 800, poolSize: 8, breaker: { enabled: true } }],
    ['api', 'jobs', { latencyMs: 0.5, mode: 'async', appliesTo: 'write' }],
    ['jobs', 'worker'],
  ],
);

const badDay = {
  phases: [
    { atMs: 20_000, multiplier: 2.5 },
    { atMs: 40_000, multiplier: 1 },
  ],
  chaos: [
    { atMs: 30_000, command: { type: 'flush', nodeId: 'cache' } as const },
    { atMs: 45_000, command: { type: 'kill', nodeId: 'api', count: 1, durationMs: 10_000 } as const },
    { atMs: 50_000, command: { type: 'slow', nodeId: 'worker', factor: 3, durationMs: 10_000 } as const },
    { atMs: 60_000, command: { type: 'failover', nodeId: 'db' } as const },
  ],
};

/** The reference run: ninety seconds of traffic through the bad day, then time for it all to finish. */
export const referenceRun: RunInput = { seed: 2026, sendMs: 90_000, drainMs: 30_000, workload: badDay };
