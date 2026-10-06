import { at, design, workload } from '../build.ts';
import type { Link } from '../build.ts';
import type { Scenario } from '../types.ts';

const users = at(0, 1, { id: 'users', type: 'client', name: 'Users', params: { rps: 200, readRatio: 1 } } as const);
const site = at(1, 1, {
  id: 'api',
  type: 'service',
  name: 'Site',
  params: { concurrency: 512, queue: 512, serviceTime: { kind: 'const', mean: 2 } },
} as const);
// Healthy but uneven: half its answers take under 40 ms, one in a hundred takes a third of a second.
// Fourteen at a time at 60 ms on average is 233 a second, for 200.
const search = at(2, 1, {
  id: 'search',
  type: 'service',
  name: 'Search',
  params: { concurrency: 14, queue: 256, serviceTime: { kind: 'lognormal', mean: 60, cv: 1.2 } },
} as const);

/** The system with a policy on the site's calls to search. */
export const searching = (policy: NonNullable<Link[2]>) =>
  design('Patience', [users, site, search], [
    ['users', 'api', { timeoutMs: 5000 }],
    ['api', 'search', policy],
  ]);

/** How the site calls search to begin with. */
export const hasty = { timeoutMs: 100, retries: 2, backoffMs: 0 };

export const patience: Scenario = {
  id: 'patience',
  text: {
    title: 'Patience',
    summary: 'A healthy service, and a caller that will not wait for it.',
    brief:
      'Search is healthy but uneven: half its answers take under 40 ms, and one in a hundred takes a third of a second. ' +
      'The site gives each call 100 ms and then tries again, up to twice. Search belongs to another team and cannot be changed. ' +
      'Keep failures under 0.5% and 99% of requests under 800 ms.',
    hints: [
      'Run it and compare what users ask for with the calls Search receives. Where do the extra calls come from?',
      'How long does a healthy answer from Search take, at its slowest? And how long is the site prepared to wait?',
      'Select the connection from Site to Search and give it time for the slow answers: a timeout well past a third of a second.',
    ],
    debrief:
      'Nothing was wrong with Search. About one answer in six takes longer than 100 ms, and the site called each of those a ' +
      'failure and asked again, while Search went on working on the first. That extra work was enough to fill it. Then every ' +
      'answer was late, every call was retried, and it never recovered: a storm with no cause but a number. ' +
      'In Slow dependency the timeout was too long for a service that had turned slow. Here it was too short for one that was ' +
      'fine. A timeout belongs just past the slowest answer a healthy service gives: long enough for its tail, short enough to ' +
      'notice when something is really wrong. Set that way the retries are harmless, because they are rare.',
  },
  starter: searching(hasty),
  reference: searching({ ...hasty, timeoutMs: 600 }),
  palette: [],
  workload: workload({}),
  durationMs: 70_000,
  warmupMs: 10_000,
  seed: 1212,
  objectives: [
    { kind: 'errors', maxRate: 0.005 },
    { kind: 'p99', maxMs: 800 },
  ],
  bonus: [[{ kind: 'p99', maxMs: 600 }], [{ kind: 'p99', maxMs: 450 }]],
  locked: {
    users: '*',
    api: '*',
    search: '*',
    'users--api': '*',
    'api--search': ['appliesTo', 'mode'],
  },
};
