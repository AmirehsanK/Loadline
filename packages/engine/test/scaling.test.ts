import { describe, expect, it } from 'vitest';
import { instancePrice } from '../src/index.ts';
import type { Design } from '../src/index.ts';
import { during, fixed, nodeOf, run, system, windowsOf } from './helpers.ts';

// One instance does 200 a second. Traffic is 100 a second, then 600 from 20 s to 120 s.
const surge = { phases: [{ atMs: 20_000, multiplier: 6 }, { atMs: 120_000, multiplier: 1 }] };

function fleet(bootMs: number): Design {
  return system(
    [
      { id: 'users', type: 'client', params: { rps: 100 } },
      { id: 'lb', type: 'load-balancer', params: { healthCheckMs: 1000 } },
      {
        id: 'api',
        type: 'service',
        params: {
          instances: 2,
          concurrency: 4,
          queue: 64,
          serviceTime: fixed(20),
          autoscale: { enabled: true, min: 2, max: 20, target: 0.6, bootMs, cooldownMs: 60_000 },
        },
      },
    ],
    [
      ['users', 'lb'],
      ['lb', 'api'],
    ],
  );
}

describe('autoscaling', () => {
  it('arrives late: the load has to be seen before it is answered, and instances take time to start', () => {
    const target = fleet(30_000);
    const { report } = run(target, { sendMs: 120_000, workload: surge });
    const instances = windowsOf(target, report, 'api').map((window) => window.instances);

    // It looks every five seconds, so it first sees the surge at 25 s and orders two more
    // instances, which are ready at 55 s. Until then two instances face 600 a second.
    expect(instances[19]).toBe(2);
    expect(instances[53]).toBe(2);
    expect(instances[56]).toBe(4);
    expect(during(report, 22_000, 54_000, (sample) => sample.failed)).toBeGreaterThan(5000);

    // Four are still busier than the target, so it orders more, and then it is settled: five
    // would do, and it lands on six because it was also clearing the backlog when it looked.
    expect(instances[119]).toBeGreaterThanOrEqual(5);
    expect(instances[119]).toBeLessThanOrEqual(6);
    expect(during(report, 58_000, 120_000, (sample) => sample.failed)).toBe(0);
    expect(windowsOf(target, report, 'api')[110]!.utilization).toBeLessThan(0.65);
    expect(windowsOf(target, report, 'api')[110]!.utilization).toBeGreaterThan(0.45);
  });

  it('hurts far less when instances start quickly', () => {
    const slow = run(fleet(30_000), { sendMs: 120_000, workload: surge }).report;
    const fast = run(fleet(2000), { sendMs: 120_000, workload: surge }).report;
    expect(fast.requests.failed).toBeLessThan(slow.requests.failed / 4);
    expect(during(fast, 30_000, 120_000, (sample) => sample.failed)).toBe(0);
  });

  it('keeps its instances for a cooldown after the load has gone, then gives them back', () => {
    const target = fleet(30_000);
    const { report } = run(target, { sendMs: 400_000, workload: surge });
    const instances = windowsOf(target, report, 'api').map((window) => window.instances);

    // It keeps what the busiest look of the last minute wanted: it would rather pay for too many
    // than be caught short. The last look of the surge was at 120 s, so at 180 s they all go.
    const after = instances.slice(120);
    expect(after.every((count, i) => i === 0 || count <= after[i - 1]!)).toBe(true);
    expect(instances[178]).toBeGreaterThanOrEqual(5);
    expect(instances[182]).toBe(2);
    expect(instances[399]).toBe(2);
    expect(during(report, 120_000, 400_000, (sample) => sample.failed)).toBe(0);

    // What it cost is the average over the run of what was running.
    const cost = nodeOf(report, 'api').monthlyCost;
    expect(cost).toBeGreaterThan(2 * instancePrice(4));
    expect(cost).toBeLessThan(4 * instancePrice(4));
  });

  it('does not give instances back in a lull shorter than the cooldown', () => {
    // Two surges with twenty quiet seconds between them.
    const twice = {
      phases: [
        { atMs: 20_000, multiplier: 6 },
        { atMs: 100_000, multiplier: 1 },
        { atMs: 120_000, multiplier: 6 },
        { atMs: 180_000, multiplier: 1 },
      ],
    };
    const target = fleet(30_000);
    const { report } = run(target, { sendMs: 180_000, workload: twice });
    const instances = windowsOf(target, report, 'api').map((window) => window.instances);

    expect(instances[118]).toBe(instances[99]);
    expect(during(report, 100_000, 180_000, (sample) => sample.failed)).toBe(0);
  });

  it('stays within its limits', () => {
    const capped = system(
      [
        { id: 'users', type: 'client', params: { rps: 2000 } },
        { id: 'lb', type: 'load-balancer' },
        {
          id: 'api',
          type: 'service',
          params: {
            concurrency: 4,
            serviceTime: fixed(20),
            autoscale: { enabled: true, min: 3, max: 6, bootMs: 1000, cooldownMs: 1000 },
          },
        },
      ],
      [
        ['users', 'lb'],
        ['lb', 'api'],
      ],
    );
    const { report } = run(capped, { sendMs: 60_000, drainMs: 120_000 });
    const instances = windowsOf(capped, report, 'api').map((window) => window.instances);
    // It starts at its minimum whatever was asked for, never passes its maximum, and returns.
    expect(instances[0]).toBe(3);
    expect(Math.max(...instances)).toBe(6);
    expect(instances[instances.length - 1]).toBe(3);
  });
});
