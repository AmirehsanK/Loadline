import { describe, expect, it } from 'vitest';
import { chain, exp, fixed, relativeError, run } from './helpers.ts';

// The engine is checked here against results from queueing theory that have closed forms. A
// service with one instance, `c` slots and exponential work, fed by a client, is an M/M/c queue.
//
// Service takes 1 ms on average throughout, so times below are also multiples of the service
// time. Each tolerance is about three standard errors of the estimate at that load and run length;
// near saturation a queue's average converges slowly, so those runs are longer and looser.

const MEAN_SERVICE = 1;
const SERVICE_RATE = 1000; // per second, per slot

describe('M/M/1', () => {
  const cases = [
    { load: 0.5, requests: 400_000, tolerance: 0.02 },
    { load: 0.8, requests: 1_000_000, tolerance: 0.03 },
    { load: 0.9, requests: 2_000_000, tolerance: 0.045 },
  ];

  for (const { load, requests, tolerance } of cases) {
    it(`matches theory at ${load * 100}% load`, { timeout: 120_000 }, () => {
      const rps = load * SERVICE_RATE;
      const { report } = run(chain(rps, [{ serviceTime: exp(MEAN_SERVICE) }]), { sendMs: (requests / rps) * 1000 });
      const service = report.nodes[1]!;

      // Time in system is exponential with rate (service rate - arrival rate).
      const meanTime = MEAN_SERVICE / (1 - load);
      expect(relativeError(service.meanMs, meanTime)).toBeLessThan(tolerance);
      expect(relativeError(service.p50, meanTime * Math.LN2)).toBeLessThan(tolerance + 0.01);
      expect(relativeError(service.p99, meanTime * Math.log(100))).toBeLessThan(tolerance + 0.03);

      expect(relativeError(service.utilization, load)).toBeLessThan(0.01);
      // Mean number waiting: load^2 / (1 - load).
      expect(relativeError(service.meanQueued, (load * load) / (1 - load))).toBeLessThan(tolerance + 0.01);
      expect(relativeError(report.rates.offeredRps, rps)).toBeLessThan(0.01);
      expect(report.requests.failed).toBe(0);
    });
  }
});

/** Erlang C: the probability that an arriving call has to wait in an M/M/c queue. */
function erlangC(slots: number, offered: number): number {
  let term = 1;
  let sum = 1;
  for (let k = 1; k < slots; k++) {
    term *= offered / k;
    sum += term;
  }
  const last = (term * offered) / slots;
  const load = offered / slots;
  return last / ((1 - load) * sum + last);
}

describe('M/M/c', () => {
  const cases = [
    { slots: 4, load: 0.8, requests: 1_000_000, tolerance: 0.02 },
    { slots: 16, load: 0.9, requests: 2_000_000, tolerance: 0.03 },
  ];

  for (const { slots, load, requests, tolerance } of cases) {
    it(`matches Erlang C with ${slots} slots at ${load * 100}% load`, { timeout: 120_000 }, () => {
      const rps = load * slots * SERVICE_RATE;
      const target = chain(rps, [{ concurrency: slots, serviceTime: exp(MEAN_SERVICE) }]);
      const { report } = run(target, { sendMs: (requests / rps) * 1000 });
      const service = report.nodes[1]!;

      const waitProbability = erlangC(slots, load * slots);
      const meanWait = (waitProbability * MEAN_SERVICE) / (slots * (1 - load));
      expect(relativeError(service.meanMs, meanWait + MEAN_SERVICE)).toBeLessThan(tolerance);
      expect(relativeError(service.utilization, load)).toBeLessThan(0.01);
      // Mean number waiting: arrival rate times mean wait (Little's law).
      expect(relativeError(service.meanQueued, (rps / 1000) * meanWait)).toBeLessThan(tolerance * 3);
    });
  }
});

describe('M/M/1/K', () => {
  // Room for K calls in all: one in service and K - 1 waiting. Arrivals that find it full are lost.
  const blocked = (load: number, room: number) => ((1 - load) * load ** room) / (1 - load ** (room + 1));

  it('loses the predicted share of arrivals below saturation', { timeout: 120_000 }, () => {
    const load = 0.9;
    const room = 5;
    const rps = load * SERVICE_RATE;
    const target = chain(rps, [{ queue: room - 1, serviceTime: exp(MEAN_SERVICE) }]);
    const { report } = run(target, { sendMs: 600_000 });
    const service = report.nodes[1]!;

    const lost = blocked(load, room);
    expect(relativeError(service.failedBy['queue-full'] / service.arrivals, lost)).toBeLessThan(0.02);
    expect(relativeError(service.utilization, load * (1 - lost))).toBeLessThan(0.01);
    expect(service.maxQueued).toBe(room - 1);
    expect(report.requests.failedBy['queue-full']).toBe(service.failedBy['queue-full']);
    expect(report.blame[0]).toMatchObject({ cause: 'queue-full', nodeId: 's1', where: null });
  });

  it('loses the predicted share of arrivals in overload', { timeout: 120_000 }, () => {
    const load = 1.5;
    const room = 10;
    const rps = load * SERVICE_RATE;
    const target = chain(rps, [{ queue: room - 1, serviceTime: exp(MEAN_SERVICE) }]);
    const { report } = run(target, { sendMs: 400_000 });
    const service = report.nodes[1]!;

    const lost = blocked(load, room);
    expect(relativeError(report.rates.errorRate, lost)).toBeLessThan(0.01);
    // The service cannot complete work faster than its service rate.
    expect(relativeError(report.rates.goodputRps, rps * (1 - lost))).toBeLessThan(0.01);
    expect(service.utilization).toBeGreaterThan(0.98);
  });
});

describe('M/D/1', () => {
  it('matches the Pollaczek-Khinchine mean with constant service time', { timeout: 120_000 }, () => {
    const load = 0.8;
    const rps = load * SERVICE_RATE;
    const { report } = run(chain(rps, [{ serviceTime: fixed(MEAN_SERVICE) }]), { sendMs: 600_000 });
    const service = report.nodes[1]!;

    // Half the waiting of M/M/1: constant work has no variance of its own.
    const meanWait = (load * MEAN_SERVICE) / (2 * (1 - load));
    expect(relativeError(service.meanMs, meanWait + MEAN_SERVICE)).toBeLessThan(0.02);
    expect(relativeError(service.utilization, load)).toBeLessThan(0.01);
  });
});

describe('a chain of synchronous calls', () => {
  it('adds up the latency of each hop exactly when nothing varies', () => {
    const target = chain(10, [
      { concurrency: 100, serviceTime: fixed(10), latencyMs: 1 },
      { concurrency: 100, serviceTime: fixed(5), latencyMs: 2 },
    ]);
    const { report } = run(target, { sendMs: 20_000, drainMs: 1000 });
    // 1 out, 10 of work, 2 out, 5 of work, 2 back, 1 back.
    expect(report.latency.maxMs).toBeCloseTo(21, 9);
    expect(report.latency.meanMs).toBeCloseTo(21, 9);
    expect(report.nodes[1]!.meanMs).toBeCloseTo(19, 9);
    expect(report.nodes[2]!.meanMs).toBeCloseTo(5, 9);
    expect(report.requests.ok).toBe(report.requests.created);
  });

  it('keeps the caller busy while its dependency works', { timeout: 120_000 }, () => {
    // The front service has slots to spare and almost no work of its own; the back one is an
    // M/M/1 queue at 80% load. A front slot is held for the whole of each back call, so the time
    // a call spends at the front is the back's time in system plus the front's own work.
    const load = 0.8;
    const rps = load * SERVICE_RATE;
    const target = chain(rps, [
      { concurrency: 10_000, serviceTime: fixed(0.25) },
      { serviceTime: exp(MEAN_SERVICE) },
    ]);
    const { report } = run(target, { sendMs: 1_000_000 });
    const [, front, back] = report.nodes;

    const backTime = MEAN_SERVICE / (1 - load);
    expect(relativeError(back!.meanMs, backTime)).toBeLessThan(0.03);
    expect(relativeError(front!.meanMs, backTime + 0.25)).toBeLessThan(0.03);
    // Slots held at the front on average: arrival rate times the time each is held (Little's law).
    expect(relativeError(front!.utilization * 10_000, (rps / 1000) * (backTime + 0.25))).toBeLessThan(0.03);
  });
});
