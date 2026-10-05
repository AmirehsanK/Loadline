import { describe, expect, it } from 'vitest';
import { findBottleneck, hashReport, lintDesign, summarize } from '../src/index.ts';
import { exp, run, system } from './helpers.ts';

// One system that uses every kind of part and every edge policy, run through a scripted bad day.
// The numbers below are not right or wrong in themselves; they are a record. If one changes, the
// engine's behaviour changed, and the commit that updates this file should say why.

const storefront = system(
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

describe('the reference system', () => {
  it('has nothing for the lint to say', () => {
    expect(lintDesign(storefront)).toEqual([]);
  });

  it('gets through its bad day the same way every time', () => {
    const { sim, report } = run(storefront, { seed: 2026, sendMs: 90_000, drainMs: 30_000, workload: badDay });
    const surge = summarize(report.samples.slice(20, 40))!;

    expect(sim.calls.live).toBe(0);
    expect(sim.ignored).toEqual([]);
    expect({
      hash: hashReport(report),
      requests: report.requests,
      latency: report.latency,
      monthlyCost: report.monthlyCost,
      blame: report.blame,
      duringTheSurge: findBottleneck(storefront, surge),
      nodes: Object.fromEntries(report.nodes.map((node) => [node.id, { arrivals: node.arrivals, failed: node.failed, ...node.detail }])),
    }).toMatchInlineSnapshot(`
      {
        "blame": [
          {
            "cause": "circuit-open",
            "count": 6981,
            "nodeId": "db",
            "where": null,
          },
          {
            "cause": "rate-limited",
            "count": 2777,
            "nodeId": "limit",
            "where": null,
          },
          {
            "cause": "node-down",
            "count": 92,
            "nodeId": "api",
            "where": null,
          },
          {
            "cause": "node-down",
            "count": 8,
            "nodeId": "db",
            "where": null,
          },
        ],
        "duringTheSurge": {
          "kind": "work",
          "nodeId": "api",
          "path": [
            "limit",
            "lb",
            "api",
          ],
          "utilization": 0.1542625247480431,
        },
        "hash": "52a278a2c8c9c306",
        "latency": {
          "maxMs": 340.6153920909419,
          "meanMs": 33.0738060016538,
          "p50": 22.656,
          "p90": 69.12,
          "p95": 100.864,
          "p99": 130.56,
          "p999": 259.072,
        },
        "monthlyCost": 540,
        "nodes": {
          "api": {
            "arrivals": 33867,
            "failed": 7720,
          },
          "cache": {
            "arrivals": 39813,
            "evictions": 551,
            "failed": 0,
            "hits": 17063,
            "items": 1239,
            "misses": 12779,
          },
          "db": {
            "arrivals": 9054,
            "failed": 107,
            "primaryUp": 1,
            "replicas": 0,
          },
          "jobs": {
            "arrivals": 2369,
            "deadLettered": 0,
            "delivered": 2491,
            "depth": 0,
            "dropped": 0,
            "failed": 0,
            "published": 2369,
          },
          "lb": {
            "arrivals": 33427,
            "failed": 7280,
          },
          "limit": {
            "arrivals": 42520,
            "failed": 16373,
          },
          "users": {
            "arrivals": 36005,
            "failed": 9858,
          },
          "worker": {
            "arrivals": 2491,
            "failed": 122,
          },
        },
        "requests": {
          "attempts": 42520,
          "created": 36005,
          "failed": 9858,
          "failedBy": {
            "circuit-open": 6981,
            "injected-error": 0,
            "network-drop": 0,
            "node-down": 100,
            "queue-full": 0,
            "rate-limited": 2777,
            "timeout": 0,
          },
          "inFlight": 0,
          "ok": 26147,
        },
      }
    `);
  });
});
