import { at, design, workload } from '../build.ts';
import type { Link } from '../build.ts';
import type { Scenario } from '../types.ts';

const users = at(0, 1, { id: 'users', type: 'client', name: 'Users', params: { rps: 400 } } as const);
// Sixteen calls at a time, 30 ms each: about 530 a second, for 400.
const api = (queue: number) =>
  at(1, 1, {
    id: 'api',
    type: 'service',
    name: 'API',
    params: { concurrency: 16, queue, serviceTime: { kind: 'exp', mean: 30 } },
  } as const);

/** The system with a waiting room of `queue` calls at the API and a policy on the users' calls to it. */
export const system = (queue: number, policy: NonNullable<Link[2]>) =>
  design('Retry storm', [users, api(queue)], [['users', 'api', policy]]);

/** How the users call the API to begin with. */
export const impatient = { timeoutMs: 150, retries: 3, backoffMs: 0 };

export const retryStorm: Scenario = {
  id: 'retry-storm',
  text: {
    title: 'Retry storm',
    summary: 'A five-second hiccup that never ends.',
    brief:
      'The API runs comfortably at three quarters of what it can do. At twenty seconds it has a bad moment: five seconds of ' +
      'being three times slower. Then it is fine again, and yet the failures never stop. ' +
      'From thirty-five seconds on, keep failures under 2% and 99% of requests under 300 ms.',
    hints: [
      'After the bad moment is over, compare the requests users make with the calls the API receives.',
      'Every failed call is tried again at once, up to three times. What does that do to a service that is already behind?',
      'Retry less, or make the API turn calls away sooner: a waiting room short enough that whoever is let in is answered in time.',
    ],
    debrief:
      'While the API was slow, calls timed out and each was retried three times, at once. That is four times the traffic for a ' +
      'service that had fallen behind. The calls that timed out were still in its queue, and it worked through them for nobody ' +
      'while the retries queued behind. Every call now waited longer than the timeout, so every call was retried: the storm ' +
      'fed itself, long after its cause had gone. ' +
      'Waiting between retries, and randomising the wait, spreads them out but does not make them fewer. What ends a storm is ' +
      'less work: fewer retries, or a queue short enough that a call is refused while there is still time to answer it.',
  },
  starter: system(512, impatient),
  reference: system(8, { timeoutMs: 150, retries: 2, backoffMs: 50, backoffFactor: 2, jitter: 1 }),
  palette: [],
  workload: workload({
    chaos: [{ atMs: 20_000, command: { type: 'slow', nodeId: 'api', factor: 3, durationMs: 5000 } }],
  }),
  durationMs: 80_000,
  warmupMs: 35_000,
  seed: 505,
  objectives: [
    { kind: 'errors', maxRate: 0.02 },
    { kind: 'p99', maxMs: 300 },
  ],
  bonus: [[{ kind: 'errors', maxRate: 0.005 }], [{ kind: 'p99', maxMs: 150 }]],
  locked: {
    users: '*',
    api: ['instances', 'concurrency', 'serviceTime', 'autoscale.enabled'],
  },
};
