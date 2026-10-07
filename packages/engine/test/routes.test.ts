import { describe, expect, it } from 'vitest';
import { createSimulation, lintDesign } from '../src/index.ts';
import type { Design, DesignInput, Report } from '../src/index.ts';
import { fixed, nodeOf, run, system } from './helpers.ts';

type Routes = NonNullable<NonNullable<Extract<NonNullable<DesignInput['nodes']>[number], { type: 'client' }>['params']>['routes']>;

const people = (routes: Routes, rps = 200) => ({ id: 'users', type: 'client', params: { rps, readRatio: 1, routes } }) as const;
const service = (id: string, concurrency = 64, workMs = 10) =>
  ({ id, type: 'service', params: { concurrency, queue: 100, serviceTime: fixed(workMs) } }) as const;
const routeOf = (report: Report, name: string) => {
  const found = report.routes?.find((route) => route.name === name);
  if (!found) throw new Error(`no route "${name}" in the report`);
  return found;
};
const codes = (target: Design) => lintDesign(target).map((issue) => `${issue.level}:${issue.code}`);

const browse = { name: 'browse', weight: 9 };
const search = { name: 'search', weight: 1 };

describe('routes', () => {
  it('divide a client’s requests by their weights, and are reported one by one', () => {
    const target = system([people([browse, search]), service('api')], [['users', 'api']]);
    const { report } = run(target, { sendMs: 60_000, drainMs: 1000 });
    const shares = report.routes!.map((route) => (route.ok + route.failed) / report.requests.created);
    expect(report.routes!.map((route) => route.name)).toEqual(['browse', 'search']);
    expect(shares[0]).toBeGreaterThan(0.88);
    expect(shares[0]).toBeLessThan(0.92);
    // Every request came in by one route or the other.
    expect(routeOf(report, 'browse').ok + routeOf(report, 'search').ok).toBe(report.requests.ok);
  });

  it('are not in the report of a design that has none', () => {
    const target = system([{ id: 'users', type: 'client', params: { rps: 100 } }, service('api')], [['users', 'api']]);
    const { sim, report } = run(target, { sendMs: 5000, drainMs: 1000 });
    expect('routes' in report).toBe(false);
    expect('routes' in sim.score()).toBe(false);
  });

  it('each have a mix of their own, in place of the client’s', () => {
    const target = system(
      [
        {
          id: 'users',
          type: 'client',
          // The client's own mix says every request is for a file. With routes it is not asked.
          params: { rps: 200, fileRatio: 1, routes: [{ name: 'read', weight: 1, readRatio: 1 }, { name: 'post', weight: 1, uploadRatio: 1 }] },
        },
        service('api'),
        { id: 'bucket', type: 'object-store', params: { readTime: fixed(5), writeTime: fixed(50) } },
      ],
      [
        ['users', 'api'],
        ['api', 'bucket', { appliesTo: 'file' }],
      ],
    );
    const { report } = run(target, { sendMs: 30_000, drainMs: 1000 });
    const posts = routeOf(report, 'post');
    expect(nodeOf(report, 'bucket').arrivals).toBe(posts.ok);
    // A read is the service's 10 ms; a post is that and the 50 ms the store takes to take a file in.
    expect(routeOf(report, 'read').p99).toBeCloseTo(10, 0);
    expect(posts.p50).toBeCloseTo(60, 0);
  });

  it('can each have connections kept for them inside the system', () => {
    const target = system(
      [people([browse, search]), service('api'), service('index', 64, 30), service('catalog', 64, 5)],
      [
        ['users', 'api'],
        ['api', 'index', { route: 'search' }],
        ['api', 'catalog', { route: 'browse' }],
      ],
    );
    const { report } = run(target, { sendMs: 30_000, drainMs: 1000 });
    expect(nodeOf(report, 'index').arrivals).toBe(routeOf(report, 'search').ok);
    expect(nodeOf(report, 'catalog').arrivals).toBe(routeOf(report, 'browse').ok);
    expect(routeOf(report, 'search').p50).toBeCloseTo(40, 0);
    expect(routeOf(report, 'browse').p50).toBeCloseTo(15, 0);
  });

  it('can each come in at a part of their own', () => {
    const target = system(
      [people([browse, search]), service('shop'), service('finder', 64, 30)],
      [
        ['users', 'shop', { route: 'browse' }],
        ['users', 'finder', { route: 'search' }],
      ],
    );
    expect(codes(target)).toEqual([]);
    const { sim, report } = run(target, { sendMs: 30_000, drainMs: 1000 });
    expect(nodeOf(report, 'shop').arrivals).toBe(routeOf(report, 'browse').ok);
    expect(nodeOf(report, 'finder').arrivals).toBe(routeOf(report, 'search').ok);
    expect(report.requests.ok).toBe(report.requests.created);
    expect(sim.calls.live).toBe(0);
  });

  it('take the connection for their route in preference to one for everything, whichever was drawn first', () => {
    for (const links of [
      [['users', 'shop'], ['users', 'finder', { route: 'search' }]],
      [['users', 'finder', { route: 'search' }], ['users', 'shop']],
    ] as Parameters<typeof system>[1][]) {
      const target = system([people([browse, search]), service('shop'), service('finder')], links);
      const { report } = run(target, { sendMs: 10_000, drainMs: 1000 });
      expect(nodeOf(report, 'finder').arrivals).toBe(routeOf(report, 'search').ok);
      expect(nodeOf(report, 'shop').arrivals).toBe(routeOf(report, 'browse').ok);
    }
  });

  it('fail, and say where, when no connection takes them', () => {
    const target = system([people([browse, search]), service('shop')], [['users', 'shop', { route: 'browse' }]]);
    expect(codes(target)).toEqual(['warning:route-unconnected']);
    const { sim, report } = run(target, { sendMs: 10_000, drainMs: 1000 });
    const lost = routeOf(report, 'search');
    expect(lost.ok).toBe(0);
    expect(lost.failed).toBeGreaterThan(100);
    expect(report.blame).toEqual([{ cause: 'node-down', nodeId: 'users', where: null, count: lost.failed }]);
    expect(report.requests.created).toBe(report.requests.ok + report.requests.failed);
    expect(sim.calls.live).toBe(0);
  });

  it('are scored over the scored period like everything else', () => {
    const target = system([people([browse, search]), service('api')], [['users', 'api']]);
    const sim = createSimulation(target, { seed: 1, scoreFromMs: 10_000 });
    sim.advance(20_000);
    const scored = sim.score().routes!;
    const whole = sim.routeTotals();
    expect(scored.map((route) => route.name)).toEqual(['browse', 'search']);
    // Half the run is warm-up, so about half of each route's requests are scored.
    scored.forEach((route, index) => {
      expect(route.ok / whole[index]!.ok).toBeGreaterThan(0.4);
      expect(route.ok / whole[index]!.ok).toBeLessThan(0.6);
    });
    expect(scored[0]!.ok + scored[1]!.ok).toBe(sim.score().ok);
  });

  it('take on new weights while the run is in progress', () => {
    const target = system([people([browse, search]), service('api')], [['users', 'api']]);
    const { sim } = run(target, { sendMs: 10_000 });
    const before = sim.routeTotals().map((route) => route.ok);
    sim.reconfigure({
      ...target,
      nodes: target.nodes.map((node) =>
        node.type === 'client' ? { ...node, params: { ...node.params, routes: [{ ...node.params.routes[0]!, weight: 0 }, node.params.routes[1]!] } } : node,
      ),
    });
    sim.advance(11_000);
    const settled = sim.routeTotals().map((route) => route.ok);
    sim.advance(20_000);
    const after = sim.routeTotals().map((route) => route.ok);
    expect(before[0]).toBeGreaterThan(1000);
    // Browse has stopped; everything now comes in by search.
    expect(after[0]).toBe(settled[0]);
    expect(after[1]! - settled[1]!).toBeGreaterThan(1500);
  });

  describe('that share a service', () => {
    // Search is a tenth of the traffic and waits a second and a half on its index each time.
    const slowIndex = service('index', 200, 1500);
    const shared = system([people([browse, search], 100), service('api', 16, 10), slowIndex], [
      ['users', 'api'],
      ['api', 'index', { route: 'search' }],
    ]);
    const apart = system([people([browse, search], 100), service('api', 16, 10), service('finder', 32, 10), slowIndex], [
      ['users', 'api', { route: 'browse' }],
      ['users', 'finder', { route: 'search' }],
      ['finder', 'index'],
    ]);

    it('share its slots, so a slow one holds up a quick one', () => {
      const { report } = run(shared, { sendMs: 60_000, drainMs: 5000 });
      // Ten searches a second, each holding a slot for a second and a half, want fifteen of the
      // sixteen. Browsing, which is 10 ms of work, waits behind them.
      expect(nodeOf(report, 'api').utilization).toBeGreaterThan(0.85);
      expect(routeOf(report, 'browse').p99).toBeGreaterThan(200);
    });

    it('stop doing so when each comes in at a service of its own', () => {
      const { report } = run(apart, { sendMs: 60_000, drainMs: 5000 });
      expect(routeOf(report, 'browse').p99).toBeLessThan(20);
      // Search is no quicker for it. It was never the one being held up.
      expect(routeOf(report, 'search').p50).toBeCloseTo(1510, -1);
      expect(report.requests.failed).toBe(0);
    });
  });
});

describe('the lint, on routes', () => {
  it('refuses two connections from a client for the same requests, and takes two for different ones', () => {
    const nodes = [people([browse, search]), service('a'), service('b')];
    expect(codes(system(nodes, [['users', 'a'], ['users', 'b']]))).toContain('error:client-fan-out');
    expect(codes(system(nodes, [['users', 'a', { route: 'browse' }], ['users', 'b', { route: 'browse' }]]))).toContain('error:client-fan-out');
    expect(codes(system(nodes, [['users', 'a', { route: 'browse' }], ['users', 'b', { route: 'search' }]]))).toEqual([]);
    expect(codes(system(nodes, [['users', 'a', { appliesTo: 'data' }], ['users', 'b', { appliesTo: 'file' }]]))).toEqual([]);
  });

  it('refuses two routes of one name, and remarks on a connection for a route nobody has', () => {
    expect(codes(system([people([browse, browse]), service('a')], [['users', 'a']]))).toContain('error:duplicate-route');
    expect(codes(system([people([browse]), service('a'), service('b')], [['users', 'a'], ['a', 'b', { route: 'checkout' }]]))).toEqual([
      'warning:unknown-route',
    ]);
  });
});

describe('a file sent in', () => {
  const posting = (rps = 100) => ({ id: 'users', type: 'client', params: { rps, uploadRatio: 1 } }) as const;
  const bucket = { id: 'bucket', type: 'object-store', params: { readTime: fixed(40), writeTime: fixed(300) } } as const;

  it('takes an object store the time it takes to take a file in', () => {
    const { report } = run(system([posting(), bucket], [['users', 'bucket']]), { sendMs: 10_000, drainMs: 1000 });
    expect(report.latency.p50).toBeCloseTo(300, 0);
    expect(report.requests.ok).toBe(report.requests.created);
  });

  it('is a file to a connection: kept off one for data, and sent by one for files', () => {
    const target = system([posting(), service('api'), { id: 'db', type: 'database' }, bucket], [
      ['users', 'api'],
      ['api', 'db', { appliesTo: 'data' }],
      ['api', 'bucket', { appliesTo: 'file' }],
    ]);
    const { report } = run(target, { sendMs: 10_000, drainMs: 1000 });
    expect(nodeOf(report, 'db').arrivals).toBe(0);
    expect(nodeOf(report, 'bucket').arrivals).toBe(report.requests.created);
  });

  it('holds a slot of a service it is sent through for as long as it takes', () => {
    // Twenty a second at 300 ms each is six slots held, of eight, for 10 ms of work apiece.
    const target = system([posting(20), service('api', 8), bucket], [
      ['users', 'api'],
      ['api', 'bucket', { appliesTo: 'file' }],
    ]);
    const { report } = run(target, { sendMs: 60_000, drainMs: 2000 });
    expect(nodeOf(report, 'api').utilization).toBeGreaterThan(0.7);
  });

  it('goes through a CDN, which drops the copy it held of what has just been replaced', () => {
    const target = system(
      [
        // One file, fetched over and over, and now and then sent in again.
        { id: 'users', type: 'client', params: { rps: 100, fileRatio: 0.98, uploadRatio: 0.02, keys: 1 } },
        { id: 'cdn', type: 'cdn', params: { ttlMs: 0 } },
        bucket,
      ],
      [
        ['users', 'cdn'],
        ['cdn', 'bucket'],
      ],
    );
    const { sim, report } = run(target, { sendMs: 60_000, drainMs: 2000 });
    const edge = nodeOf(report, 'cdn');
    const uploads = edge.detail.passed!;
    expect(uploads).toBeGreaterThan(60);
    // It never lets the file go by itself, so every miss after the first follows an upload. Some
    // uploads follow one another with no fetch in between, and some fetches come while the first
    // after an upload is still on its way, so the two counts are near and not equal.
    expect(edge.detail.misses).toBeGreaterThan(uploads * 0.5);
    expect(edge.detail.misses).toBeLessThan(uploads * 8);
    expect(nodeOf(report, 'bucket').arrivals).toBe(uploads + edge.detail.misses!);
    expect(report.requests.ok).toBe(report.requests.created);
    expect(sim.calls.live).toBe(0);
  });

  it('is a write to a database, and passes a cache of data by', () => {
    const target = system(
      [posting(), service('api'), { id: 'cache', type: 'cache' }, { id: 'db', type: 'database', params: { concurrency: 64, readTime: fixed(5), writeTime: fixed(40) } }],
      [
        ['users', 'api'],
        ['api', 'cache'],
        ['api', 'db'],
      ],
    );
    const { report } = run(target, { sendMs: 10_000, drainMs: 1000 });
    expect(nodeOf(report, 'cache').arrivals).toBe(0);
    expect(report.latency.p50).toBeCloseTo(50, 0);
  });
});
