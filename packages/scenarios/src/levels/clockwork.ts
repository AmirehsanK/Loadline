import { at, design, workload } from '../build.ts';
import type { Scenario } from '../types.ts';

// A price list: 2,000 reads a second over 100 products, so each is asked for twenty times a second.
const users = at(0, 1, {
  id: 'users',
  type: 'client',
  name: 'Shoppers',
  params: { rps: 2000, readRatio: 1, keys: 100, skew: 0 },
} as const);
const api = at(1, 1, {
  id: 'api',
  type: 'service',
  name: 'Prices',
  params: { concurrency: 2000, queue: 4000, serviceTime: { kind: 'const', mean: 1 } },
} as const);
// Four cores and 40 ms a query: 100 a second, many times what a warm cache leaves it.
const db = at(3, 1, {
  id: 'db',
  type: 'database',
  name: 'Database',
  params: { concurrency: 4, maxConnections: 4000, readTime: { kind: 'const', mean: 40 } },
} as const);

export interface Lifetimes {
  /** Share of each item's lifetime that is randomised. */
  jitter?: number;
  /** Connections to the database; 0 is no limit. */
  pool?: number;
}

/** The system with the cache's lifetimes randomised or not, and optionally the other defences. */
export const priced = ({ jitter = 0, pool = 0 }: Lifetimes) =>
  design(
    'Clockwork',
    [
      users,
      api,
      at(2, 0, { id: 'cache', type: 'cache', name: 'Cache', params: { capacity: 200, ttlMs: 20_000, ttlJitter: jitter, singleFlight: true } }),
      db,
    ],
    [
      ['users', 'api', { timeoutMs: 5000 }],
      ['api', 'cache', { timeoutMs: 50 }],
      ['api', 'db', { timeoutMs: 4000, poolSize: pool }],
    ],
  );

export const clockwork: Scenario = {
  id: 'clockwork',
  text: {
    title: 'Clockwork',
    summary: 'Every twenty seconds, to the second, the site stumbles.',
    brief:
      'Prices may be at most twenty seconds old, so the cache keeps each for exactly that long. It already fetches a missing ' +
      'price only once. And still, every twenty seconds, to the second, the site stumbles. ' +
      'The database and the way the service calls it belong to another team. The cache is yours. Keep 99% of requests under 200 ms.',
    hints: [
      'Watch the database across a whole minute. When does it work, and for how long does it rest?',
      'All hundred prices were fetched in the same moment, when the site started. When will they all be twenty seconds old?',
      'Select the Cache and randomise the lifetimes, by a fifth or so. A price then lives between sixteen and twenty seconds, and no two for quite the same time.',
    ],
    debrief:
      'The hundred prices were all fetched in the first moment, so they all turned twenty seconds old in the same moment and ' +
      'were all fetched again together: a hundred queries at once, on a database that is otherwise asked for five a second, ' +
      'and nothing answered until they were done. Then the same again twenty seconds later, for ever, because fetching them ' +
      'together is what kept them together. Fetching each price once did not help, since these were a hundred different prices. ' +
      'Randomising each lifetime a little breaks the rhythm. The first time round they spread over a few seconds, the next ' +
      'time over more, and soon the database sees a trickle instead of a wave. Things that are stored together expire ' +
      'together, unless you arrange otherwise.',
  },
  starter: priced({}),
  reference: priced({ jitter: 0.2 }),
  palette: [],
  workload: workload({}),
  durationMs: 110_000,
  // The first filling of the cache is not scored; the five expiries after it are.
  warmupMs: 15_000,
  seed: 1515,
  objectives: [
    { kind: 'p99', maxMs: 200 },
    { kind: 'errors', maxRate: 0.005 },
  ],
  bonus: [[{ kind: 'p99', maxMs: 50 }], [{ kind: 'p99', maxMs: 10 }]],
  locked: {
    users: '*',
    api: '*',
    db: '*',
    cache: ['capacity', 'ttlMs', 'singleFlight'],
    'api--cache': '*',
    'api--db': '*',
  },
};
