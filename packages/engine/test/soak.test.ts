import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { hashReport, lintDesign } from '../src/index.ts';
import type { CommandInput, DesignInput, Dist } from '../src/index.ts';
import { design, edgeOf, nodeOf, run } from './helpers.ts';

// Random systems built from every kind of part, with random faults thrown at them. Whatever
// happens, the books must balance once the traffic has stopped and everything has finished.

const dist: fc.Arbitrary<Dist> = fc.record({
  kind: fc.constantFrom<Dist['kind']>('const', 'exp', 'lognormal'),
  mean: fc.double({ min: 1, max: 30, noNaN: true }),
  cv: fc.double({ min: 0.1, max: 2, noNaN: true }),
});
const fraction = fc.double({ min: 0, max: 1, noNaN: true });
const policy = fc.record({
  latencyMs: fc.double({ min: 0, max: 3, noNaN: true }),
  timeoutMs: fc.oneof(fc.constant(0), fc.double({ min: 10, max: 300, noNaN: true })),
  retries: fc.integer({ min: 0, max: 2 }),
  backoffMs: fc.double({ min: 0, max: 40, noNaN: true }),
  jitter: fraction,
  poolSize: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 6 })),
  breaker: fc.record({ enabled: fc.boolean(), window: fc.integer({ min: 5, max: 20 }), openMs: fc.double({ min: 100, max: 2000, noNaN: true }) }),
});

const shape = fc.record({
  rps: fc.integer({ min: 20, max: 300 }),
  readRatio: fraction,
  limiter: fc.option(fc.record({ rate: fc.integer({ min: 20, max: 400 }), burst: fc.integer({ min: 1, max: 50 }) }), { nil: undefined }),
  balancer: fc.option(fc.constantFrom('round-robin', 'random', 'least-connections', 'two-choices'), { nil: undefined }),
  instances: fc.integer({ min: 1, max: 3 }),
  concurrency: fc.integer({ min: 1, max: 12 }),
  queue: fc.integer({ min: 0, max: 30 }),
  work: dist,
  cache: fc.option(
    fc.record({ capacity: fc.integer({ min: 5, max: 300 }), ttlMs: fc.oneof(fc.constant(0), fc.integer({ min: 200, max: 3000 })), singleFlight: fc.boolean() }),
    { nil: undefined },
  ),
  database: fc.option(
    fc.record({ concurrency: fc.integer({ min: 1, max: 8 }), maxConnections: fc.integer({ min: 2, max: 40 }), replicas: fc.integer({ min: 0, max: 2 }), readTime: dist, writeTime: dist }),
    { nil: undefined },
  ),
  worker: fc.option(
    fc.record({ concurrency: fc.integer({ min: 1, max: 4 }), serviceTime: dist, failureRate: fc.double({ min: 0, max: 0.6, noNaN: true }), maxDeliveries: fc.integer({ min: 1, max: 4 }), depth: fc.integer({ min: 5, max: 200 }), overflow: fc.constantFrom('reject', 'drop-oldest') }),
    { nil: undefined },
  ),
  edges: fc.tuple(policy, policy, policy),
  faults: fc.array(
    fc.record({ atMs: fc.integer({ min: 0, max: 3500 }), kind: fc.integer({ min: 0, max: 7 }), target: fc.integer({ min: 0, max: 9 }), durationMs: fc.option(fc.integer({ min: 50, max: 2000 }), { nil: undefined }) }),
    { maxLength: 5 },
  ),
});

type Shape = typeof shape extends fc.Arbitrary<infer T> ? T : never;

function build(s: Shape): { input: DesignInput; chaos: { atMs: number; command: CommandInput }[] } {
  const nodes: NonNullable<DesignInput['nodes']> = [{ id: 'users', type: 'client', params: { rps: s.rps, readRatio: s.readRatio, keys: 400 } }];
  const edges: NonNullable<DesignInput['edges']> = [];
  let previous = 'users';
  const link = (to: string, params: NonNullable<DesignInput['edges']>[number]['params'] = {}) => {
    edges.push({ id: `${previous}-${to}`, from: previous, to, params });
    previous = to;
  };

  if (s.limiter) {
    nodes.push({ id: 'limit', type: 'rate-limiter', params: s.limiter });
    link('limit', s.edges[0]);
  }
  if (s.balancer) {
    nodes.push({ id: 'lb', type: 'load-balancer', params: { algorithm: s.balancer, healthCheckMs: 500 } });
    link('lb', s.limiter ? {} : s.edges[0]);
  }
  nodes.push({
    id: 'api',
    type: 'service',
    params: { instances: s.balancer ? s.instances : 1, concurrency: s.concurrency, queue: s.queue, serviceTime: s.work },
  });
  link('api', s.limiter || s.balancer ? s.edges[1] : s.edges[0]);

  const from = (to: string, params: NonNullable<DesignInput['edges']>[number]['params']) => {
    edges.push({ id: `api-${to}`, from: 'api', to, params });
  };
  if (s.cache && s.database) {
    nodes.push({ id: 'cache', type: 'cache', params: s.cache });
    from('cache', { latencyMs: 0.2, timeoutMs: 50 });
  }
  if (s.database) {
    nodes.push({ id: 'db', type: 'database', params: s.database });
    from('db', s.edges[2]);
  }
  if (s.worker) {
    const { depth, overflow, ...worker } = s.worker;
    nodes.push({ id: 'jobs', type: 'queue', params: { maxDepth: depth, overflow } });
    nodes.push({ id: 'worker', type: 'worker', params: worker });
    from('jobs', { mode: 'async', appliesTo: 'write' });
    edges.push({ id: 'jobs-worker', from: 'jobs', to: 'worker' });
  }

  const ids = nodes.map((node) => node.id);
  const edgeIds = edges.map((edge) => edge.id);
  const chaos = s.faults.map(({ atMs, kind, target, durationMs }) => {
    const nodeId = ids[target % ids.length]!;
    const edgeId = edgeIds[target % edgeIds.length]!;
    const lasting = durationMs === undefined ? {} : { durationMs };
    // Something killed for good would strand its work for good, so a kill always ends.
    const revived = { durationMs: durationMs ?? 500 };
    const commands: CommandInput[] = [
      { type: 'traffic', multiplier: (target % 4) + 0.5, ...lasting },
      { type: 'kill', nodeId, ...revived },
      { type: 'kill', nodeId, count: 1, ...revived },
      { type: 'slow', nodeId, factor: 5, ...lasting },
      { type: 'errors', nodeId, rate: 0.3, ...lasting },
      { type: 'flush', nodeId },
      { type: 'failover', nodeId },
      target % 2 === 0 ? { type: 'sever', edgeId, ...lasting } : { type: 'delay', edgeId, addMs: 20, ...lasting },
    ];
    return { atMs, command: commands[kind]! };
  });
  return { input: { nodes, edges }, chaos };
}

describe('any system, under any faults', () => {
  it('ends every request and every call exactly once', { timeout: 300_000 }, () => {
    fc.assert(
      fc.property(shape, fc.integer({ min: 0, max: 0xffffffff }), (s, seed) => {
        const { input, chaos } = build(s);
        const target = design(input);
        expect(lintDesign(target).filter((issue) => issue.level === 'error')).toEqual([]);

        const input2 = { seed, sendMs: 4000, drainMs: 900_000, workload: { chaos } };
        const { sim, report } = run(target, input2);
        const { requests } = report;
        const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

        expect(requests.inFlight).toBe(0);
        expect(requests.ok + requests.failed).toBe(requests.created);
        expect(sum(Object.values(requests.failedBy))).toBe(requests.failed);
        expect(sum(report.blame.map((blame) => blame.count))).toBe(requests.failed);
        expect(sum(report.samples.map((sample) => sample.created))).toBe(requests.created);

        for (const node of report.nodes) {
          expect(node.ok + node.failed, node.id).toBe(node.arrivals);
          expect(sum(Object.values(node.failedBy)), node.id).toBe(node.failed);
          expect(node.utilization, node.id).toBeGreaterThanOrEqual(0);
          expect(node.utilization, node.id).toBeLessThanOrEqual(1 + 1e-9);
          expect(node.monthlyCost, node.id).toBeGreaterThanOrEqual(0);
        }
        for (const edge of report.edges) expect(edge.ok + edge.failed + edge.abandoned, edge.id).toBe(edge.calls);

        // Nothing is still in flight, and every pooled connection has been given back.
        expect(sim.calls.live).toBe(0);
        for (const edge of sim.edges) for (const pool of edge.pools) expect(pool.inUse, edge.id).toBe(0);
        for (const gauge of sim.gauges().slice(1)) expect(gauge.inFlight).toBe(0);

        if (s.worker) {
          const jobs = nodeOf(report, 'jobs');
          const worker = nodeOf(report, 'worker');
          // Every delivery is a call at the worker, and every message is accounted for.
          expect(jobs.detail.delivered).toBe(worker.arrivals);
          expect(edgeOf(report, 'jobs-worker').calls).toBe(worker.arrivals);
          const returned = worker.failed - jobs.detail.deadLettered!;
          expect(jobs.detail.published! + returned - jobs.detail.dropped!).toBe(jobs.detail.delivered! + jobs.detail.depth!);
          expect(jobs.detail.depth).toBe(0);
        }
        if (s.cache && s.database) {
          const cache = nodeOf(report, 'cache');
          expect(cache.detail.items).toBeLessThanOrEqual(s.cache.capacity);
        }

        expect(hashReport(run(target, input2).report)).toBe(hashReport(report));
      }),
      { numRuns: 150 },
    );
  });
});
