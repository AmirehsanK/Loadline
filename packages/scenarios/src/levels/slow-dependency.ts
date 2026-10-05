import { at, design, workload } from '../build.ts';
import type { Link } from '../build.ts';
import type { Scenario } from '../types.ts';

// A fifth of the requests are purchases, which also call the payments service.
const users = at(0, 1, { id: 'users', type: 'client', name: 'Shoppers', params: { rps: 200, readRatio: 0.8 } } as const);
const api = at(1, 1, {
  id: 'api',
  type: 'service',
  name: 'Shop',
  params: { concurrency: 32, queue: 64, serviceTime: { kind: 'const', mean: 5 } },
} as const);
const payments = at(2, 1, {
  id: 'payments',
  type: 'service',
  name: 'Payments',
  params: { concurrency: 64, queue: 64, serviceTime: { kind: 'const', mean: 20 } },
} as const);

/** The system with a policy on the shop's calls to payments. */
export const shop = (toPayments: NonNullable<Link[2]>) =>
  design('Slow dependency', [users, api, payments], [
    ['users', 'api', { timeoutMs: 5000 }],
    ['api', 'payments', { appliesTo: 'write', ...toPayments }],
  ]);

export const slowDependency: Scenario = {
  id: 'slow-dependency',
  text: {
    title: 'Slow dependency',
    summary: 'A service you do not own turns slow, and takes yours down with it.',
    brief:
      'Twenty seconds in, the payments service turns slow: two seconds a call instead of 20 ms, for forty seconds. It is not ' +
      'yours to fix. Only purchases use it, a fifth of your traffic, yet browsing is failing too. ' +
      'Keep 99% of the requests that succeed under 400 ms, and failures to 13%: the purchases you cannot save, and no more.',
    hints: [
      'Watch the shop while payments is slow. What are its slots doing?',
      'A purchase holds a slot of the shop for as long as it waits for payments. How long is it prepared to wait?',
      'Select the connection to payments. Give it a short timeout, or let it stop calling when calls keep failing.',
    ],
    debrief:
      'Forty purchases a second each waited two seconds for payments, holding a slot of the shop all the while. That is eighty ' +
      'slots, and the shop has thirty-two. So browsing, which never touches payments, queued behind them and was turned away. ' +
      'A short timeout gives each slot back after a fraction of a second. A circuit breaker goes further: once it has seen ' +
      'enough failures it stops calling at all, so purchases fail at once and payments is left alone to recover. But a breaker ' +
      'counts failures, not slowness: with a three-second timeout nothing ever failed, and it would never have opened. ' +
      'Either way the purchases still fail. The point is that nothing else does.',
  },
  starter: shop({ timeoutMs: 3000 }),
  reference: shop({ timeoutMs: 300 }),
  palette: [],
  workload: workload({
    chaos: [{ atMs: 20_000, command: { type: 'slow', nodeId: 'payments', factor: 100, durationMs: 40_000 } }],
  }),
  durationMs: 80_000,
  warmupMs: 5000,
  seed: 404,
  objectives: [
    { kind: 'p99', maxMs: 400 },
    { kind: 'errors', maxRate: 0.13 },
  ],
  // The purchases fail whatever is done. The stars are for how little browsing notices.
  bonus: [[{ kind: 'p99', maxMs: 150 }], [{ kind: 'p99', maxMs: 50 }]],
  locked: {
    users: '*',
    api: ['instances', 'concurrency', 'queue', 'serviceTime', 'autoscale.enabled'],
    payments: '*',
    'users--api': '*',
    'api--payments': ['appliesTo', 'mode'],
  },
};
