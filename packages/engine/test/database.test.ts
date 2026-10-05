import { describe, expect, it } from 'vitest';
import type { CommandInput } from '../src/index.ts';
import { during, fixed, nodeOf, run, system, windowsOf } from './helpers.ts';

describe('a connection pool', () => {
  // The database runs four queries of 10 ms at full speed: 400 a second. The service wants 340.
  const pooled = (poolSize: number, timeoutMs = 2000) =>
    system(
      [
        { id: 'users', type: 'client', params: { rps: 340, readRatio: 1 } },
        { id: 'api', type: 'service', params: { concurrency: 200, queue: 256, serviceTime: fixed(1) } },
        { id: 'db', type: 'database', params: { concurrency: 4, maxConnections: 500, readTime: fixed(10) } },
      ],
      [
        ['users', 'api'],
        ['api', 'db', { timeoutMs, poolSize }],
      ],
    );
  const outcome = (poolSize: number, timeoutMs?: number) => {
    const target = pooled(poolSize, timeoutMs);
    const { report } = run(target, { sendMs: 120_000, drainMs: 30_000 });
    // How busy the database was while traffic was arriving, once things had settled.
    const busy = windowsOf(target, report, 'db').slice(20, 120);
    return { report, db: nodeOf(report, 'db'), load: busy.reduce((sum, window) => sum + window.utilization, 0) / busy.length };
  };

  it('that matches what the database can run keeps it at full speed', () => {
    const { report, db, load } = outcome(4);
    expect(report.requests.failed).toBe(0);
    expect(load).toBeCloseTo(0.85, 1);
    // The waiting happens in the caller, in order, and the database never has too much at once.
    expect(db.maxQueued).toBe(0);
    expect(report.latency.p50).toBeLessThan(20);
  });

  it('that is too small starves the caller while the database sits half idle', () => {
    const { report, db, load } = outcome(2);
    // Two connections carry 200 queries a second, half of what the database could do. The
    // service's slots fill with calls waiting for a connection, and it turns the rest away.
    expect(load).toBeCloseTo(0.5, 1);
    expect(db.maxQueued).toBe(0);
    expect(report.requests.ok / 120).toBeGreaterThan(195);
    expect(report.requests.ok / 120).toBeLessThan(210);
    expect(report.rates.errorRate).toBeGreaterThan(0.3);
    expect(report.blame).toEqual([{ cause: 'queue-full', nodeId: 'api', where: null, count: report.requests.failed }]);
  });

  it('blames a timeout on the pool when that is where the call was waiting', () => {
    const { report, db } = outcome(2, 300);
    const inPool = report.blame.find((blame) => blame.where === 'pool');
    expect(inPool).toMatchObject({ cause: 'timeout', nodeId: 'api' });
    expect(inPool!.count).toBeGreaterThan(5000);
    // It gets worse. A call that is handed a connection late has too little patience left to use
    // it, so most of what the database does is for callers who have already gone.
    expect(report.blame.find((blame) => blame.where === 'in-service')).toMatchObject({ cause: 'timeout', nodeId: 'db' });
    expect(db.wasted).toBeGreaterThan(report.requests.ok * 3);
    expect(report.requests.inFlight).toBe(0);
  });

  it('that is too large lets the database take on more than it can run, and everything slows', () => {
    const { report, db, load } = outcome(0);
    // A burst puts a few queries too many on the cores, each then takes longer, so more pile up.
    // It never recovers: flat out, the database does about half of what it did with a pool of four.
    expect(db.maxQueued).toBeGreaterThan(100);
    expect(load).toBeGreaterThan(0.99);
    expect(report.requests.ok / 120).toBeLessThan(230);
    expect(report.rates.errorRate).toBeGreaterThan(0.3);
  });
});

describe('a database', () => {
  it('spreads reads over its replicas and keeps writes on the primary', () => {
    const errors = (replicas: number) => {
      const target = system(
        [
          { id: 'users', type: 'client', params: { rps: 600, readRatio: 0.9 } },
          { id: 'api', type: 'service', params: { concurrency: 200, serviceTime: fixed(1) } },
          { id: 'db', type: 'database', params: { concurrency: 4, readTime: fixed(10), writeTime: fixed(10), replicas } },
        ],
        [
          ['users', 'api'],
          ['api', 'db', { timeoutMs: 1000, poolSize: 4 * (replicas + 1) }],
        ],
      );
      return run(target, { sendMs: 60_000, drainMs: 10_000 }).report;
    };
    // 600 a second is more than one server can do, and comfortable for a primary and two replicas.
    expect(errors(0).rates.errorRate).toBeGreaterThan(0.25);
    const three = errors(2);
    expect(three.rates.errorRate).toBeLessThan(0.01);
    expect(nodeOf(three, 'db').instances).toBe(3);
  });

  it('refuses connections beyond its limit', () => {
    const target = system(
      [
        { id: 'users', type: 'client', params: { rps: 500 } },
        { id: 'api', type: 'service', params: { concurrency: 500, serviceTime: fixed(1) } },
        { id: 'db', type: 'database', params: { concurrency: 4, maxConnections: 20, readTime: fixed(50), writeTime: fixed(50) } },
      ],
      [
        ['users', 'api'],
        ['api', 'db'],
      ],
    );
    const { report } = run(target, { sendMs: 30_000, drainMs: 10_000 });
    expect(report.blame[0]).toMatchObject({ cause: 'queue-full', nodeId: 'db' });
    expect(nodeOf(report, 'db').maxQueued).toBe(16);
    expect(report.requests.inFlight).toBe(0);
  });

  const failover: CommandInput = { type: 'failover', nodeId: 'db' };
  const outage = (replicas: number) => {
    const target = system(
      [
        { id: 'users', type: 'client', params: { rps: 200, readRatio: 0.5 } },
        { id: 'api', type: 'service', params: { concurrency: 200, serviceTime: fixed(1) } },
        { id: 'db', type: 'database', params: { concurrency: 16, replicas, failoverMs: 5000 } },
      ],
      [
        ['users', 'api'],
        ['api', 'db'],
      ],
    );
    return run(target, { sendMs: 30_000, drainMs: 5000, workload: { chaos: [{ atMs: 10_000, command: failover }] } }).report;
  };

  it('refuses everything while a lone primary restarts', () => {
    const report = outage(0);
    expect(during(report, 0, 10_000, (sample) => sample.failed)).toBe(0);
    expect(during(report, 10_000, 15_000, (sample) => sample.ok)).toBe(0);
    expect(during(report, 10_000, 15_000, (sample) => sample.failed)).toBeGreaterThan(900);
    expect(during(report, 16_000, 30_000, (sample) => sample.failed)).toBe(0);
    expect(report.blame[0]).toMatchObject({ cause: 'node-down', nodeId: 'db' });
  });

  it('keeps reading from a replica during a failover, then promotes it', () => {
    const report = outage(1);
    const failed = during(report, 10_000, 15_000, (sample) => sample.failed);
    const ok = during(report, 10_000, 15_000, (sample) => sample.ok);
    // Half the requests are writes, and only those fail.
    expect(failed / (failed + ok)).toBeGreaterThan(0.4);
    expect(failed / (failed + ok)).toBeLessThan(0.6);
    expect(during(report, 16_000, 30_000, (sample) => sample.failed)).toBe(0);
    // The replica is the primary now, and there is no replica left.
    expect(nodeOf(report, 'db').detail).toEqual({ replicas: 0, primaryUp: 1 });
    expect(nodeOf(report, 'db').instances).toBe(1);
  });
});
