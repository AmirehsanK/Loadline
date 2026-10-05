import { at, design, workload } from '../build.ts';
import type { Scenario } from '../types.ts';

const users = at(0, 1, { id: 'users', type: 'client', name: 'Users', params: { rps: 240 } } as const);

export interface Setup {
  instances: number;
  healthCheckMs: number;
  retries: number;
}

/** The system as set up. One instance does 8 calls at a time, 40 ms each: 200 a second. */
export const system = ({ instances, healthCheckMs, retries }: Setup) =>
  design(
    'Node down',
    [
      users,
      at(1, 1, { id: 'lb', type: 'load-balancer', name: 'Balancer', params: { healthCheckMs } }),
      at(2, 1, {
        id: 'api',
        type: 'service',
        name: 'API',
        params: { instances, concurrency: 8, queue: 64, serviceTime: { kind: 'exp', mean: 40 } },
      }),
    ],
    [
      ['users', 'lb', { timeoutMs: 2000 }],
      ['lb', 'api', { timeoutMs: 1000, retries, backoffMs: 0 }],
    ],
  );

export const nodeDown: Scenario = {
  id: 'node-down',
  text: {
    title: 'Node down',
    summary: 'One of two instances dies and does not come back.',
    brief:
      'Two instances share the traffic, each a little over half busy. Twenty seconds in, one of them dies and does not ' +
      'come back. Keep failures under 1% and 99% of requests under 600 ms across the whole run, for no more than $140 a month.',
    hints: [
      'After the instance dies, how much can the one that is left do, and how much is arriving?',
      'And until the balancer notices, where is it still sending its share of the calls?',
      'Run one instance more than the load needs. Then make the gap short: check for dead instances more often, or let the balancer try another instance when a call fails.',
    ],
    debrief:
      'Two instances at 60% looks like a system with room to spare. It has none: lose one and the other is asked for 120%. ' +
      'Spare capacity is measured after the failure you are planning for, so this load needs three. ' +
      'The other loss is the gap between an instance dying and the balancer finding out, when calls are still sent to it. ' +
      'A more frequent health check shortens the gap. A retry closes it: the call that failed is sent to another instance ' +
      'and the user never knows.',
  },
  starter: system({ instances: 2, healthCheckMs: 10_000, retries: 0 }),
  reference: system({ instances: 3, healthCheckMs: 1000, retries: 1 }),
  palette: [],
  // Not on the second, so that no round health-check interval happens to catch it at once.
  workload: workload({ chaos: [{ atMs: 21_300, command: { type: 'kill', nodeId: 'api', count: 1 } }] }),
  durationMs: 80_000,
  warmupMs: 5000,
  seed: 909,
  objectives: [
    { kind: 'errors', maxRate: 0.01 },
    { kind: 'p99', maxMs: 600 },
    { kind: 'cost', maxMonthly: 140 },
  ],
  // Two stars for a short gap, three for a failure no user sees.
  bonus: [[{ kind: 'errors', maxRate: 0.002 }], [{ kind: 'errors', maxRate: 0 }]],
  locked: {
    users: '*',
    lb: [],
    api: ['concurrency', 'serviceTime', 'autoscale.enabled'],
    'users--lb': [],
    'lb--api': [],
  },
};
