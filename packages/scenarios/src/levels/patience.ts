import { at, design, workload } from '../build.ts';
import type { Link } from '../build.ts';
import type { Scenario } from '../types.ts';

const users = at(0, 1, { id: 'users', type: 'client', name: 'Users', params: { rps: 1000, readRatio: 1 } } as const);
const site = at(1, 1, {
  id: 'api',
  type: 'service',
  name: 'Site',
  params: { concurrency: 2048, queue: 2048, serviceTime: { kind: 'const', mean: 2 } },
} as const);
// Healthy but very uneven: half its answers take under 30 ms, and one in a hundred takes over half
// a second. Seventy-two at a time at 60 ms on average is 1,200 a second, for 1,000.
const search = at(2, 1, {
  id: 'search',
  type: 'service',
  name: 'Search',
  params: { concurrency: 72, queue: 256, serviceTime: { kind: 'lognormal', mean: 60, cv: 2 } },
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
      'Search is healthy but very uneven: half its answers take under 30 ms, and one in a hundred takes over half a second. ' +
      'The site gives each call 100 ms and then tries again, up to twice. Search belongs to another team and cannot be changed. ' +
      'Keep failures under 0.5% and 99% of requests under 800 ms.',
    hints: [
      'Run it and compare what users ask for with the calls Search receives. Where do the extra calls come from?',
      'How long does a healthy answer from Search take, when it is slow? And how long is the site prepared to wait?',
      'Select the connection from Site to Search and give it time for nearly all the answers: about 300 ms. Keep the retries. Much longer still passes, and waits for answers that asking again would have brought sooner.',
    ],
    debrief:
      'Nothing was wrong with Search. About one answer in six takes longer than 100 ms, and the site called each of those a ' +
      'failure and asked again, while Search went on working on the first. That extra work was enough to fill it. Then every ' +
      'answer was late, every call was retried, and it never recovered: a storm with no cause but a number. ' +
      'In Slow dependency the timeout was too long for a service that had turned slow. Here it was too short for one that was ' +
      'fine. But the cure is not to wait for ever. The slowest answers from Search take half a second and more, and a request ' +
      'that has already waited 300 ms will usually get its answer sooner by asking again than by waiting. A timeout belongs ' +
      'just past the point where nearly all healthy answers have arrived: late enough that retries are rare and cheap, early ' +
      'enough to give up on the few that are not worth waiting for.',
  },
  starter: searching(hasty),
  reference: searching({ ...hasty, timeoutMs: 300 }),
  palette: [],
  workload: workload({}),
  durationMs: 70_000,
  warmupMs: 10_000,
  seed: 1212,
  objectives: [
    { kind: 'errors', maxRate: 0.005 },
    { kind: 'p99', maxMs: 800 },
  ],
  // Any timeout past the storm passes. The stars are for not waiting for the slowest answers either,
  // when asking again would be quicker.
  bonus: [[{ kind: 'p99', maxMs: 470 }], [{ kind: 'p99', maxMs: 375 }]],
  locked: {
    users: '*',
    api: '*',
    search: '*',
    'users--api': '*',
    'api--search': ['appliesTo', 'mode'],
  },
};
