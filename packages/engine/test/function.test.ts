import { describe, expect, it } from 'vitest';
import { PRICES } from '../src/index.ts';
import type { Design, FunctionNode } from '../src/index.ts';
import { during, fixed, nodeOf, run, system } from './helpers.ts';

type Params = Partial<FunctionNode['params']>;

/** Clients calling a function directly. Its work takes 50 ms and a cold start 500 ms more. */
const direct = (rps: number, params: Params = {}): Design =>
  system(
    [
      { id: 'users', type: 'client', params: { rps } },
      { id: 'fn', type: 'function', params: { serviceTime: fixed(50), coldStartMs: 500, keepWarmMs: 60_000, ...params } },
    ],
    [['users', 'fn']],
  );

describe('a function', () => {
  it('starts an environment for a call when none is ready, and reuses it for the next', () => {
    // 20 a second at 50 ms each is one call in progress on average and seldom more than a handful.
    const { sim, report } = run(direct(20), { sendMs: 60_000, drainMs: 2000 });
    const fn = nodeOf(report, 'fn');
    expect(fn.detail.coldStarts).toBeGreaterThan(0);
    expect(fn.detail.coldStarts).toBeLessThan(12);
    // The few that waited for a start are the slowest calls there were; the rest never noticed.
    expect(report.latency.p50).toBeCloseTo(50, 0);
    expect(report.latency.maxMs).toBeCloseTo(550, 0);
    expect(report.requests.ok).toBe(report.requests.created);
    expect(sim.calls.live).toBe(0);
  });

  it('lets an environment go after a quiet spell, so the next call waits for a new one', () => {
    // One call every two seconds or so, and environments kept for half a second.
    const { report } = run(direct(0.5, { keepWarmMs: 500 }), { sendMs: 600_000, drainMs: 2000 });
    const fn = nodeOf(report, 'fn');
    // A gap between calls is longer than half a second about three times in four.
    const share = fn.detail.coldStarts! / fn.arrivals;
    expect(share).toBeGreaterThan(0.65);
    expect(share).toBeLessThan(0.9);
    expect(report.latency.p50).toBeCloseTo(550, 0);

    const kept = run(direct(0.5, { keepWarmMs: 60_000 }), { sendMs: 600_000, drainMs: 2000 }).report;
    expect(nodeOf(kept, 'fn').detail.coldStarts).toBeLessThan(10);
  });

  it('meets a surge at once, and the first calls of the surge pay for it', () => {
    const surge = { phases: [{ atMs: 30_000, multiplier: 20 }] };
    const { report } = run(direct(20, { maxConcurrency: 500 }), { sendMs: 60_000, drainMs: 2000, workload: surge });
    const fn = nodeOf(report, 'fn');
    // Four hundred a second at 50 ms is twenty calls in progress, once things are warm. But every
    // call that arrives in the first half second finds nothing ready and starts an environment of
    // its own: well over a hundred of them, several times what the traffic goes on to need.
    expect(fn.detail.coldStarts).toBeGreaterThan(100);
    expect(fn.detail.coldStarts).toBeLessThan(200);
    expect(report.requests.failed).toBe(0);
    const surgeSecond = report.samples.find((sample) => sample.t === 31_000)!;
    const later = report.samples.find((sample) => sample.t === 45_000)!;
    expect(surgeSecond.p99).toBeGreaterThan(500);
    expect(later.p99).toBeLessThan(60);
  });

  it('refuses what is beyond the calls it may run at once', () => {
    // 400 a second at 50 ms is twenty at once; it may run ten.
    const { sim, report } = run(direct(400, { maxConcurrency: 10 }), { sendMs: 30_000, drainMs: 2000 });
    const fn = nodeOf(report, 'fn');
    const refused = report.requests.failedBy['rate-limited'];
    expect(report.requests.failed).toBe(refused);
    expect(refused / report.requests.created).toBeGreaterThan(0.45);
    expect(refused / report.requests.created).toBeLessThan(0.6);
    expect(fn.detail.throttled).toBe(refused);
    expect(report.blame[0]).toMatchObject({ cause: 'rate-limited', nodeId: 'fn' });
    expect(fn.utilization).toBeGreaterThan(0.85);
    // Nothing waited: what got in took its own time and no longer.
    expect(fn.maxQueued).toBe(0);
    expect(sim.calls.live).toBe(0);
  });

  it('never makes a call wait for a start when enough environments are kept ready', () => {
    const surge = { phases: [{ atMs: 30_000, multiplier: 20 }] };
    const { report } = run(direct(20, { provisioned: 60 }), { sendMs: 60_000, drainMs: 2000, workload: surge });
    expect(nodeOf(report, 'fn').detail.coldStarts).toBe(0);
    expect(report.latency.maxMs).toBeCloseTo(50, 0);

    // Too few, and the calls beyond them start environments as before.
    const short = run(direct(20, { provisioned: 10 }), { sendMs: 60_000, drainMs: 2000, workload: surge }).report;
    expect(nodeOf(short, 'fn').detail.coldStarts).toBeGreaterThan(5);
  });

  it('costs nothing idle, and the time its calls take when busy', () => {
    const idle = run(direct(0), { sendMs: 60_000 }).report;
    expect(idle.monthlyCost).toBe(0);

    // 40 a second at 50 ms is two environments busy all the time.
    const busy = run(direct(40, { coldStartMs: 0 }), { sendMs: 120_000 }).report;
    expect(busy.monthlyCost / (2 * PRICES.functionBusy)).toBeGreaterThan(0.95);
    expect(busy.monthlyCost / (2 * PRICES.functionBusy)).toBeLessThan(1.05);

    const ready = run(direct(0, { provisioned: 8 }), { sendMs: 60_000 }).report;
    expect(ready.monthlyCost).toBe(8 * PRICES.functionProvisioned);
  });

  it('is charged for the time it spends waiting on what it calls', () => {
    const waiting = (dbMs: number) =>
      system(
        [
          { id: 'users', type: 'client', params: { rps: 40, readRatio: 1 } },
          { id: 'fn', type: 'function', params: { serviceTime: fixed(50), coldStartMs: 0 } },
          { id: 'db', type: 'database', params: { concurrency: 64, readTime: fixed(dbMs) } },
        ],
        [
          ['users', 'fn'],
          ['fn', 'db'],
        ],
      );
    const cost = (dbMs: number) => nodeOf(run(waiting(dbMs), { sendMs: 120_000 }).report, 'fn').monthlyCost;
    // The function does the same work either way. Waiting 150 ms for the database instead of none
    // makes each call four times as long, and the bill four times as large.
    expect(cost(150) / cost(0.001)).toBeGreaterThan(3.8);
    expect(cost(150) / cost(0.001)).toBeLessThan(4.2);
  });

  it('opens a connection for every environment, which a database may not have room for', () => {
    const target = system(
      [
        { id: 'users', type: 'client', params: { rps: 20, readRatio: 1 } },
        { id: 'fn', type: 'function', params: { serviceTime: fixed(1), coldStartMs: 0 } },
        { id: 'db', type: 'database', params: { concurrency: 4, maxConnections: 20, readTime: fixed(50) } },
      ],
      [
        ['users', 'fn'],
        ['fn', 'db'],
      ],
    );
    const surge = { phases: [{ atMs: 20_000, multiplier: 40 }] };
    const { report } = run(target, { sendMs: 40_000, drainMs: 5000, workload: surge });
    // A service would have queued the surge behind its few slots. The function runs all of it at
    // once, and the database turns away what it has no connection left for.
    expect(during(report, 0, 20_000, (sample) => sample.failed)).toBe(0);
    expect(report.requests.failedBy['queue-full']).toBeGreaterThan(1000);
    expect(report.blame[0]).toMatchObject({ cause: 'queue-full', nodeId: 'db' });
  });

  it('comes back from being down with every environment to start again', () => {
    const outage = { chaos: [{ atMs: 30_000, command: { type: 'kill', nodeId: 'fn', durationMs: 2000 } as const }] };
    const { sim, report } = run(direct(200), { sendMs: 60_000, drainMs: 2000, workload: outage });
    const healthy = run(direct(200), { sendMs: 60_000, drainMs: 2000 }).report;
    expect(report.requests.failedBy['node-down']).toBeGreaterThan(300);
    expect(nodeOf(report, 'fn').detail.coldStarts).toBeGreaterThan(1.5 * nodeOf(healthy, 'fn').detail.coldStarts!);
    expect(report.requests.created).toBe(report.requests.ok + report.requests.failed);
    expect(sim.calls.live).toBe(0);
  });

  it('takes on new settings while it runs', () => {
    const target = direct(400, { maxConcurrency: 10 });
    const { sim } = run(target, { sendMs: 10_000 });
    const refusedBefore = sim.failedBy[3]!;
    expect(refusedBefore).toBeGreaterThan(0);
    sim.reconfigure({
      ...target,
      nodes: target.nodes.map((node) => (node.type === 'function' ? { ...node, params: { ...node.params, maxConcurrency: 200 } } : node)),
    });
    sim.advance(12_000);
    const refusedAt = sim.failedBy[3]!;
    sim.advance(30_000);
    expect(sim.failedBy[3]).toBe(refusedAt);
  });
});
