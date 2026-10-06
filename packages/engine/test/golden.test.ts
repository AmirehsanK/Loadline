import { describe, expect, it } from 'vitest';
import { createSimulation, designMonthlyCost, findBottleneck, hashReport, lintDesign, summarize, totalMonthlyCost } from '../src/index.ts';
import { run } from './helpers.ts';
import { referenceRun, storefront } from './reference.ts';

// The reference system (reference.ts) uses every kind of part and every edge policy, and is run
// through a scripted bad day. The numbers below are not right or wrong in themselves; they are a
// record. If one changes, the engine's behaviour changed, and the commit that updates this file
// should say why.

describe('the reference system', () => {
  it('has nothing for the lint to say', () => {
    expect(lintDesign(storefront)).toEqual([]);
  });

  it('costs at rest what a run of it starts at', () => {
    expect(designMonthlyCost(storefront)).toBe(totalMonthlyCost(createSimulation(storefront, { seed: 1 })));
    // By hand: limiter 10, balancer 20, three instances at 63, cache 14, two servers at 136, queue 15, two workers at 27.
    expect(designMonthlyCost(storefront)).toBe(574);
  });

  it('gets through its bad day the same way every time', () => {
    const { sim, report } = run(storefront, referenceRun);
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
