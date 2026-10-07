import { at, design, workload } from '../build.ts';
import type { Link } from '../build.ts';
import type { Scenario } from '../types.ts';

interface Shape {
  /** Whether posts go straight from People to Photos, on a connection kept for them. */
  direct?: boolean;
  instances?: number;
  /** How long a post that goes straight to Photos is given. */
  timeoutMs?: number;
  /** Connections the API may have open to Photos at once; 0 is no limit. */
  pool?: number;
}

// Nine requests in ten look at the feed. One in ten sends a photo in.
const people = at(0, 1, {
  id: 'users',
  type: 'client',
  name: 'People',
  params: {
    rps: 300,
    routes: [
      { name: 'feed', weight: 9, readRatio: 1 },
      { name: 'post', weight: 1, uploadRatio: 1 },
    ],
  },
} as const);

/** The photo app, with posts carried by the API or sent straight to storage. */
export const app = ({ direct = false, instances = 2, timeoutMs = 3000, pool = 0 }: Shape = {}) => {
  const straight: Link[] = direct ? [['users', 'bucket', { route: 'post', timeoutMs }]] : [];
  return design(
    'Slow lane',
    [
      people,
      at(1, 1, { id: 'lb', type: 'load-balancer', name: 'Balancer' }),
      at(2, 1, {
        id: 'api',
        type: 'service',
        name: 'API',
        params: { instances, concurrency: 8, queue: 64, serviceTime: { kind: 'exp', mean: 15 } },
      }),
      at(3, 2, { id: 'db', type: 'database', name: 'Feed', params: { concurrency: 16, readTime: { kind: 'exp', mean: 5 } } }),
      at(3, 0, { id: 'bucket', type: 'object-store', name: 'Photos', params: { writeTime: { kind: 'lognormal', mean: 400, cv: 1 } } }),
    ],
    [
      ['users', 'lb', { timeoutMs: 3000 }],
      ['lb', 'api'],
      ['api', 'db', { appliesTo: 'data', timeoutMs: 1000 }],
      ['api', 'bucket', { appliesTo: 'file', timeoutMs: 5000, poolSize: pool }],
      ...straight,
    ],
  );
};

export const slowLane: Scenario = {
  id: 'slow-lane',
  text: {
    title: 'Slow lane',
    summary: 'One request in ten is a photo coming in, and it holds up the other nine.',
    brief:
      'A photo app gets 300 requests a second. Nine in ten look at the feed, which is quick. One in ten posts a photo, and the ' +
      'API holds a slot for the 400 ms or so that storage takes to take it in. Half-way through, storage turns three times ' +
      'slower for twenty seconds. Keep 99% of feed requests under 200 ms and failures of every kind under 1%, for no more than ' +
      '$340 a month, which is about what it costs now.',
    hints: [
      'Look at what API is busy with. Thirty posts a second, each holding a slot for nearly half a second, is most of its sixteen slots, and the feed waits behind them.',
      'A post does not need the API to carry it. People can have a second connection, kept for one route. Draw one from People to Photos and set its "Route" to post.',
      'With the posts gone, one instance of API is enough for the feed. And a post that goes straight to storage holds nobody up, so it can be given time: set "Give up after" on the new connection to 10,000 ms.',
    ],
    debrief:
      'The feed was never slow. It was queuing behind uploads, which took twenty times as long and shared its slots. More ' +
      'instances buy room until the day uploads slow down, and then the room is gone again, because what a slow request costs ' +
      'is slots multiplied by time. Giving the slow route its own way in ends that: nothing that happens to an upload can ' +
      'reach the feed any more. A wall like that is called a bulkhead, and the direct upload is how most apps build this one, ' +
      'with the API only handing out permission. It also changes what a timeout is for. Through the API, a patient upload held ' +
      'a slot that others needed, so patience was expensive. In a lane of its own it holds nothing, and three seconds was only ' +
      'a way of failing uploads that were about to finish.',
    rules: {
      'feed-by-api': 'Only posts may go straight to Photos. The feed has to be made by the API.',
    },
  },
  starter: app(),
  reference: app({ direct: true, instances: 1, timeoutMs: 10_000 }),
  palette: [],
  workload: workload({ chaos: [{ atMs: 50_000, command: { type: 'slow', nodeId: 'bucket', factor: 3, durationMs: 20_000 } }] }),
  durationMs: 100_000,
  warmupMs: 10_000,
  seed: 2121,
  objectives: [
    { kind: 'p99', maxMs: 200, route: 'feed' },
    { kind: 'errors', maxRate: 0.01 },
    { kind: 'cost', maxMonthly: 340 },
  ],
  // A lane of its own passes. The stars are for what it allows: an instance the feed never needed,
  // and patience with uploads now that it costs nobody else anything.
  bonus: [[{ kind: 'cost', maxMonthly: 300 }], [{ kind: 'errors', maxRate: 0.005, route: 'post' }]],
  locked: {
    users: '*',
    db: '*',
    bucket: '*',
    api: ['concurrency', 'queue', 'serviceTime', 'autoscale'],
    // A post that reaches the API has to be stored; cutting this would lose it and call that success.
    'api--bucket': ['appliesTo', 'route', 'mode'],
  },
  rules: (candidate) => {
    const allowed = candidate.edges.every(
      (edge) => edge.from !== 'users' || edge.to === 'lb' || (edge.to === 'bucket' && edge.params.route === 'post'),
    );
    return allowed ? [] : ['feed-by-api'];
  },
};
