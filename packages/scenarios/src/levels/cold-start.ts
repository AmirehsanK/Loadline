import { at, design, workload } from '../build.ts';
import type { Scenario } from '../types.ts';

const DURATION_MS = 120_000;
/** A rush of twenty times the traffic, for five seconds, every twenty. */
const EVERY_MS = 20_000;
const RUSH_MS = 5000;
const RUSH = 20;

const rushes: { atMs: number; multiplier: number }[] = [];
for (let atMs = 10_000; atMs < DURATION_MS; atMs += EVERY_MS) {
  rushes.push({ atMs, multiplier: RUSH }, { atMs: atMs + RUSH_MS, multiplier: 1 });
}

/** Checkout as a function, with `provisioned` environments kept ready. */
export const checkout = (provisioned: number) =>
  design(
    'Cold start',
    [
      at(0, 1, { id: 'users', type: 'client', name: 'Shoppers', params: { rps: 10 } }),
      at(1, 1, {
        id: 'fn',
        type: 'function',
        name: 'Checkout',
        // An environment is let go eight seconds after its last call: well before the next rush.
        params: { maxConcurrency: 200, serviceTime: { kind: 'exp', mean: 50 }, coldStartMs: 800, keepWarmMs: 8000, provisioned },
      }),
    ],
    [['users', 'fn', { timeoutMs: 3000 }]],
  );

export const coldStart: Scenario = {
  id: 'cold-start',
  text: {
    title: 'Cold start',
    summary: 'A quiet shop, and a rush every twenty seconds that finds it asleep.',
    brief:
      'Checkout runs as a function: nothing is running until someone calls it. Ten shoppers a second is a quiet day, and every ' +
      'twenty seconds a rush of two hundred a second arrives for five. A call that finds no environment ready waits 800 ms for ' +
      'one to start, and the ones started for a rush have been let go by the next. Keep 99% of requests under 350 ms, for no ' +
      'more than $260 a month.',
    hints: [
      'Watch the response time as a rush begins. The work is 50 ms. The slow calls are the ones that waited for an environment to start.',
      'Select Checkout. "Environments kept ready" are never let go, so a call that gets one starts at once. They are paid for whether or not they are used.',
      'Two hundred a second at 50 ms each is ten calls in progress on average, and often more, because calls do not arrive evenly. Keep 18 ready: enough for the busy moments, and no more.',
    ],
    debrief:
      'A function scales by starting an environment for every call that cannot find one, which is instant to ask for and slow ' +
      'to get. In a rush that is worse than it sounds. Every call that arrives during the 800 ms the first ones take to start ' +
      'finds nothing ready either and starts its own, so the function starts several times the environments the rush goes on ' +
      'to need. Then it lets them go, in time for the next rush. Keeping environments ready buys those starts in advance. How ' +
      'many is the question the load line asks everywhere: not the average number of calls in progress, which is ten, but what ' +
      'the busy moments reach. Short of that, the slowest 1% are still cold starts and nothing looks any better. Past it, you ' +
      'pay for environments that only ever wait.',
  },
  starter: checkout(0),
  reference: checkout(18),
  palette: [],
  workload: workload({ phases: rushes }),
  durationMs: DURATION_MS,
  warmupMs: 5000,
  seed: 2020,
  objectives: [
    { kind: 'p99', maxMs: 350 },
    { kind: 'cost', maxMonthly: 260 },
  ],
  // Enough kept ready is a pass however many that is. The stars are for not keeping more.
  bonus: [[{ kind: 'cost', maxMonthly: 225 }], [{ kind: 'cost', maxMonthly: 190 }]],
  locked: {
    users: '*',
    fn: ['maxConcurrency', 'serviceTime', 'coldStartMs', 'keepWarmMs'],
  },
};
