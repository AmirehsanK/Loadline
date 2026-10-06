import { describe, expect, it } from 'vitest';
import type { Design, DesignInput } from '../src/index.ts';
import { during, fixed, nodeOf, run, system, windowsOf } from './helpers.ts';

type Links = Parameters<typeof system>[1];

const users = (fileRatio: number, rps = 400): NonNullable<DesignInput['nodes']>[number] => ({
  id: 'users',
  type: 'client',
  params: { rps, fileRatio, readRatio: 1, keys: 2000, skew: 1 },
});
const api = { id: 'api', type: 'service', params: { concurrency: 16, queue: 200, serviceTime: fixed(10) } } as const;
const bucket = { id: 'bucket', type: 'object-store', params: { readTime: fixed(40), writeTime: fixed(80) } } as const;
const cdn = { id: 'cdn', type: 'cdn', params: { capacity: 2000, ttlMs: 0 } } as const;

/** The API hands out the files itself, fetching each from the bucket. */
const filesThroughApi = (fileRatio: number): Design =>
  system([users(fileRatio), api, bucket], [
    ['users', 'api'],
    ['api', 'bucket', { appliesTo: 'file' }],
  ]);

/** A CDN at the door. `links` says where it sends what it does not hold. */
const behindCdn = (links: Links, fileRatio = 0.6): Design =>
  system([users(fileRatio), cdn, api, bucket], [['users', 'cdn'], ...links]);

const direct: Links = [
  ['cdn', 'api', { appliesTo: 'data' }],
  ['cdn', 'bucket', { appliesTo: 'file' }],
];

describe('requests for files', () => {
  it('are the share of the traffic the client is set to, and the rest is unchanged', () => {
    const { report } = run(filesThroughApi(0.25), { sendMs: 60_000, drainMs: 2000 });
    const share = nodeOf(report, 'bucket').arrivals / report.requests.created;
    expect(share).toBeGreaterThan(0.23);
    expect(share).toBeLessThan(0.27);
    expect(report.requests.ok).toBe(report.requests.created);
  });

  it('draw nothing from the streams a design without files uses', () => {
    // The same traffic with no files in it must be the traffic there was before files existed.
    const plain = system([{ id: 'users', type: 'client', params: { rps: 400, readRatio: 1, keys: 2000, skew: 1 } }, api], [
      ['users', 'api'],
    ]);
    const none = system([users(0), api], [['users', 'api']]);
    const a = run(plain, { sendMs: 10_000, drainMs: 1000 }).report;
    const b = run(none, { sendMs: 10_000, drainMs: 1000 }).report;
    expect(b.requests).toEqual(a.requests);
    expect(b.latency).toEqual(a.latency);
  });

  it('hold a slot of the service that fetches them for as long as the fetch takes', () => {
    // 400 a second, 10 ms of work each, is 4 slots of 16. Make 60% of them files that take another
    // 40 ms to fetch and the same traffic needs 13.6: the service is nearly full of waiting.
    const data = run(filesThroughApi(0), { sendMs: 60_000, drainMs: 2000 }).report;
    const files = run(filesThroughApi(0.6), { sendMs: 60_000, drainMs: 2000 }).report;
    expect(nodeOf(data, 'api').utilization).toBeLessThan(0.3);
    expect(nodeOf(files, 'api').utilization).toBeGreaterThan(0.8);
    expect(files.latency.p99).toBeGreaterThan(2 * data.latency.p99);
  });

  it('skip a cache of data on the way through a service', () => {
    const target = system(
      [users(0.5), api, { id: 'cache', type: 'cache' }, { id: 'db', type: 'database' }, bucket],
      [
        ['users', 'api'],
        ['api', 'cache'],
        ['api', 'db', { appliesTo: 'data' }],
        ['api', 'bucket', { appliesTo: 'file' }],
      ],
    );
    const { sim, report } = run(target, { sendMs: 20_000, drainMs: 2000 });
    const cache = nodeOf(report, 'cache');
    const files = nodeOf(report, 'bucket').arrivals;
    // Only the reads of data looked in the cache; no file was looked up, stored or removed.
    expect(cache.detail.hits! + cache.detail.misses!).toBe(report.requests.created - files);
    expect(cache.arrivals).toBe(report.requests.created - files + cache.detail.misses!);
    expect(report.requests.ok).toBe(report.requests.created);
    expect(sim.calls.live).toBe(0);
  });
});

describe('a CDN', () => {
  it('answers for the files it holds and fetches each of the others once', () => {
    const { sim, report } = run(behindCdn(direct), { sendMs: 60_000, drainMs: 2000 });
    const edge = nodeOf(report, 'cdn');
    const requested = edge.detail.hits! + edge.detail.misses!;

    expect(edge.arrivals).toBe(report.requests.created);
    expect(edge.detail.passed).toBe(report.requests.created - requested);
    // What it held never went further, and data never touched the bucket.
    expect(nodeOf(report, 'bucket').arrivals).toBe(edge.detail.misses);
    expect(nodeOf(report, 'api').arrivals).toBe(edge.detail.passed);
    // It can hold every file there is and never lets one go, so what it misses is the first
    // request for each file, and the few that came while that one was being fetched.
    expect(edge.detail.items).toBeLessThanOrEqual(2000);
    expect(edge.detail.hits! / requested).toBeGreaterThan(0.85);
    expect(report.requests.ok).toBe(report.requests.created);
    expect(sim.calls.live).toBe(0);
  });

  it('takes the files off the service that was serving them', () => {
    const before = run(filesThroughApi(0.6), { sendMs: 60_000, drainMs: 2000 }).report;
    const after = run(behindCdn(direct), { sendMs: 60_000, drainMs: 2000 }).report;
    expect(nodeOf(before, 'api').utilization).toBeGreaterThan(0.8);
    expect(nodeOf(after, 'api').utilization).toBeLessThan(0.15);
    // The slowest requests are now the files it had to fetch, which take the bucket's 40 ms and
    // wait for nobody.
    expect(before.latency.p99).toBeGreaterThan(60);
    expect(after.latency.p99).toBeLessThan(42);
  });

  it('sends a file by the connection for files whichever was drawn first', () => {
    const fileFirst = behindCdn([
      ['cdn', 'bucket', { appliesTo: 'file' }],
      ['cdn', 'api'],
    ]);
    const allFirst = behindCdn([
      ['cdn', 'api'],
      ['cdn', 'bucket', { appliesTo: 'file' }],
    ]);
    for (const target of [fileFirst, allFirst]) {
      const { report } = run(target, { sendMs: 20_000, drainMs: 2000 });
      const edge = nodeOf(report, 'cdn');
      expect(nodeOf(report, 'bucket').arrivals).toBe(edge.detail.misses);
      expect(nodeOf(report, 'api').arrivals).toBe(edge.detail.passed);
    }
  });

  it('fails what it has no connection for, and says where', () => {
    const { report } = run(behindCdn([['cdn', 'bucket', { appliesTo: 'file' }]]), { sendMs: 10_000, drainMs: 1000 });
    const edge = nodeOf(report, 'cdn');
    expect(report.requests.failed).toBe(edge.detail.passed);
    expect(report.blame).toEqual([{ cause: 'node-down', nodeId: 'cdn', where: null, count: edge.detail.passed }]);
  });

  it('lets go of what it has not been asked for lately when it is full', () => {
    const small: Design = system(
      [users(1), { id: 'cdn', type: 'cdn', params: { capacity: 100, ttlMs: 0 } }, bucket],
      [
        ['users', 'cdn'],
        ['cdn', 'bucket'],
      ],
    );
    const { report } = run(small, { sendMs: 60_000, drainMs: 2000 });
    const edge = nodeOf(report, 'cdn');
    const ratio = edge.detail.hits! / (edge.detail.hits! + edge.detail.misses!);
    expect(edge.detail.items).toBe(100);
    expect(edge.detail.evictions).toBeGreaterThan(0);
    // A twentieth of the files, but the ones most asked for: well over a twentieth of the traffic.
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(0.8);
  });

  it('asks for a file again once it has kept it for its lifetime', () => {
    const short: Design = system(
      [users(1), { id: 'cdn', type: 'cdn', params: { capacity: 2000, ttlMs: 5000 } }, bucket],
      [
        ['users', 'cdn'],
        ['cdn', 'bucket'],
      ],
    );
    const forever = run(behindCdn([['cdn', 'bucket']], 1), { sendMs: 60_000, drainMs: 2000 }).report;
    const { report } = run(short, { sendMs: 60_000, drainMs: 2000 });
    expect(nodeOf(report, 'cdn').detail.misses).toBeGreaterThan(3 * nodeOf(forever, 'cdn').detail.misses!);
  });

  describe('when it is emptied', () => {
    const purge = { chaos: [{ atMs: 30_000, command: { type: 'flush', nodeId: 'cdn' } as const }] };

    it('sends everything it held back to where the files come from', () => {
      const target = behindCdn(direct);
      const { report } = run(target, { sendMs: 60_000, drainMs: 2000, workload: purge });
      const store = windowsOf(target, report, 'bucket');
      const perSecond = (fromMs: number, toMs: number) =>
        report.samples.reduce((sum, sample, i) => (sample.t > fromMs && sample.t <= toMs ? sum + store[i]!.arrivals : sum), 0) /
        ((toMs - fromMs) / 1000);

      const settled = perSecond(20_000, 30_000);
      const justAfter = perSecond(30_000, 31_000);
      expect(justAfter).toBeGreaterThan(4 * settled);
      // The bucket has no slots to run out of, so nobody notices but the bill.
      expect(report.requests.ok).toBe(report.requests.created);
      expect(perSecond(50_000, 60_000)).toBeLessThan(justAfter / 4);
    });

    it('flattens a service that the files were being fetched through', () => {
      // What the CDN does not hold it asks the API for, which fetches it from the bucket. While
      // the CDN is full the API hardly sees a file; emptied, it sees all of them at once.
      const busy = { id: 'users', type: 'client', params: { rps: 1000, fileRatio: 0.9, readRatio: 1, keys: 5000, skew: 1 } } as const;
      const wide = { id: 'cdn', type: 'cdn', params: { capacity: 5000, ttlMs: 0 } } as const;
      const small = { ...api, params: { ...api.params, queue: 50 } };
      const through = system([busy, wide, small, bucket], [
        ['users', 'cdn'],
        ['cdn', 'api', { timeoutMs: 1000 }],
        ['api', 'bucket', { appliesTo: 'file' }],
      ]);
      const { report } = run(through, { sendMs: 60_000, drainMs: 2000, workload: purge });
      expect(during(report, 20_000, 30_000, (sample) => sample.failed)).toBe(0);
      expect(during(report, 30_000, 33_000, (sample) => sample.failed)).toBeGreaterThan(50);

      // Fetched straight from the bucket, the same emptying fails nobody.
      const straight = system([busy, wide, small, bucket], [['users', 'cdn'], ...direct]);
      const calm = run(straight, { sendMs: 60_000, drainMs: 2000, workload: purge }).report;
      expect(calm.requests.failed).toBe(0);
    });
  });

  it('comes back from being down holding nothing', () => {
    const target = behindCdn(direct);
    const outage = { chaos: [{ atMs: 30_000, command: { type: 'kill', nodeId: 'cdn', durationMs: 2000 } as const }] };
    const { sim, report } = run(target, { sendMs: 60_000, drainMs: 2000, workload: outage });
    const store = windowsOf(target, report, 'bucket');
    const at = (ms: number) => store[report.samples.findIndex((sample) => sample.t === ms)]!.arrivals;
    expect(report.requests.failedBy['node-down']).toBeGreaterThan(0);
    expect(at(33_000)).toBeGreaterThan(4 * at(29_000));
    expect(report.requests.created).toBe(report.requests.ok + report.requests.failed);
    expect(sim.calls.live).toBe(0);
  });
});

describe('an object store', () => {
  it('takes as long for a thousand at once as for one', () => {
    const fetch = (rps: number) => {
      const target = system([users(1, rps), bucket], [['users', 'bucket']]);
      return run(target, { sendMs: 20_000, drainMs: 1000 }).report;
    };
    const few = fetch(10);
    const many = fetch(20_000);
    expect(few.latency.p99).toBeCloseTo(40, 0);
    expect(many.latency.p99).toBeCloseTo(40, 0);
    expect(many.requests.ok).toBe(many.requests.created);
  });

  it('takes a file in more slowly than it hands one over', () => {
    const target = system(
      [{ id: 'users', type: 'client', params: { rps: 100, readRatio: 0 } }, bucket],
      [['users', 'bucket']],
    );
    const { report } = run(target, { sendMs: 10_000, drainMs: 1000 });
    expect(report.latency.p50).toBeCloseTo(80, 0);
  });

  it('loses what it was handing over when it goes down', () => {
    const target = system([users(1, 1000), bucket], [['users', 'bucket']]);
    const outage = { chaos: [{ atMs: 5000, command: { type: 'kill', nodeId: 'bucket', durationMs: 1000 } as const }] };
    const { sim, report } = run(target, { sendMs: 10_000, drainMs: 1000, workload: outage });
    expect(report.requests.failedBy['node-down']).toBeGreaterThan(900);
    expect(report.requests.created).toBe(report.requests.ok + report.requests.failed);
    expect(sim.calls.live).toBe(0);
  });
});
