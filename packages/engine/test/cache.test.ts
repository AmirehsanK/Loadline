import { describe, expect, it } from 'vitest';
import type { CacheNode, CommandInput, Design } from '../src/index.ts';
import { during, exp, fixed, nodeOf, run, system, windowsOf } from './helpers.ts';

type CacheParams = Partial<CacheNode['params']>;

interface Shape {
  rps?: number;
  readRatio?: number;
  keys?: number;
  skew?: number;
  cache?: CacheParams;
  /** Queries the database runs at full speed at once. */
  cores?: number;
}

/** A service that reads through a cache to a database. */
function readThrough(shape: Shape = {}): Design {
  return system(
    [
      {
        id: 'users',
        type: 'client',
        params: { rps: shape.rps ?? 500, readRatio: shape.readRatio ?? 1, keys: shape.keys ?? 10_000, skew: shape.skew ?? 1 },
      },
      { id: 'api', type: 'service', params: { concurrency: 2000, queue: 10_000, serviceTime: fixed(1) } },
      { id: 'cache', type: 'cache', params: { capacity: 1000, ttlMs: 0, ...shape.cache } },
      {
        id: 'db',
        type: 'database',
        params: { concurrency: shape.cores ?? 64, maxConnections: 5000, readTime: exp(5), writeTime: exp(5) },
      },
    ],
    [
      ['users', 'api'],
      ['api', 'cache'],
      ['api', 'db'],
    ],
  );
}

const hitRatio = (detail: Record<string, number>) => detail.hits! / (detail.hits! + detail.misses!);

describe('a cache', () => {
  it('answers a hit itself and passes a miss on to the store behind it', () => {
    const { sim, report } = run(readThrough(), { sendMs: 30_000, drainMs: 2000 });
    const cache = nodeOf(report, 'cache');
    const db = nodeOf(report, 'db');

    expect(cache.detail.hits! + cache.detail.misses!).toBe(report.requests.created);
    // Every miss reads the database once, and then stores what it found.
    expect(db.arrivals).toBe(cache.detail.misses);
    expect(cache.arrivals).toBe(report.requests.created + cache.detail.misses!);
    expect(report.requests.ok).toBe(report.requests.created);
    expect(sim.calls.live).toBe(0);
  });

  it('hits as often as its size and the spread of the traffic allow', { timeout: 60_000 }, () => {
    const ratio = (shape: Shape) => {
      const target = readThrough(shape);
      const { report } = run(target, { sendMs: 240_000 });
      // Leave out the first minute, while it fills.
      const windows = windowsOf(target, report, 'cache').slice(60);
      const hits = windows.reduce((sum, window) => sum + window.hits, 0);
      const misses = windows.reduce((sum, window) => sum + window.misses, 0);
      return hits / (hits + misses);
    };

    // When every item is equally likely, a cache holding a tenth of them hits a tenth of the time.
    expect(ratio({ skew: 0, cache: { capacity: 1000 } })).toBeCloseTo(0.1, 2);
    // Real traffic favours a few items, so the same cache does far better.
    const skewed = ratio({ skew: 1, cache: { capacity: 1000 } });
    expect(skewed).toBeGreaterThan(0.6);
    expect(skewed).toBeLessThan(0.77);
    expect(ratio({ skew: 1, cache: { capacity: 100 } })).toBeLessThan(skewed - 0.15);
    // Room for everything still misses each item the first time it is asked for, and the rare
    // ones keep turning up for a long while.
    expect(ratio({ skew: 1, cache: { capacity: 10_000 } })).toBeGreaterThan(0.93);
  });

  it('starts empty, and the store carries the load until it has filled', () => {
    const target = readThrough({ cache: { capacity: 10_000 } });
    const { report } = run(target, { sendMs: 120_000 });
    const db = windowsOf(target, report, 'db');
    const cache = windowsOf(target, report, 'cache');

    expect(cache[0]!.hits / (cache[0]!.hits + cache[0]!.misses)).toBeLessThan(0.5);
    expect(db[0]!.arrivals).toBeGreaterThan(250);
    expect(db[110]!.arrivals).toBeLessThan(db[0]!.arrivals / 4);
    expect(cache[110]!.hits / (cache[110]!.hits + cache[110]!.misses)).toBeGreaterThan(0.9);
  });

  it('forgets an item when it is written', () => {
    const readOnly = nodeOf(run(readThrough({ cache: { capacity: 10_000 } }), { sendMs: 120_000 }).report, 'cache');
    const mixed = nodeOf(run(readThrough({ readRatio: 0.5, cache: { capacity: 10_000 } }), { sendMs: 120_000 }).report, 'cache');
    expect(hitRatio(mixed.detail)).toBeLessThan(hitRatio(readOnly.detail) - 0.2);
  });

  it('forgets an item when its time is up', () => {
    const forever = nodeOf(run(readThrough({ cache: { capacity: 10_000 } }), { sendMs: 120_000 }).report, 'cache');
    const brief = nodeOf(run(readThrough({ cache: { capacity: 10_000, ttlMs: 2000 } }), { sendMs: 120_000 }).report, 'cache');
    expect(hitRatio(brief.detail)).toBeLessThan(hitRatio(forever.detail) - 0.1);
    expect(brief.detail.evictions).toBe(0);
  });

  it('pushes out the least recently used item when it is full', () => {
    const cache = nodeOf(run(readThrough({ cache: { capacity: 200 } }), { sendMs: 60_000 }).report, 'cache');
    expect(cache.detail.items).toBe(200);
    expect(cache.detail.evictions).toBeGreaterThan(1000);
  });
});

describe('a stampede', () => {
  // The cache normally answers nearly everything, so the database is sized for the little that
  // gets past it. Then the cache is emptied.
  const flush: CommandInput = { type: 'flush', nodeId: 'cache' };
  const stampede = (cache: CacheParams) => {
    const target = readThrough({ rps: 2000, keys: 5000, skew: 1.1, cores: 4, cache: { capacity: 5000, ...cache } });
    const { report } = run(target, { sendMs: 90_000, workload: { chaos: [{ atMs: 60_000, command: flush }] } });
    return { target, report };
  };

  it('hits the store with everything at once when the cache is emptied', () => {
    const { target, report } = stampede({});
    const db = windowsOf(target, report, 'db');
    const before = during(report, 50_000, 60_000, (sample) => sample.p99) / 10;
    const after = Math.max(...report.samples.filter((sample) => sample.t > 60_000 && sample.t <= 65_000).map((s) => s.p99));

    // Before: a trickle the database handles in passing. In the second after: fifty times that,
    // far more than it can run at once, and everybody waits.
    expect(db[58]!.arrivals).toBeLessThan(30);
    expect(db[60]!.arrivals).toBeGreaterThan(db[58]!.arrivals * 30);
    expect(db[61]!.queued).toBeGreaterThan(100);
    expect(before).toBeLessThan(5);
    expect(after).toBeGreaterThan(1000);
    // The popular items are fetched first, so it passes: within fifteen seconds it is over.
    expect(db[75]!.arrivals).toBeLessThan(150);
    expect(report.samples[75]!.p99).toBeLessThan(50);
    expect(report.requests.failed).toBe(0);
  });

  it('is an outage, unless one call fetches each missing item for everyone waiting on it', () => {
    // A few very popular items and a slow store: while the first read of an item is still out,
    // dozens more requests for the same item arrive. Without sharing, each of them reads it too.
    const outcome = (singleFlight: boolean) => {
      const target = system(
        [
          { id: 'users', type: 'client', params: { rps: 2000, readRatio: 1, keys: 200, skew: 1.2 } },
          { id: 'api', type: 'service', params: { concurrency: 5000, queue: 10_000, serviceTime: fixed(1) } },
          { id: 'cache', type: 'cache', params: { capacity: 200, ttlMs: 0, singleFlight } },
          { id: 'db', type: 'database', params: { concurrency: 16, maxConnections: 5000, readTime: fixed(50) } },
        ],
        [
          ['users', 'api'],
          ['api', 'cache'],
          ['api', 'db'],
        ],
      );
      const { sim, report } = run(target, { sendMs: 40_000, drainMs: 20_000, workload: { chaos: [{ atMs: 30_000, command: flush }] } });
      expect(sim.calls.live).toBe(0);
      return { report, db: nodeOf(report, 'db') };
    };
    const alone = outcome(false);
    const shared = outcome(true);

    // Sharing reads each of the 200 items once after the cache is emptied, give or take: a request
    // can still slip in between the read coming back and the item reaching the cache. One second
    // is slow, and nothing fails.
    expect(during(shared.report, 30_000, 40_000, (sample) => sample.nodes[3]!.arrivals)).toBeLessThan(220);
    expect(shared.report.requests.failed).toBe(0);
    expect(shared.db.maxQueued).toBeLessThan(200);
    expect(shared.report.samples[32]!.p99).toBeLessThan(10);

    // Without it the cache never gets to fill in the first place. Every request misses and adds
    // one more query to cores that are already shared thousands of ways, so no query finishes for
    // half a minute, and what cannot even be queued is turned away.
    expect(alone.db.maxQueued).toBeGreaterThan(4000);
    expect(during(alone.report, 0, 20_000, (sample) => sample.ok)).toBeLessThan(100);
    expect(alone.report.requests.failed).toBeGreaterThan(alone.report.requests.created * 0.3);
  });

  it('repeats on its own when items that were stored together expire together', () => {
    // With a fixed lifetime, the items loaded in the first seconds all expire in the same seconds,
    // again and again. Randomising each lifetime spreads them out.
    const worst = (ttlJitter: number) => {
      const target = readThrough({ rps: 2000, keys: 2000, skew: 0.6, cache: { capacity: 2000, ttlMs: 20_000, ttlJitter } });
      const { report } = run(target, { sendMs: 110_000 });
      return Math.max(...windowsOf(target, report, 'db').slice(30).map((window) => window.arrivals));
    };
    expect(worst(0)).toBeGreaterThan(worst(0.5) * 1.5);
  });
});

describe('a cache that goes down', () => {
  it('counts as a miss, so the store takes every read', () => {
    const target = readThrough({ cache: { capacity: 10_000 } });
    const chaos = [{ atMs: 60_000, command: { type: 'kill', nodeId: 'cache', durationMs: 20_000 } as const }];
    const { report } = run(target, { sendMs: 120_000, drainMs: 2000, workload: { chaos } });
    const db = windowsOf(target, report, 'db');

    expect(db[55]!.arrivals).toBeLessThan(150);
    expect(db[70]!.arrivals).toBeGreaterThan(400);
    // Nothing fails: the database has room. And it comes back empty, so it has to fill again.
    expect(report.requests.failed).toBe(0);
    expect(db[81]!.arrivals).toBeGreaterThan(db[55]!.arrivals * 1.5);
    expect(db[115]!.arrivals).toBeLessThan(200);
  });
});
