import { describe, expect, it } from 'vitest';
import { lintDesign } from '../src/index.ts';
import type { Design, QueueNode, WorkerNode } from '../src/index.ts';
import { during, exp, fixed, nodeOf, run, system, windowsOf } from './helpers.ts';

interface Shape {
  queue?: Partial<QueueNode['params']>;
  worker?: Partial<WorkerNode['params']>;
}

/** Writes are handed to a queue; one worker instance takes them four at a time, 20 ms each. */
function pipeline(shape: Shape = {}): Design {
  return system(
    [
      { id: 'users', type: 'client', params: { rps: 100, readRatio: 0 } },
      { id: 'api', type: 'service', params: { concurrency: 500, serviceTime: fixed(1) } },
      { id: 'jobs', type: 'queue', params: { maxDepth: 100_000, ...shape.queue } },
      { id: 'worker', type: 'worker', params: { instances: 1, concurrency: 4, serviceTime: fixed(20), ...shape.worker } },
    ],
    [
      ['users', 'api'],
      ['api', 'jobs', { mode: 'async' }],
      ['jobs', 'worker'],
    ],
  );
}

// Five times the traffic for ten seconds, starting at 10 s.
const burst = { phases: [{ atMs: 10_000, multiplier: 5 }, { atMs: 20_000, multiplier: 1 }] };

describe('a queue', () => {
  it('takes a burst that would overwhelm a direct call, and works it off afterwards', () => {
    const target = pipeline();
    const { sim, report } = run(target, { sendMs: 70_000, drainMs: 10_000, workload: burst });
    const depth = windowsOf(target, report, 'jobs').map((window) => window.queued);
    const jobs = nodeOf(report, 'jobs');

    // Callers never notice: they are answered as soon as the message is stored.
    expect(report.requests.failed).toBe(0);
    expect(report.latency.p99).toBeLessThan(5);

    // The worker does 200 a second. For ten seconds 500 arrive, so 300 a second pile up.
    expect(depth[9]).toBeLessThan(20);
    expect(depth[19]).toBeGreaterThan(2700);
    expect(depth[19]).toBeLessThan(3300);
    expect(jobs.maxQueued).toBeLessThan(3300);
    // Then 100 a second arrive and 200 are done: the 3,000 take thirty seconds to clear.
    expect(depth[34]).toBeGreaterThan(1200);
    expect(depth[34]).toBeLessThan(1800);
    expect(depth[52]).toBeLessThan(20);

    // A message's wait is the queue's latency: about 15 s at the worst.
    expect(jobs.p99).toBeGreaterThan(12_000);
    expect(jobs.p99).toBeLessThan(16_000);
    expect(jobs.detail).toMatchObject({ published: report.requests.created, delivered: report.requests.created, depth: 0 });
    expect(nodeOf(report, 'worker').ok).toBe(report.requests.created);
    expect(sim.calls.live).toBe(0);
  });

  it('is what the same burst looks like without one', () => {
    const direct = system(
      [
        { id: 'users', type: 'client', params: { rps: 100, readRatio: 0 } },
        { id: 'api', type: 'service', params: { concurrency: 500, serviceTime: fixed(1) } },
        { id: 'processor', type: 'service', params: { concurrency: 4, queue: 256, serviceTime: fixed(20) } },
      ],
      [
        ['users', 'api'],
        ['api', 'processor', { timeoutMs: 1000 }],
      ],
    );
    const { report } = run(direct, { sendMs: 70_000, drainMs: 10_000, workload: burst });
    expect(during(report, 10_000, 20_000, (sample) => sample.failed)).toBeGreaterThan(2000);
  });

  it('refuses new messages when it is full', () => {
    const { report } = run(pipeline({ queue: { maxDepth: 500 } }), { sendMs: 40_000, drainMs: 10_000, workload: burst });
    const jobs = nodeOf(report, 'jobs');
    expect(jobs.maxQueued).toBe(500);
    expect(jobs.failedBy['queue-full']).toBeGreaterThan(2000);
    expect(jobs.detail.dropped).toBe(0);
    // The publisher did not wait for the answer, so the client never hears about it.
    expect(report.requests.failed).toBe(0);
    expect(nodeOf(report, 'worker').ok).toBe(jobs.detail.published);
  });

  it('or makes room by discarding its oldest', () => {
    const { report } = run(pipeline({ queue: { maxDepth: 500, overflow: 'drop-oldest' } }), {
      sendMs: 40_000,
      drainMs: 10_000,
      workload: burst,
    });
    const jobs = nodeOf(report, 'jobs');
    expect(jobs.maxQueued).toBe(500);
    expect(jobs.failed).toBe(0);
    expect(jobs.detail.dropped).toBeGreaterThan(2000);
    expect(jobs.detail.published).toBe(report.requests.created);
    expect(nodeOf(report, 'worker').ok).toBe(jobs.detail.published! - jobs.detail.dropped!);
    // Nothing waits long, because the old messages are the ones thrown away.
    expect(jobs.p99).toBeLessThan(3000);
  });

  it('holds everything while its workers are down, and they catch up when they return', () => {
    const target = pipeline();
    const chaos = [{ atMs: 10_000, command: { type: 'kill', nodeId: 'worker', durationMs: 10_000 } as const }];
    const { report } = run(target, { sendMs: 60_000, drainMs: 10_000, workload: { chaos } });
    const depth = windowsOf(target, report, 'jobs').map((window) => window.queued);

    expect(depth[19]).toBeGreaterThan(900);
    expect(depth[19]).toBeLessThan(1100);
    expect(depth[35]).toBeLessThan(20);
    expect(report.requests.failed).toBe(0);
    // Whatever was being worked on when the worker died was given back and done again.
    expect(nodeOf(report, 'worker').failedBy['node-down']).toBeLessThanOrEqual(4);
    expect(nodeOf(report, 'worker').ok).toBe(report.requests.created);
  });
});

describe('a worker', () => {
  it('tries a failed message again, and sets it aside after too many failures', () => {
    const target = pipeline({ worker: { failureRate: 0.5, maxDeliveries: 3, concurrency: 16 } });
    const { report } = run(target, { sendMs: 60_000, drainMs: 20_000 });
    const jobs = nodeOf(report, 'jobs');
    const worker = nodeOf(report, 'worker');
    const published = jobs.detail.published!;

    // Half fail each time: 1 + 1/2 + 1/4 attempts a message, and an eighth fail all three.
    expect(worker.arrivals / published).toBeCloseTo(1.75, 1);
    expect(jobs.detail.deadLettered! / published).toBeCloseTo(0.125, 1);
    expect(worker.ok + jobs.detail.deadLettered!).toBe(published);
    expect(worker.failedBy['injected-error']).toBe(worker.failed);
  });

  it('gives a message back when a dependency fails, and stops when that keeps happening', () => {
    const target = system(
      [
        { id: 'users', type: 'client', params: { rps: 50, readRatio: 0 } },
        { id: 'api', type: 'service', params: { concurrency: 100, serviceTime: fixed(1) } },
        { id: 'jobs', type: 'queue' },
        { id: 'worker', type: 'worker', params: { concurrency: 8, serviceTime: fixed(5), maxDeliveries: 4 } },
        { id: 'db', type: 'database', params: { writeTime: exp(5) } },
      ],
      [
        ['users', 'api'],
        ['api', 'jobs', { mode: 'async' }],
        ['jobs', 'worker'],
        ['worker', 'db'],
      ],
    );
    const chaos = [{ atMs: 10_000, command: { type: 'kill', nodeId: 'db', durationMs: 10_000 } as const }];
    const { sim, report } = run(target, { sendMs: 40_000, drainMs: 10_000, workload: { chaos } });
    const jobs = nodeOf(report, 'jobs');

    // Every message published while the database was down was tried four times and set aside.
    expect(jobs.detail.deadLettered).toBeGreaterThan(400);
    expect(jobs.detail.deadLettered).toBeLessThan(600);
    expect(nodeOf(report, 'db').failedBy['node-down']).toBe(jobs.detail.deadLettered! * 4);
    expect(nodeOf(report, 'worker').ok + jobs.detail.deadLettered!).toBe(jobs.detail.published);
    expect(sim.calls.live).toBe(0);
  });

  it('can only be fed by a queue, and a queue can only feed workers', () => {
    const codes = (target: Design) => lintDesign(target).filter((issue) => issue.level === 'error').map((issue) => issue.code);
    const nodes = [
      { id: 'users', type: 'client' },
      { id: 'api', type: 'service' },
      { id: 'jobs', type: 'queue' },
      { id: 'worker', type: 'worker' },
    ] as const;
    expect(codes(system([...nodes], [['users', 'api'], ['api', 'worker']]))).toEqual(['worker-source']);
    expect(codes(system([...nodes], [['users', 'jobs'], ['jobs', 'api']]))).toEqual(['queue-target']);
    expect(codes(system([...nodes], [['users', 'jobs'], ['jobs', 'worker']]))).toEqual([]);
  });
});
