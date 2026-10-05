import { at, design, ramp, workload } from '../build.ts';
import type { Scenario } from '../types.ts';

const users = at(0, 1, { id: 'users', type: 'client', name: 'Shoppers', params: { rps: 100 } } as const);
const lb = at(1, 1, { id: 'lb', type: 'load-balancer', name: 'Balancer', params: { healthCheckMs: 1000 } } as const);

export interface Fleet {
  instances?: number;
  scale?: { min?: number; max?: number; target?: number };
}

/**
 * The shop with a fixed number of instances, or with `scale`, scaling by itself. One instance does
 * 4 calls at a time, 20 ms each: 200 a second. A new one takes 10 s to start.
 */
export const shop = ({ instances = 2, scale }: Fleet) =>
  design(
    'Black Friday',
    [
      users,
      lb,
      at(2, 1, {
        id: 'api',
        type: 'service',
        name: 'Shop',
        params: {
          instances,
          concurrency: 4,
          queue: 64,
          serviceTime: { kind: 'const', mean: 20 },
          autoscale: { enabled: scale !== undefined, min: 2, max: 10, target: 0.8, ...scale, bootMs: 10_000, cooldownMs: 20_000 },
        },
      }),
    ],
    [
      ['users', 'lb', { timeoutMs: 2000 }],
      ['lb', 'api'],
    ],
  );

export const blackFriday: Scenario = {
  id: 'black-friday',
  text: {
    title: 'Black Friday',
    summary: 'Six times the traffic for a minute, on a budget.',
    brief:
      'For most of the day two instances are plenty. Then the sale opens: traffic climbs to six and a half times as much ' +
      'over thirty seconds, holds, and falls away. A new instance takes ten seconds to start. ' +
      'Keep failures under 0.5% and 99% of requests under 400 ms, for no more than $120 a month on average.',
    hints: [
      'Enough instances for the peak, running all day, costs more than the budget. Too few fail at the peak.',
      'The shop can add and remove instances by itself. Turn that on and watch when the new ones arrive.',
      'It orders instances for the load it has already seen, and they take ten seconds to start. It is set to keep 80% of its slots busy, which leaves no room to wait. Have it aim lower, so it orders sooner.',
    ],
    debrief:
      'Running enough for the peak all day is simple and wasteful: four instances doing the work of one. ' +
      'Scaling by itself fixes the bill, but it is always late. It sizes the service for the load of the last few seconds, ' +
      'and what it orders takes ten more to arrive; during a climb, that is two delays stacked on a moving target. ' +
      'Aiming to keep fewer slots busy is how you buy time: the order goes in while there is still room to wait for it. ' +
      'The price is a larger fleet at the peak, and the limit on instances is how you cap it.',
  },
  starter: shop({}),
  reference: shop({ scale: { target: 0.3, max: 5 } }),
  palette: [],
  // The quiet stretch after the sale is most of the run, as it is most of the day.
  workload: workload({
    phases: [...ramp(30_000, 60_000, 1, 6.5), ...ramp(80_000, 90_000, 6.5, 1)],
  }),
  durationMs: 240_000,
  warmupMs: 5000,
  seed: 808,
  objectives: [
    { kind: 'errors', maxRate: 0.005 },
    { kind: 'p99', maxMs: 400 },
    { kind: 'cost', maxMonthly: 120 },
  ],
  // Two stars for a climb with no failures at all, three for doing it cheaply.
  bonus: [[{ kind: 'errors', maxRate: 0.0005 }], [{ kind: 'cost', maxMonthly: 100 }]],
  locked: {
    users: '*',
    lb: [],
    api: ['concurrency', 'serviceTime', 'autoscale.bootMs', 'autoscale.cooldownMs'],
    'users--lb': [],
    'lb--api': [],
  },
};
