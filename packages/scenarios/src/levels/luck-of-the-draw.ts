import type { Design } from '@loadline/engine';
import { at, design, workload } from '../build.ts';
import type { Scenario } from '../types.ts';

/** How a balancer picks an instance. */
type Algorithm = Extract<Design['nodes'][number], { type: 'load-balancer' }>['params']['algorithm'];

const users = at(0, 1, { id: 'users', type: 'client', name: 'Users', params: { rps: 850 } } as const);
// Ten small instances: 2 calls at a time, 20 ms each, so 100 a second apiece and 1,000 together.
const api = at(2, 1, {
  id: 'api',
  type: 'service',
  name: 'API',
  params: { instances: 10, concurrency: 2, queue: 64, serviceTime: { kind: 'exp', mean: 20 } },
} as const);

/** The fleet behind a balancer that picks an instance in the given way. */
export const balanced = (algorithm: Algorithm) =>
  design(
    'Luck of the draw',
    [users, at(1, 1, { id: 'lb', type: 'load-balancer', name: 'Balancer', params: { algorithm, healthCheckMs: 1000 } }), api],
    [
      ['users', 'lb', { timeoutMs: 2000 }],
      ['lb', 'api'],
    ],
  );

export const luckOfTheDraw: Scenario = {
  id: 'luck-of-the-draw',
  text: {
    title: 'Luck of the draw',
    summary: 'Ten instances with room to spare, and requests still wait.',
    brief:
      'Ten small instances share 850 requests a second, and between them they can do 1,000. There is room. Yet one request in a ' +
      'hundred takes over 300 ms, for 20 ms of work. The balancer sends each call to an instance picked at random. ' +
      'Nothing may be added and nothing made bigger. Keep 99% of requests under 200 ms.',
    hints: [
      'Watch the ten gauges while it runs. Over a minute they are equally busy. Are they at any one moment?',
      'A call sent at random can land on an instance that is already full while its neighbour stands idle. What would the balancer have to know to do better?',
      'Select the Balancer and change how it picks an instance: to the least busy, or to the less busy of two.',
    ],
    debrief:
      'Nothing was short. Over a minute every instance was 85% busy, but an average hides the moment: picked at random, one ' +
      'instance gets three calls in a row while its neighbour gets none, and each has a queue of its own. ' +
      'Taking turns removes the luck from the choosing but not from the work: some calls take longer than others, and the next ' +
      'one still goes to an instance that is stuck. Looking is what helps. Comparing just two instances and taking the less ' +
      'busy gets most of the way; comparing all of them does best. Same servers, same load, and the slowest requests take a third as long.',
  },
  starter: balanced('random'),
  reference: balanced('least-connections'),
  palette: [],
  workload: workload({}),
  durationMs: 70_000,
  warmupMs: 10_000,
  seed: 1111,
  objectives: [
    { kind: 'p99', maxMs: 200 },
    { kind: 'errors', maxRate: 0.005 },
  ],
  bonus: [[{ kind: 'p99', maxMs: 150 }], [{ kind: 'p99', maxMs: 112 }]],
  locked: {
    users: '*',
    lb: [],
    api: '*',
    'users--lb': [],
    'lb--api': [],
  },
};
