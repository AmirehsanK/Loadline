import { at, design, workload } from '../build.ts';
import type { Scenario } from '../types.ts';

const users = at(0, 1, { id: 'users', type: 'client', name: 'Users', params: { rps: 300, readRatio: 0.9 } } as const);
const api = at(1, 1, {
  id: 'api',
  type: 'service',
  name: 'API',
  params: { concurrency: 128, queue: 256, serviceTime: { kind: 'const', mean: 1 } },
} as const);
// Four cores and 10 ms a query: 400 a second at full speed, and 300 are asked for.
const db = at(2, 1, {
  id: 'db',
  type: 'database',
  name: 'Database',
  params: { concurrency: 4, maxConnections: 500, readTime: { kind: 'const', mean: 10 }, writeTime: { kind: 'const', mean: 10 } },
} as const);

/** The system with the API limited to `poolSize` connections to the database; 0 is no limit. */
export const pooled = (poolSize: number) =>
  design('Pool party', [users, api, db], [
    ['users', 'api', { timeoutMs: 3000 }],
    ['api', 'db', { timeoutMs: 2000, poolSize }],
  ]);

export const poolParty: Scenario = {
  id: 'pool-party',
  text: {
    title: 'Pool party',
    summary: 'A database with room to spare that is somehow flat out.',
    brief:
      'The database can run 400 queries a second and is being asked for 300, so there should be room. Yet requests are failing ' +
      'and the database is flat out. Nothing may be added and nothing made bigger. ' +
      'Keep 99% of requests under 150 ms and failures under 1%.',
    hints: [
      'Look at the database while it runs. How many queries does it have going at once, and how many cores?',
      'The API opens as many connections as it likes. What would happen if it could not?',
      'Select the connection from the API to the database and limit its connections per instance to about the number of cores the database has.',
    ],
    debrief:
      'The database has four cores. Give it four queries and each takes 10 ms. Give it forty and they share those cores, each ' +
      'taking ten times as long and a little more for getting in each other\'s way, so the database finishes less work than ' +
      'before. One burst was enough to push it over, and it never recovered. ' +
      'A small pool makes the waiting happen in the API, in order, where it costs nothing, and keeps the database at full ' +
      'speed. The best size is the number of cores plus one: a connection is also busy while its query is on the network, so ' +
      'exactly four leaves a core idle now and then. A pool that is too small is its own problem. Try two, and watch the API ' +
      'starve while the database sits half idle.',
  },
  starter: pooled(0),
  reference: pooled(5),
  palette: [],
  workload: workload({}),
  durationMs: 70_000,
  warmupMs: 10_000,
  seed: 303,
  objectives: [
    { kind: 'p99', maxMs: 150 },
    { kind: 'errors', maxRate: 0.01 },
    { kind: 'cost', maxMonthly: 490 },
  ],
  bonus: [[{ kind: 'p99', maxMs: 110 }], [{ kind: 'p99', maxMs: 80 }]],
  locked: {
    users: '*',
    api: ['instances', 'concurrency', 'serviceTime', 'autoscale.enabled'],
    db: '*',
    'api--db': [],
  },
};
