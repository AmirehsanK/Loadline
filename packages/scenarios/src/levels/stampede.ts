import { at, design, ramp, workload } from '../build.ts';
import type { Scenario } from '../types.ts';

// A sale page: 1,500 reads a second, nearly all for the same forty products.
const users = at(0, 1, {
  id: 'users',
  type: 'client',
  name: 'Shoppers',
  params: { rps: 1500, readRatio: 1, keys: 40, skew: 1.2 },
} as const);
const api = at(1, 1, {
  id: 'api',
  type: 'service',
  name: 'Catalog',
  params: { concurrency: 2000, queue: 2000, serviceTime: { kind: 'const', mean: 1 } },
} as const);
// Eight cores and 40 ms a query: 200 a second, which is plenty while the cache is warm.
const db = at(3, 1, {
  id: 'db',
  type: 'database',
  name: 'Database',
  params: { concurrency: 8, maxConnections: 2000, readTime: { kind: 'const', mean: 40 } },
} as const);

/** The system with or without single flight on the cache, and a limit on connections to the database. */
export const catalog = (singleFlight: boolean, poolSize = 0) =>
  design(
    'Stampede',
    [users, api, at(2, 0, { id: 'cache', type: 'cache', name: 'Cache', params: { capacity: 100, ttlMs: 0, singleFlight } }), db],
    [
      ['users', 'api', { timeoutMs: 5000 }],
      ['api', 'cache', { timeoutMs: 50 }],
      ['api', 'db', { timeoutMs: 4000, poolSize }],
    ],
  );

export const stampede: Scenario = {
  id: 'stampede',
  text: {
    title: 'Stampede',
    summary: 'The cache is emptied at the height of the sale.',
    brief:
      'The cache answers nearly every request, so the database behind it is small and mostly idle. Twenty-five seconds in, ' +
      'at the height of the sale, a deploy empties the cache. The database cannot be made bigger. ' +
      'Through the seconds around it, keep 99% of requests under one second and failures under 0.5%.',
    hints: [
      'In the second after the cache is emptied, how many requests arrive for the most popular product, and how many of them go to the database?',
      'They all miss, and each fetches the same thing. Only one of them needs to.',
      'Select the cache and have it fetch a missing item once, for everyone waiting on it.',
    ],
    debrief:
      'When the cache was emptied, fifteen hundred requests a second all missed at once, nearly all for the same few products. ' +
      'Each went to the database for an answer that another request was already fetching. Hundreds of copies of the same ' +
      'forty queries on eight cores: each took seconds, and while they ran, every new request missed too. ' +
      'Letting one request fetch each missing item, with the rest waiting for it, turns that into forty queries. ' +
      'A pool on the database connection is a second defence: it keeps the queries that do arrive at full speed.',
  },
  starter: catalog(false),
  reference: catalog(true, 8),
  palette: [],
  // Traffic starts as a trickle, so the cache fills before the crowd arrives.
  workload: workload({
    phases: [{ atMs: 0, multiplier: 0.05 }, ...ramp(5000, 15_000, 0.05, 1)],
    chaos: [{ atMs: 25_000, command: { type: 'flush', nodeId: 'cache' } }],
  }),
  // Only the seconds around the flush are scored, so that one bad second shows in the result.
  durationMs: 35_000,
  warmupMs: 23_000,
  seed: 707,
  objectives: [
    { kind: 'p99', maxMs: 1000 },
    { kind: 'errors', maxRate: 0.005 },
  ],
  // Two stars for fetching each item once, three for also keeping the database at full speed.
  bonus: [[{ kind: 'p99', maxMs: 150 }], [{ kind: 'p99', maxMs: 10 }]],
  locked: {
    users: '*',
    api: '*',
    db: '*',
    cache: ['capacity'],
    'api--cache': [],
    'api--db': [],
  },
};
