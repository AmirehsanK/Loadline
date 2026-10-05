import { at, design, workload } from '../build.ts';
import type { Scenario } from '../types.ts';

export interface Sizes {
  api: number;
  cache: number;
  cores: number;
  replicas: number;
  workers: number;
}

// 600 requests a second, one in ten a write, and half as much again at the busiest part of the day.
const users = at(0, 1.5, {
  id: 'users',
  type: 'client',
  name: 'Users',
  params: { rps: 600, readRatio: 0.9, keys: 5000, skew: 1 },
} as const);

/** The system with each part at a given size. */
export const system = ({ api, cache, cores, replicas, workers }: Sizes) =>
  design(
    'The bill',
    [
      users,
      at(1, 1.5, { id: 'lb', type: 'load-balancer', name: 'Balancer', params: { healthCheckMs: 2000 } }),
      at(2, 1.5, {
        id: 'api',
        type: 'service',
        name: 'API',
        params: { instances: api, concurrency: 12, queue: 64, serviceTime: { kind: 'exp', mean: 10 } },
      }),
      at(3, 0.5, { id: 'cache', type: 'cache', name: 'Cache', params: { capacity: cache, ttlMs: 20_000 } }),
      at(3, 1.5, {
        id: 'db',
        type: 'database',
        name: 'Database',
        params: {
          concurrency: cores,
          maxConnections: 500,
          replicas,
          readTime: { kind: 'exp', mean: 15 },
          writeTime: { kind: 'exp', mean: 20 },
        },
      }),
      at(3, 2.5, { id: 'jobs', type: 'queue', name: 'Emails to send' }),
      at(4, 2.5, {
        id: 'mailer',
        type: 'worker',
        name: 'Mailer',
        params: { instances: workers, concurrency: 4, serviceTime: { kind: 'exp', mean: 60 } },
      }),
    ],
    [
      ['users', 'lb', { timeoutMs: 2000 }],
      ['lb', 'api', { timeoutMs: 1500 }],
      ['api', 'cache', { timeoutMs: 50 }],
      ['api', 'db', { timeoutMs: 800 }],
      ['api', 'jobs', { mode: 'async', appliesTo: 'write' }],
      ['jobs', 'mailer'],
    ],
  );

export const theBill: Scenario = {
  id: 'the-bill',
  text: {
    title: 'The bill',
    brief:
      'Nothing is wrong with this system. It is fast, nothing fails, and it costs $1,987 a month, because every part of it ' +
      'was sized by someone who never wanted to be paged. ' +
      'Cut the bill to $1,000 without giving anything up, through the busiest part of the day: failures under 0.5%, ' +
      '99% of requests under 200 ms, and no email lost or left unsent.',
    hints: [
      'Run it and look at the gauges. Which parts are nowhere near their load line?',
      'A part that is 5% busy can be much smaller. Check each one: instances, cores, replicas, items, workers. Size for the busiest minute, not the average one.',
      'The database is the largest line on the bill and is almost idle. Eight cores and no replicas still leave it room.',
    ],
    debrief:
      'Every part had room for many times the load it carried, and you were paying for all of it. Sizing is the same ' +
      'question each time: how busy is it at its busiest, and how busy can it be before waiting starts to grow? ' +
      'Around the load line is the answer for most parts. ' +
      'Two are different. The mailer reads from a queue, so it only has to keep up on average: the queue holds the ' +
      'peak and the mailer catches up afterwards. ' +
      'And the cache is not sized by load at all, but by how many of the items it holds; once it holds them all, more room buys nothing.',
  },
  starter: system({ api: 8, cache: 50_000, cores: 32, replicas: 2, workers: 6 }),
  reference: system({ api: 2, cache: 5000, cores: 8, replicas: 0, workers: 2 }),
  palette: [],
  workload: workload({ phases: [{ atMs: 40_000, multiplier: 1.5 }, { atMs: 60_000, multiplier: 1 }] }),
  durationMs: 100_000,
  warmupMs: 20_000,
  seed: 1010,
  objectives: [
    { kind: 'cost', maxMonthly: 1000 },
    { kind: 'errors', maxRate: 0.005 },
    { kind: 'p99', maxMs: 200 },
    { kind: 'lost', max: 0 },
    { kind: 'backlog', maxDepth: 50 },
  ],
  bonus: [[{ kind: 'cost', maxMonthly: 600 }], [{ kind: 'cost', maxMonthly: 400 }]],
  // Every part stays; only its size is the player's to change.
  locked: {
    users: '*',
    lb: [],
    api: ['concurrency', 'serviceTime', 'autoscale.enabled'],
    cache: ['ttlMs'],
    db: ['readTime', 'writeTime'],
    jobs: [],
    mailer: ['concurrency', 'serviceTime', 'failureRate'],
    'users--lb': [],
    'lb--api': [],
    'api--cache': [],
    'api--db': [],
    'api--jobs': ['mode', 'appliesTo'],
    'jobs--mailer': [],
  },
};
