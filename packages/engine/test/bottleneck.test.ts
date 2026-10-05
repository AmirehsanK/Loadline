import { describe, expect, it } from 'vitest';
import { findBottleneck, summarize } from '../src/index.ts';
import type { Bottleneck, Design } from '../src/index.ts';
import type { RunInput } from './helpers.ts';
import { exp, fixed, run, system } from './helpers.ts';

/** Where the time went between `fromS` and `toS` seconds into a run. */
function bottleneck(target: Design, input: RunInput, fromS: number, toS: number): Bottleneck | null {
  const { report } = run(target, input);
  const period = summarize(report.samples.slice(fromS, toS));
  return period ? findBottleneck(target, period) : null;
}

const pooled = (poolSize: number) =>
  system(
    [
      { id: 'users', type: 'client', params: { rps: 340, readRatio: 1 } },
      { id: 'api', type: 'service', params: { concurrency: 200, queue: 256, serviceTime: fixed(1) } },
      { id: 'db', type: 'database', params: { concurrency: 4, maxConnections: 500, readTime: fixed(10) } },
    ],
    [
      ['users', 'api'],
      ['api', 'db', { timeoutMs: 2000, poolSize }],
    ],
  );

describe('finding the bottleneck', () => {
  it('follows the waiting to the service whose slots are full, however far back that is', () => {
    const target = system(
      [
        { id: 'users', type: 'client', params: { rps: 150 } },
        { id: 'web', type: 'service', params: { concurrency: 500, serviceTime: fixed(2) } },
        { id: 'api', type: 'service', params: { concurrency: 500, serviceTime: fixed(3) } },
        { id: 'store', type: 'service', params: { concurrency: 2, queue: 1000, serviceTime: exp(15) } },
      ],
      [
        ['users', 'web', { timeoutMs: 1000 }],
        ['web', 'api'],
        ['api', 'store'],
      ],
    );
    const found = bottleneck(target, { sendMs: 60_000 }, 20, 60);
    expect(found).toMatchObject({ nodeId: 'store', kind: 'saturated', path: ['web', 'api', 'store'] });
    expect(found!.utilization).toBeGreaterThan(0.99);
  });

  it('says the pool, not the database, when callers are waiting for a connection', () => {
    expect(bottleneck(pooled(2), { sendMs: 60_000 }, 20, 60)).toMatchObject({
      nodeId: 'api',
      kind: 'pool',
      edgeId: 'api-db',
      path: ['api'],
    });
  });

  it('says the database is contended when it has been given more than it can run', () => {
    const found = bottleneck(pooled(0), { sendMs: 60_000 }, 20, 60);
    expect(found).toMatchObject({ nodeId: 'db', kind: 'contended', path: ['api', 'db'] });
  });

  it('points at the work itself when nothing is short', () => {
    const found = bottleneck(pooled(4), { sendMs: 60_000 }, 20, 60);
    // The database is busy but keeping up; the time is the 10 ms each query takes.
    expect(found).toMatchObject({ nodeId: 'db', kind: 'work' });

    const idle = system(
      [
        { id: 'users', type: 'client', params: { rps: 50 } },
        { id: 'api', type: 'service', params: { concurrency: 64, serviceTime: fixed(30) } },
        { id: 'db', type: 'database', params: { readTime: fixed(2), writeTime: fixed(2) } },
      ],
      [
        ['users', 'api'],
        ['api', 'db'],
      ],
    );
    expect(bottleneck(idle, { sendMs: 30_000 }, 5, 30)).toMatchObject({ nodeId: 'api', kind: 'work', path: ['api'] });
  });

  it('passes through a load balancer to the service behind it, and notices when that is gone', () => {
    const target = system(
      [
        { id: 'users', type: 'client', params: { rps: 300 } },
        { id: 'lb', type: 'load-balancer', params: { healthCheckMs: 1000 } },
        { id: 'api', type: 'service', params: { instances: 2, concurrency: 2, queue: 500, serviceTime: exp(15) } },
      ],
      [
        ['users', 'lb', { timeoutMs: 2000 }],
        ['lb', 'api'],
      ],
    );
    expect(bottleneck(target, { sendMs: 30_000 }, 10, 30)).toMatchObject({
      nodeId: 'api',
      kind: 'saturated',
      path: ['lb', 'api'],
    });

    const chaos = [{ atMs: 10_000, command: { type: 'kill', nodeId: 'api', count: 2 } as const }];
    expect(bottleneck(target, { sendMs: 30_000, workload: { chaos } }, 15, 30)).toMatchObject({ nodeId: 'api', kind: 'down' });
  });

  it('follows a slow dependency that has slots to spare', () => {
    const target = system(
      [
        { id: 'users', type: 'client', params: { rps: 20 } },
        { id: 'api', type: 'service', params: { concurrency: 500, serviceTime: fixed(5) } },
        { id: 'payments', type: 'service', params: { concurrency: 500, serviceTime: fixed(10) } },
      ],
      [
        ['users', 'api'],
        ['api', 'payments'],
      ],
    );
    const chaos = [{ atMs: 5000, command: { type: 'slow', nodeId: 'payments', factor: 100 } as const }];
    expect(bottleneck(target, { sendMs: 30_000, workload: { chaos } }, 10, 30)).toMatchObject({
      nodeId: 'payments',
      kind: 'work',
      path: ['api', 'payments'],
    });
  });

  it('has nothing to say when no traffic flows', () => {
    const target = system(
      [
        { id: 'users', type: 'client', params: { rps: 0 } },
        { id: 'api', type: 'service' },
      ],
      [['users', 'api']],
    );
    expect(bottleneck(target, { sendMs: 5000 }, 0, 5)).toBeNull();
    expect(summarize([])).toBeUndefined();
  });
});
