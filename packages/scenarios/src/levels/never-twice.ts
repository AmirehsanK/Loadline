import { at, design, workload } from '../build.ts';
import type { Link, NodeInput } from '../build.ts';
import type { Scenario } from '../types.ts';

// 400 requests a second, nine in ten of them reads, over a million items that are asked for evenly:
// hardly any item is read twice.
const users = at(0, 1, {
  id: 'users',
  type: 'client',
  name: 'Searchers',
  params: { rps: 400, readRatio: 0.9, keys: 1_000_000, skew: 0 },
} as const);
const api = at(1, 1, {
  id: 'api',
  type: 'service',
  name: 'API',
  params: { concurrency: 64, queue: 128, serviceTime: { kind: 'const', mean: 2 } },
} as const);
// Four cores and 12 ms a query: about 330 a second for each server.
const db = (replicas: number) =>
  at(3, 1, {
    id: 'db',
    type: 'database',
    name: 'Database',
    params: { concurrency: 4, maxConnections: 500, replicas, readTime: { kind: 'exp', mean: 12 }, writeTime: { kind: 'exp', mean: 12 } },
  } as const);

export interface Copies {
  replicas: number;
  /** Connections the API may hold to the database; 0 is no limit. */
  pool?: number;
  /** A cache of this many items in front of the database. */
  cache?: number;
}

/** The system with a number of read replicas, and optionally a pool or a cache. */
export const copies = ({ replicas, pool = 0, cache }: Copies) => {
  const nodes: NodeInput[] = [users, api, db(replicas)];
  const links: Link[] = [['users', 'api', { timeoutMs: 2000 }]];
  if (cache !== undefined) {
    nodes.push(at(2, 0, { id: 'cache', type: 'cache', name: 'Cache', params: { capacity: cache, ttlMs: 60_000 } }));
    links.push(['api', 'cache', { timeoutMs: 50 }]);
  }
  links.push(['api', 'db', { timeoutMs: 1000, poolSize: pool }]);
  return design('Never twice', nodes, links);
};

export const neverTwice: Scenario = {
  id: 'never-twice',
  text: {
    title: 'Never twice',
    summary: 'A database that cannot keep up, and nothing worth remembering.',
    brief:
      'People search a million documents, and hardly anyone asks for the same one twice. 360 reads and 40 writes arrive every ' +
      'second, and one database server can run about 330 queries a second. Its servers cannot be made bigger, but there can be ' +
      'more of them. Keep 99% of requests under 200 ms and failures under 1%, for no more than $500 a month.',
    hints: [
      'A cache answers a read that was made a moment ago. How often does that happen here?',
      'A read replica is a second server that answers reads. Once there is one, all the reads go to the replicas and the first server keeps the writes. Is one replica enough for 360 reads a second?',
      'Select the Database and give it two read replicas. Then remember Pool party: limit the connections from the API to about ten, now that there are more cores to keep busy.',
    ],
    debrief:
      'A cache remembers answers, and here there was nothing worth remembering: a million items asked for evenly means almost ' +
      'every read is new. When reads do not repeat, the way to serve more of them is more servers that can answer them. ' +
      'Replicas do that for reads only. Every write still goes to the one primary, which is why this works for a load that is ' +
      'mostly reading. One replica was a trap: it takes all the reads from the primary, and 360 a second is as much too many ' +
      'for it as 400 was for the primary. And the lesson of Pool party did not go away. More servers mean more cores, so the ' +
      'right pool is larger than it was, but without one a burst can still tip a replica over.',
  },
  starter: copies({ replicas: 0 }),
  reference: copies({ replicas: 2, pool: 10 }),
  palette: ['cache'],
  workload: workload({}),
  durationMs: 70_000,
  warmupMs: 10_000,
  seed: 1414,
  objectives: [
    { kind: 'p99', maxMs: 200 },
    { kind: 'errors', maxRate: 0.01 },
    { kind: 'cost', maxMonthly: 500 },
  ],
  bonus: [[{ kind: 'p99', maxMs: 120 }], [{ kind: 'p99', maxMs: 90 }]],
  locked: {
    users: '*',
    api: ['instances', 'concurrency', 'serviceTime', 'autoscale.enabled'],
    db: ['concurrency', 'readTime', 'writeTime'],
    'api--db': [],
  },
};
