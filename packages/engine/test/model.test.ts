import { describe, expect, it } from 'vitest';
import { DesignError, checkDesign, createSimulation, designSchema, hasErrors, lintDesign } from '../src/index.ts';
import type { DesignInput } from '../src/index.ts';

const codes = (input: DesignInput) => lintDesign(designSchema.parse(input)).map((issue) => `${issue.level}:${issue.code}`);

const users = { id: 'users', type: 'client' } as const;
const api = { id: 'api', type: 'service' } as const;
const db = { id: 'db', type: 'service' } as const;

describe('the design schema', () => {
  it('fills in every default', () => {
    const parsed = designSchema.parse({
      nodes: [users, api],
      edges: [{ id: 'e', from: 'users', to: 'api' }],
    });
    expect(parsed).toEqual({
      version: 1,
      name: '',
      nodes: [
        { id: 'users', name: '', x: 0, y: 0, type: 'client', params: { rps: 100, readRatio: 0.9, keys: 10_000, skew: 1 } },
        {
          id: 'api',
          name: '',
          x: 0,
          y: 0,
          type: 'service',
          params: {
            instances: 1,
            concurrency: 8,
            queue: 256,
            serviceTime: { kind: 'exp', mean: 20 },
            autoscale: { enabled: false, min: 1, max: 10, target: 0.6, bootMs: 30_000, cooldownMs: 60_000 },
          },
        },
      ],
      edges: [
        {
          id: 'e',
          from: 'users',
          to: 'api',
          params: {
            latencyMs: 1,
            timeoutMs: 3000,
            retries: 0,
            backoffMs: 100,
            backoffFactor: 2,
            jitter: 0,
            appliesTo: 'all',
            mode: 'sync',
            poolSize: 0,
            breaker: { enabled: false, failureRate: 0.5, window: 20, openMs: 5000 },
          },
        },
      ],
    });
    // Parsing its own output changes nothing.
    expect(designSchema.parse(parsed)).toEqual(parsed);
  });

  it('rejects values outside their bounds', () => {
    const bad: unknown[] = [
      { version: 2 },
      { nodes: [{ id: 'has space', type: 'client' }] },
      { nodes: [{ id: 'x', type: 'teapot' }] },
      { nodes: [{ id: 'x', type: 'client', params: { rps: 1e9 } }] },
      { nodes: [{ id: 'x', type: 'service', params: { concurrency: 0 } }] },
      { nodes: [{ id: 'x', type: 'service', params: { instances: 1.5 } }] },
      { nodes: [{ id: 'x', type: 'service', params: { serviceTime: { mean: 0 } } }] },
      { nodes: [{ id: 'x', type: 'service', params: { serviceTime: { mean: NaN } } }] },
      { edges: [{ id: 'e', from: 'a', to: 'b', params: { jitter: 2 } }] },
      { nodes: Array.from({ length: 201 }, (_, i) => ({ id: `n${i}`, type: 'service' })) },
      'not an object',
      null,
    ];
    for (const input of bad) {
      const { design, issues } = checkDesign(input);
      expect(design).toBeUndefined();
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.every((issue) => issue.level === 'error' && issue.code === 'schema')).toBe(true);
    }
  });

  it('says where a schema problem is', () => {
    const { issues } = checkDesign({ nodes: [users, { id: 'api', type: 'service', params: { queue: -1 } }] });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/^nodes\.1\.params\.queue: /);
  });
});

describe('the design lint', () => {
  it('accepts a connected design', () => {
    expect(codes({ nodes: [users, api, db], edges: [
      { id: 'a', from: 'users', to: 'api' },
      { id: 'b', from: 'api', to: 'db' },
    ] })).toEqual([]);
    expect(codes({})).toEqual([]);
  });

  it('finds structural errors', () => {
    const edge = { id: 'a', from: 'users', to: 'api' };
    expect(codes({ nodes: [users, users] })).toContain('error:duplicate-node');
    expect(codes({ nodes: [users, api], edges: [edge, { ...edge, to: 'api' }] })).toContain('error:duplicate-edge');
    expect(codes({ nodes: [users], edges: [edge] })).toContain('error:dangling-edge');
    expect(codes({ nodes: [users, api], edges: [edge, { id: 'b', from: 'api', to: 'api' }] })).toContain('error:self-loop');
    expect(codes({ nodes: [users, api], edges: [edge, { id: 'b', from: 'users', to: 'api' }] })).toContain(
      'error:parallel-edge',
    );
    expect(codes({ nodes: [users, api], edges: [edge, { id: 'b', from: 'api', to: 'users' }] })).toContain(
      'error:edge-into-client',
    );
    expect(codes({ nodes: [users, api, db], edges: [edge, { id: 'b', from: 'users', to: 'db' }] })).toContain(
      'error:client-fan-out',
    );
  });

  it('finds loops of any length', () => {
    const loop = (ids: string[]) => ({
      nodes: [users, ...ids.map((id) => ({ id, type: 'service' as const }))],
      edges: [
        { id: 'in', from: 'users', to: ids[0]! },
        ...ids.map((id, i) => ({ id: `e${i}`, from: id, to: ids[(i + 1) % ids.length]! })),
      ],
    });
    expect(codes(loop(['a', 'b']))).toContain('error:cycle');
    expect(codes(loop(['a', 'b', 'c', 'd']))).toContain('error:cycle');
    // A diamond is two routes to the same place, not a loop.
    expect(codes({
      nodes: [users, api, db, { id: 'cache', type: 'service' }, { id: 'store', type: 'service' }],
      edges: [
        { id: '1', from: 'users', to: 'api' },
        { id: '2', from: 'api', to: 'db' },
        { id: '3', from: 'api', to: 'cache' },
        { id: '4', from: 'db', to: 'store' },
        { id: '5', from: 'cache', to: 'store' },
      ],
    })).toEqual([]);
  });

  it('warns about parts that will do nothing', () => {
    expect(codes({ nodes: [users] })).toEqual(['warning:client-unconnected']);
    expect(codes({ nodes: [api] })).toEqual(['warning:unreachable', 'warning:no-client']);
    const issues = lintDesign(designSchema.parse({ nodes: [users] }));
    expect(hasErrors(issues)).toBe(false);
  });
});

describe('createSimulation', () => {
  it('refuses a design with errors and says what they are', () => {
    const broken = designSchema.parse({ nodes: [users, api], edges: [{ id: 'a', from: 'api', to: 'users' }] });
    expect(() => createSimulation(broken, { seed: 1 })).toThrow(DesignError);
    try {
      createSimulation(broken, { seed: 1 });
    } catch (error) {
      expect((error as DesignError).issues.map((issue) => issue.code)).toEqual(['edge-into-client']);
    }
  });

  it('runs a design that only has warnings', () => {
    const sim = createSimulation(designSchema.parse({ nodes: [users, api] }), { seed: 1 });
    sim.advance(5000);
    expect(sim.created).toBe(0);
    expect(sim.samples).toHaveLength(5);
  });
});
