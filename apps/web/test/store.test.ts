import { designSchema } from '@loadline/engine';
import type { Design } from '@loadline/engine';
import { findLevel } from '@loadline/scenarios';
import type { Scenario } from '@loadline/scenarios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STARTER } from '../src/design/model.ts';

// The store reads and writes the browser's storage, so it gets one made of a map, and is loaded
// after that is in place.
const saved = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => saved.get(key) ?? null,
  setItem: (key: string, value: string) => void saved.set(key, value),
  removeItem: (key: string) => void saved.delete(key),
});
const { SANDBOX_SLOT, currentDesign, levelSlot, useDesign } = await import('../src/design/store.ts');

function level(id: string): Scenario {
  const found = findLevel(id);
  if (!found) throw new Error(`no level "${id}"`);
  return found;
}

const store = () => useDesign.getState();
/** The parts and connections of a design. Its name is not something the canvas holds. */
const shape = (of: Design) => ({ nodes: of.nodes, edges: of.edges });
const design = () => shape(currentDesign(store())!);
const nodeIds = () => store().nodes.map((node) => node.id);
const edgeIds = () => store().edges.map((edge) => edge.id);
const paramsOf = (id: string) => store().nodes.find((node) => node.id === id)!.data.params as Record<string, unknown>;
const link = (source: string, target: string) => ({ source, target, sourceHandle: null, targetHandle: null });

function openLevel(id: string): Scenario {
  const found = level(id);
  store().open(levelSlot(id), found.starter, found);
  return found;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  // Opening writes whatever the test before left unsaved; only then is the storage emptied.
  store().open(SANDBOX_SLOT, designSchema.parse(STARTER), null);
  saved.clear();
  store().open(SANDBOX_SLOT, designSchema.parse(STARTER), null);
});
afterEach(() => {
  vi.useRealTimers();
});

/** Lets enough time pass that the next change is a step of its own. */
const later = () => {
  vi.advanceTimersByTime(2000);
};

describe('the design being edited', () => {
  it('starts a level from its starting design', () => {
    const firstTraffic = openLevel('first-traffic');
    expect(store().level).toBe(firstTraffic);
    expect(design()).toEqual(shape(firstTraffic.starter));
  });

  it('picks up where the visitor left off, each design under its own key', () => {
    openLevel('first-traffic');
    store().patchNode('api', { ...paramsOf('api'), instances: 2 } as never);
    // Leaving saves what is pending, even inside the delay.
    store().open(SANDBOX_SLOT, designSchema.parse(STARTER), null);
    expect(saved.has(levelSlot('first-traffic'))).toBe(true);
    expect(nodeIds()).toEqual(['users', 'api', 'store']);

    openLevel('first-traffic');
    expect(paramsOf('api').instances).toBe(2);
    expect(saved.has(SANDBOX_SLOT)).toBe(false);
  });

  it('saves a little after an edit, not on every keystroke', () => {
    store().renameNode('api', 'Front door');
    expect(saved.has(SANDBOX_SLOT)).toBe(false);
    vi.advanceTimersByTime(500);
    expect(JSON.parse(saved.get(SANDBOX_SLOT)!)).toMatchObject({ nodes: [{}, { id: 'api', name: 'Front door' }, {}] });
  });

  it('starts over from the starting design when what was saved breaks the rules of the level', () => {
    const firstTraffic = level('first-traffic');
    const cheat = structuredClone(firstTraffic.starter);
    const api = cheat.nodes.find((node) => node.id === 'api')!;
    if (api.type === 'service') api.params.concurrency = 64;
    saved.set(levelSlot('first-traffic'), JSON.stringify(cheat));
    openLevel('first-traffic');
    expect(design()).toEqual(shape(firstTraffic.starter));

    saved.set(levelSlot('first-traffic'), '{"nodes": "nonsense"}');
    openLevel('first-traffic');
    expect(design()).toEqual(shape(firstTraffic.starter));
  });
});

describe('the rules of a level, in the editor', () => {
  it('refuse a change to a locked setting and take one to a free setting', () => {
    openLevel('first-traffic');
    store().patchNode('api', { ...paramsOf('api'), concurrency: 64 } as never);
    expect(paramsOf('api').concurrency).toBe(8);
    store().patchNode('users', { ...paramsOf('users'), rps: 1 } as never);
    expect(paramsOf('users').rps).toBe(100);
    expect(store().past).toHaveLength(0);

    store().patchNode('api', { ...paramsOf('api'), instances: 3 } as never);
    expect(paramsOf('api').instances).toBe(3);
  });

  it('refuse to remove a part that has to stay, by any route', () => {
    openLevel('first-traffic');
    store().remove('node', 'api');
    store().onNodesChange([{ type: 'remove', id: 'users' }]);
    expect(nodeIds()).toEqual(['users', 'api']);

    // The connection may go: the fix is to redraw it through a balancer.
    store().remove('edge', 'users--api');
    expect(edgeIds()).toEqual([]);

    openLevel('stampede');
    store().remove('edge', 'api--db');
    store().onEdgesChange([{ type: 'remove', id: 'api--cache' }]);
    expect(edgeIds()).toEqual(['users--api', 'api--cache', 'api--db']);
  });

  it('add only the kinds of part the level offers', () => {
    openLevel('first-traffic');
    store().addNode('cache', 'Cache', { x: 0, y: 0 });
    expect(nodeIds()).toEqual(['users', 'api']);
    store().addNode('load-balancer', 'Load balancer', { x: 0, y: 0 });
    expect(nodeIds()).toEqual(['users', 'api', 'load-balancer-1']);
    // What the player added, the player can take away.
    store().remove('node', 'load-balancer-1');
    expect(nodeIds()).toEqual(['users', 'api']);
  });

  it('give a new part the settings its kind must have, and hold it to them', () => {
    const writeBurst = openLevel('write-burst');
    store().addNode('worker', 'Worker', { x: 0, y: 0 });
    expect(paramsOf('worker-1')).toMatchObject(writeBurst.added!.worker!);

    store().patchNode('worker-1', { ...paramsOf('worker-1'), concurrency: 64 } as never);
    expect(paramsOf('worker-1').concurrency).toBe(4);
    store().patchNode('worker-1', { ...paramsOf('worker-1'), instances: 2 } as never);
    expect(paramsOf('worker-1').instances).toBe(2);
  });

  it('do not apply in the sandbox', () => {
    store().patchNode('api', { ...paramsOf('api'), concurrency: 64 } as never);
    expect(paramsOf('api').concurrency).toBe(64);
    store().addNode('cache', 'Cache', { x: 0, y: 0 });
    store().remove('node', 'users');
    expect(nodeIds()).toEqual(['api', 'store', 'cache-1']);
  });
});

describe('connecting', () => {
  it('puts a cache in front of the store it is for, wherever the connection was drawn', () => {
    openLevel('read-heavy');
    expect(edgeIds()).toEqual(['users--api', 'api--db']);
    store().addNode('cache', 'Cache', { x: 0, y: 0 });
    store().connect(link('api', 'cache-1'));
    // The service asks its connections in order, so the cache has to come before the database.
    expect(edgeIds()).toEqual(['users--api', 'api--cache-1', 'api--db']);
  });

  it('appends any other connection, and refuses one the engine would', () => {
    store().addNode('service', 'Service', { x: 0, y: 0 });
    store().connect(link('api', 'service-1'));
    expect(edgeIds()).toEqual(['users--api', 'api--store', 'api--service-1']);
    // A client cannot be called.
    store().connect(link('api', 'users'));
    expect(edgeIds()).toHaveLength(3);
  });
});

describe('undo and redo', () => {
  it('step back and forward through edits', () => {
    const before = design();
    store().renameNode('api', 'Front door');
    later();
    store().remove('node', 'store');
    const after = design();
    expect(nodeIds()).toEqual(['users', 'api']);

    store().undo();
    expect(nodeIds()).toEqual(['users', 'api', 'store']);
    expect(edgeIds()).toEqual(['users--api', 'api--store']);
    store().undo();
    expect(design()).toEqual(before);
    store().undo();
    expect(design()).toEqual(before);

    store().redo();
    store().redo();
    expect(design()).toEqual(after);
    store().redo();
    expect(design()).toEqual(after);
  });

  it('treat a run of changes to one part as one step, and a pause as the end of it', () => {
    // Typing 1, 12, 128 into a field.
    for (const instances of [1, 12, 128]) {
      store().patchNode('api', { ...paramsOf('api'), instances } as never);
      vi.advanceTimersByTime(150);
    }
    expect(store().past).toHaveLength(1);
    later();
    store().patchNode('api', { ...paramsOf('api'), instances: 4 } as never);
    expect(store().past).toHaveLength(2);

    store().undo();
    expect(paramsOf('api').instances).toBe(128);
    store().undo();
    expect(paramsOf('api').instances).toBe(1);
  });

  it('keep changes to different parts apart, however close together', () => {
    store().patchNode('api', { ...paramsOf('api'), instances: 2 } as never);
    store().patchNode('store', { ...paramsOf('store'), instances: 3 } as never);
    expect(store().past).toHaveLength(2);
  });

  it('count a drag as one step, and selecting as none', () => {
    const at = (x: number) => ({ type: 'position' as const, id: 'api', position: { x, y: 40 }, dragging: true });
    store().onNodesChange([{ type: 'select', id: 'api', selected: true }]);
    expect(store().past).toHaveLength(0);
    for (const x of [310, 330, 360]) store().onNodesChange([at(x)]);
    expect(store().past).toHaveLength(1);
    store().undo();
    expect(store().nodes.find((node) => node.id === 'api')!.position.x).toBe(300);
  });

  it('forget what was undone once something new is done', () => {
    store().renameNode('api', 'One');
    later();
    store().renameNode('api', 'Two');
    store().undo();
    expect(store().future).toHaveLength(1);
    later();
    store().renameNode('api', 'Three');
    expect(store().future).toHaveLength(0);
    store().redo();
    expect(store().nodes.find((node) => node.id === 'api')!.data.name).toBe('Three');
  });

  it('bring back a design that a solution replaced', () => {
    const firstTraffic = openLevel('first-traffic');
    store().patchNode('api', { ...paramsOf('api'), instances: 5 } as never);
    later();
    store().replace(firstTraffic.reference);
    expect(design()).toEqual(shape(firstTraffic.reference));
    store().undo();
    expect(paramsOf('api').instances).toBe(5);
  });

  it('never cross from one design into another', () => {
    store().renameNode('api', 'Front door');
    openLevel('first-traffic');
    expect(store().past).toHaveLength(0);
    store().undo();
    expect(design()).toEqual(shape(level('first-traffic').starter));
  });
});
