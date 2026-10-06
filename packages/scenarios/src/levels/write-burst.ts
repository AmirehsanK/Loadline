import type { Design } from '@loadline/engine';
import { at, design, workload } from '../build.ts';
import type { Scenario } from '../types.ts';

// Orders: 80 a second, and five times that for ten seconds.
const users = at(0, 1, { id: 'users', type: 'client', name: 'Customers', params: { rps: 80, readRatio: 0 } } as const);
const api = at(1, 1, {
  id: 'api',
  type: 'service',
  name: 'Orders',
  params: { concurrency: 64, queue: 256, serviceTime: { kind: 'const', mean: 2 } },
} as const);
// Recording an order takes 40 ms, four at a time: 100 a second.
const RECORDING = { kind: 'const', mean: 40 } as const;
const ledger = at(2, 1, {
  id: 'ledger',
  type: 'service',
  name: 'Ledger',
  params: { concurrency: 4, queue: 64, serviceTime: RECORDING },
} as const);

/** The system with the ledger replaced by a queue and a worker of `instances` instances. */
export const queued = (instances: number, maxDepth = 10_000) =>
  design(
    'Write burst',
    [
      users,
      api,
      at(2, 1, { id: 'jobs', type: 'queue', name: 'Orders to record', params: { maxDepth } }),
      at(3, 1, { id: 'recorder', type: 'worker', name: 'Recorder', params: { instances, concurrency: 4, serviceTime: RECORDING } }),
    ],
    [
      ['users', 'api', { timeoutMs: 2000 }],
      ['api', 'jobs', { mode: 'async' }],
      ['jobs', 'recorder'],
    ],
  );

/** Every order must end up being recorded: by the ledger, or by a worker reading a queue. */
function ordersAreRecorded(target: Design): string[] {
  const from = (id: string) => target.edges.filter((edge) => edge.from === id && edge.params.appliesTo !== 'read');
  const typeOf = (id: string) => target.nodes.find((node) => node.id === id)?.type;
  const recorded = from('api').some((edge) => {
    if (edge.to === 'ledger') return true;
    return typeOf(edge.to) === 'queue' && from(edge.to).some((next) => typeOf(next.to) === 'worker');
  });
  return recorded ? [] : ['orders-recorded'];
}

export const writeBurst: Scenario = {
  id: 'write-burst',
  text: {
    title: 'Write burst',
    summary: 'Five times the orders for ten seconds, and none may be lost.',
    brief:
      'Every order is recorded in the ledger before the customer is told it went through. The ledger can record 100 a second, ' +
      'and 80 arrive. Then a sale starts: 400 a second for ten seconds. ' +
      'Lose no order, keep failures under 1% and 99% of requests under 100 ms, have everything recorded by the end, and spend ' +
      'no more than $340 a month.',
    hints: [
      'Does the customer need the order recorded before being answered, or only to know it will be?',
      'A queue takes the order at once and holds it. A worker records orders at its own pace.',
      'Replace the ledger with a queue and a worker. One worker instance records 100 a second: is that enough to clear the backlog in time?',
    ],
    debrief:
      'The burst was four times what the ledger could record, and every customer was waiting on it, so most were turned away. ' +
      'A queue changes what the customer waits for: storing the order, which is instant, and not recording it, which is not. ' +
      'The work is still done, later. During the sale orders pile up in the queue; afterwards the workers catch up. ' +
      'How fast they catch up is what you size them for: what they can do, less what keeps arriving. One instance clears twenty a ' +
      'second and would need two and a half minutes; two clear a hundred and twenty. Three or four clear it sooner still, and ' +
      'nobody is waiting for that: an order recorded twenty seconds late is still recorded. Pay for what the catch-up needs.',
    rules: {
      'orders-recorded': 'Every order has to be recorded: the orders service must call the ledger, or hand orders to a queue that a worker reads.',
    },
  },
  starter: design('Write burst', [users, api, ledger], [
    ['users', 'api', { timeoutMs: 2000 }],
    ['api', 'ledger', { timeoutMs: 1500 }],
  ]),
  reference: queued(2),
  palette: ['queue', 'worker'],
  workload: workload({ phases: [{ atMs: 20_000, multiplier: 5 }, { atMs: 30_000, multiplier: 1 }] }),
  durationMs: 90_000,
  warmupMs: 5000,
  seed: 606,
  objectives: [
    { kind: 'errors', maxRate: 0.01 },
    { kind: 'p99', maxMs: 100 },
    { kind: 'lost', max: 0 },
    { kind: 'backlog', maxDepth: 50 },
    { kind: 'cost', maxMonthly: 340 },
  ],
  // More workers than the catch-up needs still pass. The stars are for not paying for them: nobody is
  // waiting for an order to be recorded a few seconds sooner.
  bonus: [[{ kind: 'cost', maxMonthly: 310 }], [{ kind: 'cost', maxMonthly: 280 }]],
  locked: {
    users: '*',
    api: ['instances', 'concurrency', 'serviceTime', 'autoscale.enabled'],
    ledger: ['concurrency', 'serviceTime', 'autoscale.enabled'],
  },
  removable: ['ledger'],
  // Any worker the player adds does the ledger's work, at the ledger's pace.
  added: { worker: { serviceTime: RECORDING, concurrency: 4, failureRate: 0 } },
  rules: ordersAreRecorded,
};
