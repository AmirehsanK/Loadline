import { describe, expect, it } from 'vitest';
import { SimulationLimitError, buildReport, createSimulation, workloadSchema } from '../src/index.ts';
import { chain, exp, fixed, run } from './helpers.ts';

describe('timeouts', () => {
  it('do not cancel the work downstream', () => {
    // Every call takes 200 ms and the client gives up after 50.
    const target = chain(50, [{ concurrency: 100, serviceTime: fixed(200), timeoutMs: 50 }]);
    const { report } = run(target, { sendMs: 10_000, drainMs: 2000 });
    const service = report.nodes[1]!;

    expect(report.requests.created).toBeGreaterThan(400);
    expect(report.requests.ok).toBe(0);
    expect(report.requests.failedBy.timeout).toBe(report.requests.created);
    // The service still did all of it, for nobody.
    expect(service.ok).toBe(report.requests.created);
    expect(service.wasted).toBe(report.requests.created);
    expect(report.blame).toEqual([
      { cause: 'timeout', nodeId: 's1', where: 'in-service', count: report.requests.created },
    ]);
  });

  it('are blamed on the queue when that is where the call was stuck', () => {
    // 20 requests a second into a service that can do 10.
    const target = chain(20, [{ serviceTime: fixed(100), timeoutMs: 500 }]);
    const { report } = run(target, { sendMs: 30_000, drainMs: 60_000 });

    expect(report.blame[0]).toMatchObject({ cause: 'timeout', nodeId: 's1', where: 'queued' });
    expect(report.blame[0]!.count).toBeGreaterThan(report.requests.failed * 0.7);
    expect(report.rates.errorRate).toBeGreaterThan(0.4);
  });

  it('are blamed on the deepest call in the chain, not the first hop', () => {
    // The front service is healthy. The one behind it is overloaded, and only the client has a
    // timeout, so the timeout fires two hops away from the cause.
    const target = chain(20, [
      { concurrency: 1000, serviceTime: fixed(1), timeoutMs: 500 },
      { serviceTime: fixed(100) },
    ]);
    const { report } = run(target, { sendMs: 30_000, drainMs: 120_000 });

    expect(report.blame[0]).toMatchObject({ cause: 'timeout', nodeId: 's2', where: 'queued' });
    expect(report.nodes[1]!.failed).toBe(0);
  });

  it('leave one piece of wasted work behind for each timeout', () => {
    // Lightly loaded, so the timeouts come from the tail of the service time, not from queueing.
    const target = chain(100, [{ concurrency: 8, serviceTime: exp(30), timeoutMs: 60, retries: 1 }]);
    const { report } = run(target, { sendMs: 20_000, drainMs: 60_000 });
    const edge = report.edges[0]!;

    expect(edge.timeouts).toBeGreaterThan(100);
    expect(report.requests.ok).toBeGreaterThan(100);
    expect(report.nodes[1]!.wasted).toBe(edge.timeouts);
    // A late reply is dropped, not counted a second time.
    expect(report.requests.ok + report.requests.failed).toBe(report.requests.created);
    expect(report.nodes[1]!.ok).toBe(report.nodes[1]!.arrivals);
  });
});

describe('retries', () => {
  it('multiply the load on a service that is already failing', () => {
    const target = chain(50, [{ concurrency: 1000, serviceTime: fixed(200), timeoutMs: 50, retries: 2 }]);
    const { report } = run(target, { sendMs: 10_000, drainMs: 2000 });

    expect(report.requests.attempts).toBe(report.requests.created * 3);
    expect(report.nodes[1]!.arrivals).toBe(report.requests.created * 3);
    expect(report.rates.attemptsPerRequest).toBe(3);
    expect(report.edges[0]).toMatchObject({ retried: report.requests.created * 2, ok: 0 });
    expect(report.requests.failed).toBe(report.requests.created);
  });

  it('wait for the backoff, which grows by the factor each time', () => {
    // Each attempt times out after 50 ms; the waits between them are 100 and then 200 ms. A
    // request has therefore given up exactly 50 + 100 + 50 + 200 + 50 = 450 ms after it was made.
    const target = chain(2000, [
      { concurrency: 100_000, serviceTime: fixed(10_000), timeoutMs: 50, retries: 2, backoffMs: 100, backoffFactor: 2 },
    ]);
    const workload = workloadSchema.parse({ phases: [{ atMs: 1000, multiplier: 0 }] });
    const sim = createSimulation(target, { seed: 3, workload });

    sim.advance(1000 + 449);
    expect(buildReport(sim).requests.inFlight).toBeGreaterThan(0);
    sim.advance(1000 + 450);
    const report = buildReport(sim);
    expect(report.requests.inFlight).toBe(0);
    expect(report.requests.failed).toBe(report.requests.created);
  });

  it('spread out when jitter is on', () => {
    const settle = (jitter: number) => {
      const target = chain(2000, [
        { concurrency: 100_000, serviceTime: fixed(10_000), timeoutMs: 50, retries: 1, backoffMs: 400, jitter },
      ]);
      const workload = workloadSchema.parse({ phases: [{ atMs: 100, multiplier: 0 }] });
      const sim = createSimulation(target, { seed: 3, workload });
      // Without jitter every retry starts at least 450 ms after the request was made.
      sim.advance(440);
      return buildReport(sim).requests.attempts - buildReport(sim).requests.created;
    };
    expect(settle(0)).toBe(0);
    expect(settle(1)).toBeGreaterThan(50);
  });

  it('turn some rejections into successes', () => {
    const errorRate = (retries: number) => {
      const target = chain(60, [{ queue: 0, serviceTime: fixed(10), retries, backoffMs: 20, jitter: 1 }]);
      return run(target, { sendMs: 60_000, drainMs: 5000 }).report.rates.errorRate;
    };
    const without = errorRate(0);
    const withRetries = errorRate(3);
    expect(without).toBeGreaterThan(0.3);
    expect(withRetries).toBeLessThan(without / 2);
  });

  it('can tip a system that was coping into collapse', () => {
    // Four slots and 30 ms of work is room for 133 calls a second, and 100 arrive: 75% load. But
    // about a third of the calls take longer than the 60 ms timeout, and each of those is retried
    // while the original still holds its slot. That is enough extra load to pass 100%, the queue
    // grows, every call then waits longer than the timeout, and almost nothing succeeds.
    const run75 = (retries: number) =>
      run(chain(100, [{ concurrency: 4, serviceTime: exp(30), timeoutMs: 60, retries }]), {
        sendMs: 60_000,
        drainMs: 120_000,
      }).report;

    const calm = run75(0);
    const storm = run75(1);
    expect(calm.rates.errorRate).toBeLessThan(0.4);
    expect(calm.nodes[1]!.maxQueued).toBeLessThan(100);
    expect(storm.rates.errorRate).toBeGreaterThan(0.95);
    expect(storm.nodes[1]!.maxQueued).toBeGreaterThan(1000);
    expect(storm.blame[0]).toMatchObject({ cause: 'timeout', nodeId: 's1', where: 'queued' });
    // The service never stopped working; it was working for callers who had left.
    const sending = storm.samples.filter((sample) => sample.t > 10_000 && sample.t <= 60_000);
    expect(Math.min(...sending.map((sample) => sample.nodes[1]!.utilization))).toBeGreaterThan(0.99);
    expect(storm.nodes[1]!.wasted).toBeGreaterThan(storm.nodes[1]!.ok * 0.9);
  });
});

describe('rejections', () => {
  it('are counted once and blamed on the node whose queue was full', () => {
    const target = chain(200, [
      { concurrency: 1000, serviceTime: fixed(1) },
      { queue: 2, serviceTime: exp(10) },
    ]);
    const { report } = run(target, { sendMs: 20_000, drainMs: 5000 });
    const [, front, back] = report.nodes;

    expect(back!.failedBy['queue-full']).toBeGreaterThan(1000);
    // The front service passes the failure on; it is not a second failure.
    expect(front!.failedBy['queue-full']).toBe(back!.failedBy['queue-full']);
    expect(report.requests.failedBy['queue-full']).toBe(back!.failedBy['queue-full']);
    expect(report.blame).toEqual([
      { cause: 'queue-full', nodeId: 's2', where: null, count: back!.failedBy['queue-full'] },
    ]);
  });
});

describe('workload phases', () => {
  it('scale the arrival rate from the moment they start', () => {
    const target = chain(100, [{ concurrency: 100, serviceTime: fixed(1) }]);
    const phases = [
      { atMs: 0, multiplier: 1 },
      { atMs: 10_000, multiplier: 3 },
      { atMs: 20_000, multiplier: 0 },
    ];
    const { report } = run(target, { sendMs: 30_000, workload: { phases } });
    const created = (from: number, to: number) =>
      report.samples.filter((sample) => sample.t > from && sample.t <= to).reduce((sum, s) => sum + s.created, 0);

    expect(report.samples).toHaveLength(30);
    // Within four standard deviations of a Poisson count.
    expect(Math.abs(created(0, 10_000) - 1000)).toBeLessThan(4 * Math.sqrt(1000));
    expect(Math.abs(created(10_000, 20_000) - 3000)).toBeLessThan(4 * Math.sqrt(3000));
    expect(created(20_000, 30_000)).toBe(0);
    expect(created(0, 30_000)).toBe(report.requests.created);
  });

  it('can be overridden while the run is in progress', () => {
    const target = chain(100, [{ concurrency: 100, serviceTime: fixed(1) }]);
    const sim = createSimulation(target, { seed: 8 });
    sim.advance(10_000);
    sim.setMultiplier(5);
    sim.advance(20_000);
    sim.setMultiplier(0);
    sim.advance(30_000);

    const created = (from: number, to: number) =>
      sim.samples.filter((sample) => sample.t > from && sample.t <= to).reduce((sum, s) => sum + s.created, 0);
    expect(Math.abs(created(0, 10_000) - 1000)).toBeLessThan(4 * Math.sqrt(1000));
    expect(Math.abs(created(10_000, 20_000) - 5000)).toBeLessThan(4 * Math.sqrt(5000));
    expect(created(20_000, 30_000)).toBe(0);
  });

  it('start at the rate of a phase placed at time zero', () => {
    const target = chain(100, [{ concurrency: 100, serviceTime: fixed(1) }]);
    const { report } = run(target, { sendMs: 5000, workload: { phases: [{ atMs: 0, multiplier: 0 }] } });
    expect(report.requests.created).toBe(0);
  });
});

describe('sampling', () => {
  it('hands each window over once and keeps a bounded history', () => {
    const target = chain(100, [{ concurrency: 100, serviceTime: fixed(1) }]);
    const sim = createSimulation(target, { seed: 1, sampleMs: 500, maxSamples: 4 });

    sim.advance(1000);
    expect(sim.takeSamples().map((sample) => sample.t)).toEqual([500, 1000]);
    expect(sim.takeSamples()).toEqual([]);
    sim.advance(1500);
    expect(sim.takeSamples().map((sample) => sample.t)).toEqual([1500]);

    sim.advance(10_000);
    expect(sim.samples.map((sample) => sample.t)).toEqual([8500, 9000, 9500, 10_000]);
    expect(sim.takeSamples().map((sample) => sample.t)).toEqual([8500, 9000, 9500, 10_000]);
  });

  it('reports utilization and queue length per window', () => {
    // One slot, 20 ms of work, 100 requests a second: permanently busy, with a growing queue.
    const target = chain(100, [{ serviceTime: fixed(20) }]);
    const { report } = run(target, { sendMs: 5000 });
    const last = report.samples[report.samples.length - 1]!;

    expect(last.nodes[1]!.utilization).toBeCloseTo(1, 6);
    expect(last.nodes[1]!.inFlight).toBe(1);
    expect(last.nodes[1]!.queued).toBeGreaterThan(150);
    expect(last.nodes[1]!.ok).toBe(50);
    expect(last.edges[0]!.calls).toBe(last.created);
  });

  it('exposes what each node is holding right now', () => {
    const target = chain(100, [{ serviceTime: fixed(20) }]);
    const sim = createSimulation(target, { seed: 1 });
    expect(sim.gauges()).toEqual([
      { inFlight: 0, queued: 0, instances: 1 },
      { inFlight: 0, queued: 0, instances: 1 },
    ]);
    sim.advance(5000);
    const [users, service] = sim.gauges();
    const last = sim.samples[sim.samples.length - 1]!;
    expect(service).toEqual({ inFlight: 1, queued: last.nodes[1]!.queued, instances: 1 });
    // Every request the client is waiting on is either in the service's slot or in its queue.
    expect(users!.inFlight).toBe(service!.inFlight + service!.queued);
  });
});

describe('the scored period', () => {
  it('leaves out what clients saw during warm-up', () => {
    // Twenty slow seconds, then the work gets ten times quicker.
    const target = chain(50, [{ concurrency: 100, serviceTime: fixed(200) }]);
    const workload = workloadSchema.parse({});
    const sim = createSimulation(target, { seed: 1, workload, scoreFromMs: 20_000 });
    sim.advance(10_000);
    expect(sim.ok).toBeGreaterThan(400);
    expect(sim.score()).toMatchObject({ fromMs: 20_000, ok: 0, failed: 0, p99: 0 });
    sim.advance(19_999);
    expect(sim.score()).toMatchObject({ fromMs: 20_000, ok: 0, failed: 0, p99: 0 });

    sim.advance(40_000);
    const all = buildReport(sim).requests;
    const scored = sim.score();
    expect(scored.fromMs).toBe(20_000);
    expect(scored.ok).toBeGreaterThan(900);
    expect(scored.ok).toBeLessThan(all.ok - 900);
    expect(scored.p99).toBeCloseTo(200, 0);
  });

  it('covers the whole run when there is no warm-up', () => {
    const sim = createSimulation(chain(50, [{ concurrency: 100, serviceTime: fixed(20) }]), { seed: 1 });
    sim.advance(10_000);
    expect(sim.score()).toMatchObject({ fromMs: 0, ok: sim.ok, failed: 0 });
  });
});

describe('the limit on calls in flight', () => {
  it('stops a run whose work piles up without bound', () => {
    const target = chain(1000, [{ serviceTime: fixed(1000) }]);
    const sim = createSimulation(target, { seed: 1, maxLiveCalls: 256 });
    expect(() => sim.advance(60_000)).toThrow(SimulationLimitError);
  });
});
