import { checkDesign, designSchema, hasErrors } from '@loadline/engine';
import type { Design, DesignEdge, NodeType } from '@loadline/engine';
import { brokenRules } from '@loadline/scenarios';
import type { Scenario } from '@loadline/scenarios';
import { applyEdgeChanges, applyNodeChanges } from '@xyflow/react';
import type { Connection, EdgeChange, NodeChange } from '@xyflow/react';
import { create } from 'zustand';
import { allowedParts, canRemove, canRemoveEdge, forcedSettings, lockedPaths } from '../level/rules.ts';
import { getPath, setPath } from './fields.ts';
import { STARTER, canConnect, createEdge, createNode, fromDesign, toDesign } from './model.ts';
import type { FlowEdge, FlowNode } from './model.ts';

/** Where the sandbox's design is kept between visits. */
export const SANDBOX_SLOT = 'loadline:design:v1';
/** Where the design a visitor is working on for a level is kept. */
export const levelSlot = (id: string) => `loadline:level:${id}:v1`;

const HISTORY_LIMIT = 100;
/** Changes of one kind to one part that come this close together are a single step to undo. */
const COALESCE_MS = 800;
const SAVE_DELAY_MS = 400;

interface Snapshot {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

interface DesignState extends Snapshot {
  /** The storage key the design is saved under. */
  slot: string;
  /** The level whose rules the design is edited under; null in the sandbox. */
  level: Scenario | null;
  /** What undo and redo go back and forward to. */
  past: Snapshot[];
  future: Snapshot[];
  onNodesChange: (changes: NodeChange<FlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<FlowEdge>[]) => void;
  connect: (connection: Connection) => void;
  /** Adds a part. `name` is what its kind is called, to name it "Service 2" and so on. */
  addNode: (type: NodeType, name: string, position: { x: number; y: number }) => void;
  renameNode: (id: string, name: string) => void;
  /** Replaces a node's settings. */
  patchNode: (id: string, params: FlowNode['data']['params']) => void;
  /** Replaces an edge's settings. */
  patchEdge: (id: string, params: DesignEdge['params']) => void;
  remove: (kind: 'node' | 'edge', id: string) => void;
  /** Swaps the whole design for another, as one step that can be undone. */
  replace: (design: Design) => void;
  /**
   * Starts editing what is saved under `slot`, or `fallback` if nothing valid is. The history
   * starts empty: undo never crosses from one design into another.
   */
  open: (slot: string, fallback: Design, level: Scenario | null) => void;
  undo: () => void;
  redo: () => void;
}

/** The design saved under a key by an earlier visit, if it is still one that may be edited. */
function stored(slot: string, level: Scenario | null): Design | null {
  try {
    const saved = localStorage.getItem(slot);
    if (saved === null) return null;
    // Saved data is checked like any other input: it may be from an older version, or edited.
    const { design, issues } = checkDesign(JSON.parse(saved));
    if (!design || hasErrors(issues)) return null;
    // A level may have changed since: a design that breaks its rules now starts over.
    if (level && brokenRules(level, design).length > 0) return null;
    return design;
  } catch {
    // Storage can be unavailable or hold something unreadable.
    return null;
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Whether new settings for a part differ from its current ones somewhere the level has locked. */
function touchesLock(level: Scenario | null, id: string, type: NodeType | undefined, before: object, after: object): boolean {
  const paths = lockedPaths(level, id, type);
  if (paths === '*') return !same(before, after);
  return paths.some((path) => !same(getPath(before, path), getPath(after, path)));
}

// What the last recorded step was and when, to merge a run of them into one.
let lastStep = '';
let lastStepAt = 0;

/**
 * The history after a change of kind `step` is about to be made to `state`. Typing a number or
 * dragging a part is many changes; they are remembered as one.
 */
function remember(state: DesignState, step: string): Pick<DesignState, 'past' | 'future'> {
  const now = Date.now();
  const continues = step === lastStep && now - lastStepAt < COALESCE_MS && state.past.length > 0;
  lastStep = step;
  lastStepAt = now;
  if (continues) return { past: state.past, future: [] };
  return { past: [...state.past, { nodes: state.nodes, edges: state.edges }].slice(-HISTORY_LIMIT), future: [] };
}

/** Where a new connection goes among the ones the design already has. */
function withEdge(state: Snapshot, edge: FlowEdge): FlowEdge[] {
  const typeOf = (id: string) => state.nodes.find((node) => node.id === id)?.type;
  if (typeOf(edge.target) !== 'cache') return [...state.edges, edge];
  // A service asks a cache first and then the store behind it, in the order of its connections.
  // So a connection to a cache goes in front of the caller's store, wherever it was drawn.
  const calls = state.edges.filter((other) => other.source === edge.source && typeOf(other.target) !== 'cache');
  const store = calls.find((other) => typeOf(other.target) === 'database') ?? calls[0];
  if (!store) return [...state.edges, edge];
  const at = state.edges.indexOf(store);
  return [...state.edges.slice(0, at), edge, ...state.edges.slice(at)];
}

export const useDesign = create<DesignState>((set) => ({
  ...fromDesign(stored(SANDBOX_SLOT, null) ?? designSchema.parse(STARTER)),
  slot: SANDBOX_SLOT,
  level: null,
  past: [],
  future: [],

  onNodesChange: (incoming) => {
    set((state) => {
      const changes = incoming.filter((change) => change.type !== 'remove' || canRemove(state.level, change.id));
      const moved = changes.flatMap((change) => (change.type === 'position' ? [change.id] : []));
      const history = changes.some((change) => change.type === 'remove')
        ? remember(state, 'delete')
        : moved.length > 0
          ? remember(state, `move:${moved.join(',')}`)
          : {};
      return { ...history, nodes: applyNodeChanges(changes, state.nodes) };
    });
  },
  onEdgesChange: (incoming) => {
    set((state) => {
      const changes = incoming.filter((change) => {
        if (change.type !== 'remove') return true;
        const edge = state.edges.find((candidate) => candidate.id === change.id);
        return !edge || canRemoveEdge(state.level, edge);
      });
      const history = changes.some((change) => change.type === 'remove') ? remember(state, 'delete') : {};
      return { ...history, edges: applyEdgeChanges(changes, state.edges) };
    });
  },
  connect: ({ source, target }) => {
    set((state) =>
      canConnect(state.nodes, state.edges, source, target)
        ? { ...remember(state, 'connect'), edges: withEdge(state, createEdge(source, target)) }
        : state,
    );
  },
  addNode: (type, name, position) => {
    set((state) => {
      if (!allowedParts(state.level).includes(type)) return state;
      let node = createNode(type, name, state.nodes, position);
      for (const [path, value] of Object.entries(forcedSettings(state.level, type))) {
        node = { ...node, data: { ...node.data, params: setPath(node.data.params, path, value) } } as FlowNode;
      }
      // Select the new node, so its settings are in front of the user straight away.
      return {
        ...remember(state, 'add'),
        nodes: [...state.nodes.map((other) => ({ ...other, selected: false })), { ...node, selected: true }],
        edges: state.edges.map((edge) => ({ ...edge, selected: false })),
      };
    });
  },
  renameNode: (id, name) => {
    set((state) => ({
      ...remember(state, `rename:${id}`),
      nodes: state.nodes.map((node) =>
        node.id === id ? ({ ...node, ariaLabel: name || id, data: { ...node.data, name } } as FlowNode) : node,
      ),
    }));
  },
  patchNode: (id, params) => {
    set((state) => {
      const current = state.nodes.find((node) => node.id === id);
      if (!current || touchesLock(state.level, id, current.type, current.data.params, params)) return state;
      return {
        ...remember(state, `patch:${id}`),
        nodes: state.nodes.map((node) => (node.id === id ? ({ ...node, data: { ...node.data, params } } as FlowNode) : node)),
      };
    });
  },
  patchEdge: (id, params) => {
    set((state) => {
      const current = state.edges.find((edge) => edge.id === id);
      if (!current?.data || touchesLock(state.level, id, undefined, current.data.params, params)) return state;
      return {
        ...remember(state, `patch:${id}`),
        edges: state.edges.map((edge) => (edge.id === id ? { ...edge, data: { params } } : edge)),
      };
    });
  },
  remove: (kind, id) => {
    set((state) => {
      if (kind === 'edge') {
        const edge = state.edges.find((candidate) => candidate.id === id);
        if (!edge || !canRemoveEdge(state.level, edge)) return state;
        return { ...remember(state, 'delete'), edges: state.edges.filter((candidate) => candidate.id !== id) };
      }
      if (!canRemove(state.level, id)) return state;
      return {
        ...remember(state, 'delete'),
        nodes: state.nodes.filter((node) => node.id !== id),
        edges: state.edges.filter((edge) => edge.source !== id && edge.target !== id),
      };
    });
  },
  replace: (design) => {
    set((state) => ({ ...remember(state, 'replace'), ...fromDesign(design) }));
  },
  open: (slot, fallback, level) => {
    // The design being left is saved first; its pending save would otherwise be dropped.
    saveNow();
    lastStep = '';
    opening = true;
    try {
      set({ slot, level, past: [], future: [], ...fromDesign(stored(slot, level) ?? fallback) });
    } finally {
      opening = false;
    }
  },
  undo: () => {
    set((state) => {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      lastStep = '';
      return {
        ...previous,
        past: state.past.slice(0, -1),
        future: [...state.future, { nodes: state.nodes, edges: state.edges }],
      };
    });
  },
  redo: () => {
    set((state) => {
      const next = state.future[state.future.length - 1];
      if (!next) return state;
      lastStep = '';
      return {
        ...next,
        past: [...state.past, { nodes: state.nodes, edges: state.edges }],
        future: state.future.slice(0, -1),
      };
    });
  },
}));

/** The design as the engine sees it, or null while an edit has left it out of bounds. */
export function currentDesign(state: Snapshot): Design | null {
  try {
    return toDesign(state.nodes, state.edges);
  } catch {
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let unsaved: DesignState | null = null;
// Set while a design is being opened: what was just read from storage is not an edit to write back.
let opening = false;

/** Writes the design that is waiting to be saved, if there is one. */
function saveNow(): void {
  clearTimeout(saveTimer);
  const state = unsaved;
  unsaved = null;
  if (!state) return;
  const design = currentDesign(state);
  if (!design) return;
  try {
    localStorage.setItem(state.slot, JSON.stringify(design));
  } catch {
    // A full or disabled store only costs the user their saved design, not the session.
  }
}

useDesign.subscribe((state, previous) => {
  if (opening) return;
  if (state.nodes === previous.nodes && state.edges === previous.edges) return;
  unsaved = state;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
});
