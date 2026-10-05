import { at, design, workload } from '../build.ts';
import type { Link, NodeInput } from '../build.ts';
import type { Scenario } from '../types.ts';

// 450 requests a second, nearly all reads, over 20,000 items with a few favourites.
const users = at(0, 1, {
  id: 'users',
  type: 'client',
  name: 'Readers',
  params: { rps: 450, readRatio: 0.95, keys: 20_000, skew: 1 },
} as const);
const api = at(1, 1, {
  id: 'api',
  type: 'service',
  name: 'API',
  params: { concurrency: 64, queue: 128, serviceTime: { kind: 'const', mean: 2 } },
} as const);
// Four cores and 12 ms a query: about 330 a second at full speed.
const db = at(3, 1, {
  id: 'db',
  type: 'database',
  name: 'Database',
  params: { concurrency: 4, maxConnections: 200, readTime: { kind: 'exp', mean: 12 }, writeTime: { kind: 'exp', mean: 12 } },
} as const);

const toDb: Link = ['api', 'db', { timeoutMs: 1000, poolSize: 4 }];
const withCache = (capacity: number): [NodeInput[], Link[]] => [
  [users, api, at(2, 0, { id: 'cache', type: 'cache', name: 'Cache', params: { capacity, ttlMs: 60_000 } }), db],
  [['users', 'api', { timeoutMs: 2000 }], ['api', 'cache', { timeoutMs: 50 }], toDb],
];

/** The system with a cache of `capacity` items in front of the database. */
export const cached = (capacity: number) => design('Read-heavy', ...withCache(capacity));

export const readHeavy: Scenario = {
  id: 'read-heavy',
  text: {
    title: 'Read-heavy',
    brief:
      'Most of your traffic is people reading the same popular pages, and every read goes to a database that can do about 330 ' +
      'queries a second. 450 arrive. The database is as big as it is going to get. ' +
      'Keep 99% of requests under 300 ms and failures under 1%, for no more than $320 a month.',
    hints: [
      'How many of those reads are for an item that was read a moment ago?',
      'A cache in front of the database answers repeat reads without touching it.',
      'Add a cache and connect the API to it. A cache of a few thousand items is enough: most requests are for a few favourites.',
    ],
    debrief:
      'The database was asked for more than it could do, and a bigger one was not on offer. But a few items get most of the ' +
      'traffic, so a cache holding a tenth of them answers most reads by itself, and the database is left with about a third of ' +
      'the load. A miss costs a little more than before, because the cache is asked first; a hit costs almost nothing. ' +
      'The cache was empty when the run began: watch the first seconds again, and you will see the database carry everything ' +
      'until it fills.',
  },
  starter: design('Read-heavy', [users, api, db], [['users', 'api', { timeoutMs: 2000 }], toDb]),
  reference: cached(2000),
  palette: ['cache'],
  workload: workload({}),
  durationMs: 70_000,
  warmupMs: 20_000,
  seed: 202,
  objectives: [
    { kind: 'p99', maxMs: 300 },
    { kind: 'errors', maxRate: 0.01 },
    { kind: 'cost', maxMonthly: 320 },
  ],
  bonus: [[{ kind: 'cost', maxMonthly: 310 }], [{ kind: 'p99', maxMs: 120 }]],
  locked: {
    users: '*',
    api: ['instances', 'concurrency', 'serviceTime', 'autoscale.enabled'],
    db: '*',
    'api--db': [],
  },
};
