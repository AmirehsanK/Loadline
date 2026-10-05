import { designSchema, hasErrors, lintDesign } from '@loadline/engine';
import { describe, expect, it } from 'vitest';
import { STARTER, canConnect, createEdge, createNode, fromDesign, simulationKey, toDesign } from '../src/design/model.ts';

const starter = () => fromDesign(designSchema.parse(STARTER));

describe('the starter design', () => {
  it('is valid and has nothing to warn about', () => {
    expect(lintDesign(designSchema.parse(STARTER))).toEqual([]);
  });
});

describe('converting between the canvas and the engine', () => {
  it('round-trips a design unchanged', () => {
    const design = designSchema.parse(STARTER);
    const { nodes, edges } = fromDesign(design);
    expect(toDesign(nodes, edges, design.name)).toEqual(design);
  });

  it('keeps each part where it was put, to the nearest pixel', () => {
    const { nodes, edges } = starter();
    nodes[1] = { ...nodes[1]!, position: { x: 123.4, y: -56.7 } };
    const design = toDesign(nodes, edges);
    expect(design.nodes[1]).toMatchObject({ x: 123, y: -57 });
  });

  it('refuses a canvas whose values are out of bounds', () => {
    const { nodes, edges } = starter();
    const broken = nodes.map((node) =>
      node.type === 'service' ? { ...node, data: { ...node.data, params: { ...node.data.params, concurrency: 0 } } } : node,
    );
    expect(() => toDesign(broken, edges)).toThrow();
  });
});

describe('the simulation key', () => {
  it('ignores moving and renaming, which do not change a run', () => {
    const { nodes, edges } = starter();
    const before = simulationKey(toDesign(nodes, edges));
    const moved = nodes.map((node) => ({
      ...node,
      position: { x: node.position.x + 50, y: 7 },
      data: { ...node.data, name: `${node.data.name}!` },
    })) as typeof nodes;
    expect(simulationKey(toDesign(moved, edges))).toBe(before);
  });

  it('changes when a setting or a connection changes', () => {
    const { nodes, edges } = starter();
    const before = simulationKey(toDesign(nodes, edges));
    const retried = edges.map((edge) => (edge.data ? { ...edge, data: { params: { ...edge.data.params, retries: 2 } } } : edge));
    expect(simulationKey(toDesign(nodes, retried))).not.toBe(before);
    expect(simulationKey(toDesign(nodes, edges.slice(0, 1)))).not.toBe(before);
  });
});

describe('adding parts', () => {
  it('gives each new part an unused id, a name and the default settings', () => {
    const { nodes } = starter();
    const first = createNode('service', nodes, { x: 10, y: 20 });
    const second = createNode('service', [...nodes, first], { x: 0, y: 0 });
    expect(first).toMatchObject({ id: 'service-1', type: 'service', position: { x: 10, y: 20 } });
    expect(first.data).toEqual({
      name: 'Service 1',
      params: { instances: 1, concurrency: 8, queue: 256, serviceTime: { kind: 'exp', mean: 20 } },
    });
    expect(second.id).toBe('service-2');
    expect(createNode('client', nodes, { x: 0, y: 0 }).data).toEqual({ name: 'Client 1', params: { rps: 100 } });
  });

  it('produces a design the engine accepts', () => {
    const { nodes, edges } = starter();
    const added = createNode('service', nodes, { x: 0, y: 0 });
    const design = toDesign([...nodes, added], [...edges, createEdge('store', added.id)]);
    expect(hasErrors(lintDesign(design))).toBe(false);
  });
});

describe('connecting parts', () => {
  const { nodes, edges } = starter();
  const extra = createNode('service', nodes, { x: 0, y: 0 });
  const all = [...nodes, extra];

  it('allows a new call between two services', () => {
    expect(canConnect(all, edges, 'store', extra.id)).toBe(true);
    expect(canConnect(all, edges, 'api', extra.id)).toBe(true);
  });

  it('refuses a part calling itself, a call into a client, and a second copy of a connection', () => {
    expect(canConnect(all, edges, 'api', 'api')).toBe(false);
    expect(canConnect(all, edges, 'api', 'users')).toBe(false);
    expect(canConnect(all, edges, 'api', 'store')).toBe(false);
    expect(canConnect(all, edges, 'api', 'nowhere')).toBe(false);
  });

  it('refuses a second entry point for a client', () => {
    expect(canConnect(all, edges, 'users', extra.id)).toBe(false);
    expect(canConnect(all, [], 'users', extra.id)).toBe(true);
  });

  it('refuses a connection that would make calls go round in a loop', () => {
    expect(canConnect(all, edges, 'store', 'api')).toBe(false);
    const longer = [...edges, createEdge('store', extra.id)];
    expect(canConnect(all, longer, extra.id, 'api')).toBe(false);
  });

  it('agrees with the engine about every connection it allows', () => {
    const ids = all.map((node) => node.id);
    for (const source of ids) {
      for (const target of ids) {
        if (!canConnect(all, edges, source, target)) continue;
        const design = toDesign(all, [...edges, createEdge(source, target)]);
        expect(hasErrors(lintDesign(design)), `${source} to ${target}`).toBe(false);
      }
    }
  });
});
