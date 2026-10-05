import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildReport, createSimulation, hashReport } from '../src/index.ts';
import type { Design, Dist } from '../src/index.ts';
import { chain, design, exp, fixed, run } from './helpers.ts';

/** A design that exercises queueing, rejection, timeouts, orphans and retries with jitter. */
function busy(): Design {
  return chain(300, [
    { concurrency: 8, queue: 50, serviceTime: { kind: 'lognormal', mean: 8, cv: 1 }, latencyMs: 1, timeoutMs: 120, retries: 2, backoffMs: 20, backoffFactor: 2, jitter: 0.5 },
    { concurrency: 2, queue: 20, serviceTime: exp(6), latencyMs: 0.5, timeoutMs: 80, retries: 1, backoffMs: 10, jitter: 1 },
  ]);
}

describe('determinism', () => {
  it('gives the same report for the same seed', () => {
    const first = run(busy(), { seed: 11, sendMs: 20_000, drainMs: 5000 }).report;
    const second = run(busy(), { seed: 11, sendMs: 20_000, drainMs: 5000 }).report;
    expect(first.requests.failed).toBeGreaterThan(0);
    expect(first.requests.ok).toBeGreaterThan(0);
    expect(second).toEqual(first);
    expect(hashReport(second)).toBe(hashReport(first));
  });

  it('gives a different report for a different seed', () => {
    const first = run(busy(), { seed: 11, sendMs: 5000 }).report;
    const second = run(busy(), { seed: 12, sendMs: 5000 }).report;
    expect(hashReport(second)).not.toBe(hashReport(first));
  });

  it('does not depend on how the run is cut into steps', () => {
    const whole = createSimulation(busy(), { seed: 5 });
    whole.advance(15_000);

    const stepped = createSimulation(busy(), { seed: 5 });
    for (let t = 37; t < 15_000; t += 37) stepped.advance(t);
    stepped.advance(15_000);

    const budgeted = createSimulation(busy(), { seed: 5 });
    let slices = 0;
    while (!budgeted.advance(15_000, 500)) slices++;

    expect(slices).toBeGreaterThan(10);
    expect(buildReport(stepped)).toEqual(buildReport(whole));
    expect(buildReport(budgeted)).toEqual(buildReport(whole));
  });

  it('keeps one part of a design unchanged when an unrelated part is added', () => {
    const alone = design({
      nodes: [
        { id: 'users', type: 'client', params: { rps: 200 } },
        { id: 'api', type: 'service', params: { concurrency: 4, serviceTime: exp(15) } },
      ],
      edges: [{ id: 'users-api', from: 'users', to: 'api', params: { timeoutMs: 100, retries: 1, jitter: 1 } }],
    });
    const together = design({
      nodes: [
        { id: 'bots', type: 'client', params: { rps: 500 } },
        { id: 'search', type: 'service', params: { concurrency: 2, serviceTime: exp(3) } },
        ...alone.nodes,
      ],
      edges: [{ id: 'bots-search', from: 'bots', to: 'search' }, ...alone.edges],
    });

    const a = run(alone, { seed: 9, sendMs: 20_000 }).report;
    const b = run(together, { seed: 9, sendMs: 20_000 }).report;
    const pick = (nodes: typeof a.nodes, id: string) => nodes.find((node) => node.id === id);

    expect(pick(b.nodes, 'users')).toEqual(pick(a.nodes, 'users'));
    expect(pick(b.nodes, 'api')).toEqual(pick(a.nodes, 'api'));
    expect(b.edges.find((edge) => edge.id === 'users-api')).toEqual(a.edges[0]);
  });

  it('keeps the reference run stable', () => {
    // If this changes, the engine's behaviour or the report's shape changed. Both are fine when
    // intended; update the snapshot and say why in the commit.
    const { report } = run(busy(), { seed: 2026, sendMs: 30_000, drainMs: 5000 });
    expect({ hash: hashReport(report), requests: report.requests, latency: report.latency }).toMatchInlineSnapshot(`
      {
        "hash": "0450779918b5de49",
        "latency": {
          "maxMs": 408.2882309296547,
          "meanMs": 38.0282840596446,
          "p50": 29.056,
          "p90": 71.168,
          "p95": 89.6,
          "p99": 248.832,
          "p999": 370.688,
        },
        "requests": {
          "attempts": 22265,
          "created": 8859,
          "failed": 6680,
          "failedBy": {
            "circuit-open": 0,
            "injected-error": 0,
            "network-drop": 0,
            "node-down": 0,
            "queue-full": 4293,
            "rate-limited": 0,
            "timeout": 2387,
          },
          "inFlight": 0,
          "ok": 2179,
        },
      }
    `);
  });
});

const dist: fc.Arbitrary<Dist> = fc.record({
  kind: fc.constantFrom<Dist['kind']>('const', 'exp', 'lognormal'),
  mean: fc.double({ min: 1, max: 40, noNaN: true }),
  cv: fc.double({ min: 0.1, max: 2, noNaN: true }),
});

const stage = fc.record({
  concurrency: fc.integer({ min: 1, max: 4 }),
  queue: fc.integer({ min: 0, max: 20 }),
  serviceTime: dist,
  latencyMs: fc.double({ min: 0, max: 5, noNaN: true }),
  timeoutMs: fc.oneof(fc.constant(0), fc.double({ min: 5, max: 200, noNaN: true })),
  retries: fc.integer({ min: 0, max: 3 }),
  backoffMs: fc.double({ min: 0, max: 50, noNaN: true }),
  backoffFactor: fc.double({ min: 1, max: 3, noNaN: true }),
  jitter: fc.double({ min: 0, max: 1, noNaN: true }),
});

describe('conservation', () => {
  it('ends every request and every call exactly once', { timeout: 120_000 }, () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: 10, max: 400 }),
        fc.array(stage, { minLength: 1, maxLength: 3 }),
        (seed, rps, stages) => {
          const target = chain(rps, stages);
          const { sim, report } = run(target, { seed, sendMs: 3000, drainMs: 600_000 });
          const { requests } = report;
          const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

          expect(requests.inFlight).toBe(0);
          expect(requests.ok + requests.failed).toBe(requests.created);
          expect(sim.calls.live).toBe(0);
          expect(sum(Object.values(requests.failedBy))).toBe(requests.failed);
          expect(sum(report.blame.map((blame) => blame.count))).toBe(requests.failed);
          expect(sum(report.samples.map((sample) => sample.created))).toBe(requests.created);
          expect(sum(report.samples.map((sample) => sample.ok))).toBe(requests.ok);

          expect(requests.attempts).toBeGreaterThanOrEqual(requests.created);
          expect(requests.attempts).toBeLessThanOrEqual(requests.created * (1 + stages[0]!.retries));

          for (const node of report.nodes) {
            expect(node.ok + node.failed).toBe(node.arrivals);
            expect(sum(Object.values(node.failedBy))).toBe(node.failed);
            expect(node.utilization).toBeGreaterThanOrEqual(0);
            expect(node.utilization).toBeLessThanOrEqual(1 + 1e-9);
          }
          for (const edge of report.edges) expect(edge.ok + edge.failed).toBe(edge.calls);

          const { latency } = report;
          expect(latency.p50).toBeLessThanOrEqual(latency.p99);
          expect(latency.p99).toBeLessThanOrEqual(latency.maxMs);

          // And the same inputs give the same run.
          expect(hashReport(run(target, { seed, sendMs: 3000, drainMs: 600_000 }).report)).toBe(hashReport(report));
        },
      ),
      { numRuns: 60 },
    );
  });

  it('holds while a run is still in progress', () => {
    const sim = createSimulation(chain(500, [{ concurrency: 2, queue: 10, serviceTime: fixed(5), timeoutMs: 40 }]), {
      seed: 4,
    });
    for (let t = 250; t <= 5000; t += 250) {
      sim.advance(t);
      const { requests, nodes } = buildReport(sim);
      expect(requests.ok + requests.failed + requests.inFlight).toBe(requests.created);
      expect(requests.inFlight).toBeGreaterThanOrEqual(0);
      // Whatever has arrived at the service is finished, in a slot, or in its queue.
      const last = sim.samples[sim.samples.length - 1];
      if (last && last.t === t) {
        const service = nodes[1]!;
        expect(service.ok + service.failed + last.nodes[1]!.inFlight + last.nodes[1]!.queued).toBe(service.arrivals);
      }
    }
  });
});
