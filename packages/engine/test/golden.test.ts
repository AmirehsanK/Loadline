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
            "count": 7243,
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
            "count": 2,
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
          "utilization": 0.15426252474804375,
        },
        "hash": "a01c53ac8ed74e07",
        "latency": {
          "maxMs": 226.35832311693594,
          "meanMs": 33.27728221165522,
          "p50": 22.656,
          "p90": 72.192,
          "p95": 103.936,
          "p99": 129.536,
          "p999": 156.672,
        },
        "monthlyCost": 540,
        "nodes": {
          "api": {
            "arrivals": 33585,
            "failed": 7602,
          },
          "cache": {
            "arrivals": 39863,
            "evictions": 559,
            "failed": 0,
            "hits": 16918,
            "items": 1205,
            "misses": 13009,
          },
          "db": {
            "arrivals": 9013,
            "failed": 90,
            "primaryUp": 1,
            "replicas": 0,
          },
          "jobs": {
            "arrivals": 2376,
            "deadLettered": 0,
            "delivered": 2499,
            "depth": 0,
            "dropped": 0,
            "failed": 0,
            "published": 2376,
          },
          "lb": {
            "arrivals": 33254,
            "failed": 7271,
          },
          "limit": {
            "arrivals": 42347,
            "failed": 16364,
          },
          "users": {
            "arrivals": 36005,
            "failed": 10022,
          },
          "worker": {
            "arrivals": 2499,
            "failed": 123,
          },
        },
        "requests": {
          "attempts": 42347,
          "created": 36005,
          "failed": 10022,
          "failedBy": {
            "circuit-open": 7243,
            "injected-error": 0,
            "network-drop": 0,
            "node-down": 2,
            "queue-full": 0,
            "rate-limited": 2777,
            "timeout": 0,
          },
          "inFlight": 0,
          "ok": 25983,
        },
      }
    `);
  });
});
