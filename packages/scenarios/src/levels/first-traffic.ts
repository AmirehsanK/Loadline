import { at, design, ramp, workload } from '../build.ts';
import type { Scenario } from '../types.ts';

const users = at(0, 1, { id: 'users', type: 'client', name: 'Users', params: { rps: 100 } } as const);
// One instance does 8 calls at a time, 40 ms each: about 200 a second.
const api = (instances: number) =>
  at(2, 1, {
    id: 'api',
    type: 'service',
    name: 'API',
    params: { instances, concurrency: 8, queue: 64, serviceTime: { kind: 'exp', mean: 40 } },
  } as const);

/** The API with a number of instances, called directly or through a load balancer. */
export const fleet = (instances: number, balanced: boolean) =>
  balanced
    ? design(
        'First traffic',
        [users, at(1, 1, { id: 'lb', type: 'load-balancer', name: 'Balancer' }), api(instances)],
        [
          ['users', 'lb', { timeoutMs: 2000 }],
          ['lb', 'api'],
        ],
      )
    : design('First traffic', [users, api(instances)], [['users', 'api', { timeoutMs: 2000 }]]);

export const firstTraffic: Scenario = {
  id: 'first-traffic',
  text: {
    title: 'First traffic',
    brief:
      'Your API got through launch day. Now traffic is climbing to 300 requests a second, and one instance can do about 200. ' +
      'Keep 99% of requests under 500 ms and failures under 1%, for no more than $140 a month.',
    hints: [
      'Watch the gauge on the API as traffic rises. What happens to the waiting once it passes the load line?',
      'More instances only help if something spreads the calls over them.',
      'Put a load balancer between Users and the API, and give the API two instances.',
    ],
    debrief:
      'One instance could do 200 requests a second and 300 arrived, so a third were turned away. A second instance doubles what the ' +
      'service can carry, but only a load balancer makes it useful: without one, every call still lands on the first. ' +
      'Notice that waiting did not grow in step with load. At 75% busy it is barely there; close to 100% it grows without limit. ' +
      'That curve is why systems are run with room to spare.',
  },
  starter: fleet(1, false),
  reference: fleet(2, true),
  palette: ['load-balancer'],
  workload: workload({ phases: [{ atMs: 0, multiplier: 1.2 }, ...ramp(15_000, 30_000, 1.2, 3)] }),
  durationMs: 75_000,
  warmupMs: 30_000,
  seed: 101,
  objectives: [
    { kind: 'p99', maxMs: 500 },
    { kind: 'errors', maxRate: 0.01 },
    { kind: 'cost', maxMonthly: 140 },
  ],
  bonus: [[{ kind: 'cost', maxMonthly: 100 }], [{ kind: 'p99', maxMs: 260 }]],
  locked: {
    users: '*',
    api: ['concurrency', 'serviceTime', 'autoscale.enabled'],
  },
};
