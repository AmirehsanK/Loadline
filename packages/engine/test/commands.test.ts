import { describe, expect, it } from 'vitest';
import { PRICES, buildReport, commandSchema, createSimulation, designSchema, hashReport, workloadSchema } from '../src/index.ts';
import type { CommandInput, Design } from '../src/index.ts';
import { during, fixed, nodeOf, run, system } from './helpers.ts';

/** A healthy two-tier system: 100 requests a second, served in about 30 ms. */
function healthy(): Design {
  return system(
    [
      { id: 'users', type: 'client', params: { rps: 100 } },
      { id: 'api', type: 'service', params: { concurrency: 64, serviceTime: fixed(10) } },
      { id: 'store', type: 'service', params: { concurrency: 64, serviceTime: fixed(20) } },
    ],
    [
      ['users', 'api', { timeoutMs: 2000 }],
      ['api', 'store', { timeoutMs: 1000 }],
    ],
  );
}

const at10 = (command: CommandInput) => ({ chaos: [{ atMs: 10_000, command }] });
const inject = (command: CommandInput) => run(healthy(), { sendMs: 30_000, drainMs: 5000, workload: at10(command) }).report;

describe('injected faults', () => {
  it('a traffic spike multiplies the rate and then ends', () => {
    const report = inject({ type: 'traffic', multiplier: 4, durationMs: 5000 });
    expect(during(report, 5000, 10_000, (sample) => sample.created) / 5).toBeCloseTo(100, -1);
    expect(during(report, 10_000, 15_000, (sample) => sample.created) / 5).toBeGreaterThan(370);
    expect(during(report, 15_000, 20_000, (sample) => sample.created) / 5).toBeCloseTo(100, -1);
  });

  it('a spike multiplies whatever the workload is doing at the time', () => {
    const target = healthy();
    const workload = { phases: [{ atMs: 0, multiplier: 2 }, { atMs: 12_000, multiplier: 0.5 }], ...at10({ type: 'traffic', multiplier: 3, durationMs: 5000 }) };
    const { report } = run(target, { sendMs: 20_000, workload });
    expect(during(report, 5000, 10_000, (sample) => sample.created) / 5).toBeCloseTo(200, -1);
    expect(during(report, 10_000, 12_000, (sample) => sample.created) / 2).toBeGreaterThan(540);
    expect(during(report, 12_000, 15_000, (sample) => sample.created) / 3).toBeCloseTo(150, -1);
    expect(during(report, 15_000, 20_000, (sample) => sample.created) / 5).toBeCloseTo(50, -1);
  });

  it('a node that is down fails every call until it is back', () => {
    const report = inject({ type: 'kill', nodeId: 'store', durationMs: 5000 });
    expect(during(report, 10_000, 15_000, (sample) => sample.ok)).toBeLessThan(5);
    expect(during(report, 16_000, 30_000, (sample) => sample.failed)).toBe(0);
    expect(report.blame).toEqual([{ cause: 'node-down', nodeId: 'store', where: null, count: report.requests.failed }]);
    expect(report.requests.inFlight).toBe(0);
  });

  it('a slow node takes longer over each call', () => {
    const report = inject({ type: 'slow', nodeId: 'store', factor: 10, durationMs: 5000 });
    expect(during(report, 5000, 10_000, (sample) => sample.p50) / 5).toBeCloseTo(30, 0);
    expect(during(report, 11_000, 15_000, (sample) => sample.p50) / 4).toBeCloseTo(210, -1);
    expect(during(report, 16_000, 20_000, (sample) => sample.p50) / 4).toBeCloseTo(30, 0);
    expect(report.requests.failed).toBe(0);
  });

  it('a bad deploy fails a share of the calls outright', () => {
    const report = inject({ type: 'errors', nodeId: 'api', rate: 0.25, durationMs: 10_000 });
    const failed = during(report, 10_000, 20_000, (sample) => sample.failed);
    expect(failed / 1000).toBeCloseTo(0.25, 1);
    expect(report.blame).toEqual([{ cause: 'injected-error', nodeId: 'api', where: null, count: failed }]);
    // The calls that failed never reached the store.
    expect(nodeOf(report, 'store').arrivals).toBe(report.requests.ok);
  });

  it('a cut connection fails calls over it, blamed on the far end', () => {
    const report = inject({ type: 'sever', edgeId: 'api-store', durationMs: 5000 });
    expect(during(report, 10_000, 15_000, (sample) => sample.ok)).toBeLessThan(5);
    expect(during(report, 16_000, 30_000, (sample) => sample.failed)).toBe(0);
    expect(report.blame).toEqual([{ cause: 'network-drop', nodeId: 'store', where: null, count: report.requests.failed }]);
  });

  it('extra delay on a connection is paid on the way out and on the way back', () => {
    const report = inject({ type: 'delay', edgeId: 'api-store', addMs: 100, durationMs: 5000 });
    expect(during(report, 11_000, 15_000, (sample) => sample.p50) / 4).toBeCloseTo(230, -1);
    expect(during(report, 16_000, 20_000, (sample) => sample.p50) / 4).toBeCloseTo(30, 0);
  });

  it('a fault without a duration stays', () => {
    const report = inject({ type: 'sever', edgeId: 'api-store' });
    expect(during(report, 11_000, 30_000, (sample) => sample.ok)).toBe(0);
  });

  it('a command that does not apply is set aside, not guessed at', () => {
    const sim = createSimulation(healthy(), { seed: 1 });
    const commands: CommandInput[] = [
      { type: 'kill', nodeId: 'nowhere' },
      { type: 'sever', edgeId: 'nothing' },
      { type: 'flush', nodeId: 'api' },
      { type: 'failover', nodeId: 'store' },
      { type: 'kill', nodeId: 'users' },
    ];
    for (const command of commands) expect(sim.command(commandSchema.parse(command))).toBe(false);
    expect(sim.ignored).toHaveLength(commands.length);
    expect(sim.command(commandSchema.parse({ type: 'slow', nodeId: 'api', factor: 2 }))).toBe(true);
    sim.advance(5000);
    expect(sim.failed).toBe(0);
  });

  it('are part of the run: the same faults at the same times give the same report', () => {
    const fault: CommandInput = { type: 'kill', nodeId: 'store', durationMs: 5000 };
    expect(hashReport(inject(fault))).toBe(hashReport(inject(fault)));
    expect(hashReport(inject(fault))).not.toBe(hashReport(inject({ ...fault, durationMs: 5001 })));
  });
});

describe('changing settings during a run', () => {
  // One slot and 12 ms of work can do 83 a second; 100 arrive.
  const tight = (concurrency: number) =>
    system(
      [
        { id: 'users', type: 'client', params: { rps: 100 } },
        { id: 'api', type: 'service', params: { concurrency, queue: 100_000, serviceTime: fixed(12) } },
      ],
      [['users', 'api']],
    );

  it('takes effect from that moment, without starting again', () => {
    const sim = createSimulation(tight(1), { seed: 1 });
    sim.advance(20_000);
    const queuedBefore = sim.gauges()[1]!.queued;
    expect(queuedBefore).toBeGreaterThan(200);

    sim.reconfigure(tight(4));
    sim.advance(40_000);
    const report = buildReport(sim);
    // The backlog is worked off, and the run carries on from where it was.
    expect(sim.gauges()[1]!.queued).toBe(0);
    expect(report.samples[39]!.p99).toBeLessThan(40);
    expect(report.timeMs).toBe(40_000);
    expect(report.requests.created).toBeGreaterThan(3800);
  });

  it('reaches clients, edges and every kind of node', () => {
    const before = system(
      [
        { id: 'users', type: 'client', params: { rps: 100 } },
        { id: 'limit', type: 'rate-limiter', params: { rate: 1000, burst: 1000 } },
        { id: 'api', type: 'service', params: { concurrency: 64, serviceTime: fixed(5) } },
        { id: 'cache', type: 'cache', params: { capacity: 1000 } },
        { id: 'db', type: 'database', params: { replicas: 0 } },
      ],
      [
        ['users', 'limit'],
        ['limit', 'api'],
        ['api', 'cache'],
        ['api', 'db'],
      ],
    );
    const after = designSchema.parse({
      ...before,
      nodes: before.nodes.map((node) => {
        if (node.type === 'client') return { ...node, params: { ...node.params, rps: 400 } };
        if (node.type === 'rate-limiter') return { ...node, params: { rate: 50, burst: 10 } };
        if (node.type === 'cache') return { ...node, params: { ...node.params, capacity: 10 } };
        if (node.type === 'database') return { ...node, params: { ...node.params, replicas: 2 } };
        return node;
      }),
    });

    const sim = createSimulation(before, { seed: 1 });
    sim.advance(10_000);
    sim.reconfigure(after);
    sim.advance(20_000);
    const report = buildReport(sim);

    expect(during(report, 0, 10_000, (sample) => sample.created) / 10).toBeCloseTo(100, -1);
    expect(during(report, 10_000, 20_000, (sample) => sample.created) / 10).toBeCloseTo(400, -2);
    expect(during(report, 12_000, 20_000, (sample) => sample.ok) / 8).toBeCloseTo(50, 0);
    expect(nodeOf(report, 'cache').detail.items).toBeLessThanOrEqual(10);
    expect(nodeOf(report, 'db').instances).toBe(3);
  });

  it('is refused when the structure differs, because that is a different run', () => {
    const sim = createSimulation(tight(1), { seed: 1 });
    expect(() => {
      sim.reconfigure(healthy());
    }).toThrow(/same nodes and edges/);
  });
});

describe('cost', () => {
  it('adds up what each part is priced at', () => {
    const target = system(
      [
        { id: 'users', type: 'client' },
        { id: 'lb', type: 'load-balancer' },
        { id: 'limit', type: 'rate-limiter' },
        { id: 'api', type: 'service', params: { instances: 3, concurrency: 8 } },
        { id: 'cache', type: 'cache', params: { capacity: 5000 } },
        { id: 'db', type: 'database', params: { concurrency: 16, replicas: 2 } },
        { id: 'jobs', type: 'queue' },
        { id: 'worker', type: 'worker', params: { instances: 2, concurrency: 4 } },
      ],
      [
        ['users', 'limit'],
        ['limit', 'lb'],
        ['lb', 'api'],
        ['api', 'cache'],
        ['api', 'db'],
        ['api', 'jobs', { mode: 'async' }],
        ['jobs', 'worker'],
      ],
    );
    const { report } = run(target, { sendMs: 10_000 });
    const cost = (id: string) => nodeOf(report, id).monthlyCost;

    expect(cost('users')).toBe(0);
    expect(cost('lb')).toBe(PRICES.loadBalancer);
    expect(cost('limit')).toBe(PRICES.rateLimiter);
    expect(cost('api')).toBe(3 * (15 + 3 * 8));
    expect(cost('cache')).toBe(10 + 2 * 5);
    expect(cost('db')).toBe(3 * (40 + 12 * 16));
    expect(cost('jobs')).toBe(PRICES.queue);
    expect(cost('worker')).toBe(2 * (15 + 3 * 4));
    expect(report.monthlyCost).toBe(20 + 10 + 117 + 20 + 696 + 15 + 54);
  });

  it('is known before the run starts', () => {
    const sim = createSimulation(healthy(), { seed: 1 });
    expect(buildReport(sim).monthlyCost).toBe(2 * (15 + 3 * 64));
  });

  it('keeps charging for an instance that has crashed', () => {
    const target = system(
      [
        { id: 'users', type: 'client' },
        { id: 'lb', type: 'load-balancer' },
        { id: 'api', type: 'service', params: { instances: 4, concurrency: 8 } },
      ],
      [
        ['users', 'lb'],
        ['lb', 'api'],
      ],
    );
    const workload = workloadSchema.parse({ chaos: [{ atMs: 1000, command: { type: 'kill', nodeId: 'api', count: 2 } }] });
    const sim = createSimulation(target, { seed: 1, workload });
    sim.advance(60_000);
    const api = nodeOf(buildReport(sim), 'api');
    expect(api.instances).toBe(2);
    expect(api.monthlyCost).toBe(4 * (15 + 3 * 8));
  });
});
