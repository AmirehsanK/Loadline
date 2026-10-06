import { at, design, workload } from '../build.ts';
import type { Link } from '../build.ts';
import type { Scenario } from '../types.ts';

const users = at(0, 1, { id: 'users', type: 'client', name: 'Users', params: { rps: 100 } } as const);
// Web does 60 ms of work of its own on every request before it calls the API. A retry by the user
// repeats that work; a retry by Web does not.
const web = at(1, 1, {
  id: 'web',
  type: 'service',
  name: 'Web',
  params: { concurrency: 512, queue: 512, serviceTime: { kind: 'const', mean: 60 } },
} as const);
// Fifteen calls at a time, 40 ms each: 375 a second, for 100.
const api = at(2, 1, {
  id: 'api',
  type: 'service',
  name: 'API',
  params: { concurrency: 15, queue: 256, serviceTime: { kind: 'exp', mean: 40 } },
} as const);

/**
 * The system with a number of retries at each of its two layers, and anything else to add to the
 * policy of either. Neither layer waits between retries unless it is told to.
 */
export const layered = (atTheEdge: number, inside: number, edge: NonNullable<Link[2]> = {}, inner: NonNullable<Link[2]> = {}) =>
  design('Nine times', [users, web, api], [
    ['users', 'web', { timeoutMs: 1000, retries: atTheEdge, backoffMs: 0, ...edge }],
    ['web', 'api', { timeoutMs: 150, retries: inside, backoffMs: 0, ...inner }],
  ]);

export const nineTimes: Scenario = {
  id: 'nine-times',
  text: {
    title: 'Nine times',
    summary: 'Two layers, each careful enough to try three times.',
    brief:
      'Users call Web, and Web does its own work and then calls the API. Each layer was written by someone careful: if a call ' +
      'fails, it tries twice more. At twenty seconds the API has a bad five seconds. It recovers, with room for nearly four ' +
      'times its normal load, and the failures never stop. The timeouts are fixed. ' +
      'From thirty-five seconds on, keep failures under 0.3% and 99% of requests under 400 ms.',
    hints: [
      'After the bad moment, compare the requests users make with the calls the API receives. How many times larger is the second number?',
      'Web tries each call three times. The user tries each request three times, and each of those is three calls again.',
      'Retry in one layer only, and choose the one next to what fails. Select the connection from Users to Web and set its retries to 0, and leave the two retries between Web and the API.',
    ],
    debrief:
      'Three tries at one layer is three times the load when things go wrong. Three tries at each of two layers is not six ' +
      'times: it is nine, because every try by the user is three tries by Web. The API had room for nearly four times its ' +
      'usual load and was handed nine. Retries multiply down a chain of calls; they do not add. One retry at each layer looks ' +
      'more careful than two at one, and is worse: four times the load instead of three, which here is the difference between ' +
      'recovering and not. Taking every retry out is not the answer either. A healthy API is sometimes slow, and with nobody ' +
      'trying again those requests simply fail. Retry in one place, and make it the place next to what fails. When Web ' +
      'retries, only the call to the API is made again. When the user retries, Web does all its own work again first, and the ' +
      'user waits for both.',
  },
  starter: layered(2, 2),
  reference: layered(0, 2),
  palette: [],
  workload: workload({
    chaos: [{ atMs: 20_000, command: { type: 'slow', nodeId: 'api', factor: 4, durationMs: 5000 } }],
  }),
  durationMs: 80_000,
  warmupMs: 35_000,
  seed: 1616,
  objectives: [
    { kind: 'errors', maxRate: 0.003 },
    { kind: 'p99', maxMs: 400 },
  ],
  // Any one layer retrying passes. The stars are for retrying where it costs least: next to what fails.
  bonus: [[{ kind: 'p99', maxMs: 340 }], [{ kind: 'p99', maxMs: 280 }]],
  locked: {
    users: '*',
    web: '*',
    api: '*',
    'users--web': ['timeoutMs', 'appliesTo', 'mode'],
    'web--api': ['timeoutMs', 'appliesTo', 'mode'],
  },
};
