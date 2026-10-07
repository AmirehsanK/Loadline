import { designSchema, hasErrors, lintDesign } from '@loadline/engine';
import type { Design, DesignEdge, NodeType, Workload } from '@loadline/engine';
import { brokenRules } from '@loadline/scenarios';
import type { Scenario } from '@loadline/scenarios';
import { shareSchema } from '@loadline/share';
import { applyEdgeChanges, applyNodeChanges } from '@xyflow/react';
import type { Connection, EdgeChange, NodeChange } from '@xyflow/react';
import { create } from 'zustand';
import { allowedParts, canRemove, canRemoveEdge, forcedSettings, lockedPaths } from '../level/rules.ts';
import { getPath, setPath } from './fields.ts';
import { STARTER, canConnect, createArrow, createNode, createNote, edgeToDraw, fromDesign, isArrowId, isNoteId, toDesign } from './model.ts';
import type { FlowArrow, FlowEdge, FlowNode, FlowNote } from './model.ts';

/** Where the sandbox's design is kept between visits. */
export const SANDBOX_SLOT = 'loadline:design:v1';
/** Where the design a visitor is working on for a level is kept. */
export const levelSlot = (id: string) => `loadline:level:${id}:v1`;

/** A design and what goes with it when it is saved, shared or exported. */
export interface Document {
  design: Design;
  /** The seed it runs with; the app's own when absent. A level always uses its own. */
  seed?: number;
  /** Traffic and faults that come with it. A level always uses its own. */
  workload?: Workload;
}

/** How a design is opened, apart from which one. */
export interface Opening {
  seed?: number | undefined;
  workload?: Workload | undefined;
  /**
   * A design that is being looked at and belongs to nobody yet: one from a link, or in an embed.
   * Nothing is read from storage for it and nothing is saved.
   */
  transient?: boolean;
}

const HISTORY_LIMIT = 100;
/** Changes of one kind to one part that come this close together are a single step to undo. */
const COALESCE_MS = 800;
const SAVE_DELAY_MS = 400;

interface Snapshot {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Notes on the drawing and the lines from them to parts. They are saved, and never simulated. */
  notes: FlowNote[];
  arrows: FlowArrow[];
}

const snapshot = ({ nodes, edges, notes, arrows }: Snapshot): Snapshot => ({ nodes, edges, notes, arrows });

interface DesignState extends Snapshot {
  /** The storage key the design is saved under. */
  slot: string;
  /** The level whose rules the design is edited under; null in the sandbox. */
  level: Scenario | null;
  /** The seed and the traffic the design came with, if it came with any. */
  seed: number | null;
  workload: Workload | null;
  /** Whether the design is only being looked at, and so is not saved. */
  transient: boolean;
  /** What undo and redo go back and forward to. */
  past: Snapshot[];
  future: Snapshot[];
  /** Changes from the canvas, to parts and to notes alike; each goes to the list it belongs to. */
  onNodesChange: (changes: NodeChange<FlowNode | FlowNote>[]) => void;
  onEdgesChange: (changes: EdgeChange<FlowEdge | FlowArrow>[]) => void;
  connect: (connection: Connection) => void;
  /** Adds a part. `name` is what its kind is called, to name it "Service 2" and so on. */
  addNode: (type: NodeType, name: string, position: { x: number; y: number }) => void;
  addNote: (position: { x: number; y: number }) => void;
  writeNote: (id: string, text: string) => void;
  renameNode: (id: string, name: string) => void;
  /** Renames one of a client's routes, and with it every connection that was kept for that route. */
  renameRoute: (id: string, index: number, name: string) => void;
  /** Replaces a node's settings. */
  patchNode: (id: string, params: FlowNode['data']['params']) => void;
  /** Replaces an edge's settings. */
  patchEdge: (id: string, params: DesignEdge['params']) => void;
  remove: (kind: 'node' | 'edge', id: string) => void;
  /** Swaps the whole design for another, as one step that can be undone. */
  replace: (design: Design) => void;
  /**
   * Takes on a document from outside: a file, or a design made elsewhere. In a level only the
   * design is taken, and only if it keeps the level's rules. Returns whether it was taken.
   */
  adopt: (document: Document) => boolean;
  /**
   * Starts editing what is saved under `slot`, or `fallback` if nothing valid is. The history
   * starts empty: undo never crosses from one design into another.
   */
  open: (slot: string, fallback: Design, level: Scenario | null, opening?: Opening) => void;
  /** Saves the design that is open under another key as well, at once. */
  saveAs: (slot: string) => void;
  /** Lets go of the traffic the design came with, so the traffic control applies again. */
  dropWorkload: () => void;
  /** Gives the design traffic with a shape of its own. Only the sandbox has a say in its traffic. */
  setWorkload: (workload: Workload) => void;
  undo: () => void;
  redo: () => void;
}

/**
 * A document read from text that may hold anything: saved by an earlier version, edited by hand,
 * or picked from disk. Returns null unless it is a design that can be opened. A bare design, which
 * is what earlier versions saved, is a document with nothing else in it.
 */
export function readDocument(text: string): Document | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const result = shareSchema.safeParse('nodes' in parsed ? { design: parsed } : parsed);
  if (!result.success || hasErrors(lintDesign(result.data.design))) return null;
  const { design, seed, workload } = result.data;
  return { design, ...(seed === undefined ? {} : { seed }), ...(workload === undefined ? {} : { workload }) };
}

/** What was saved under a key by an earlier visit, if it is still something that may be edited. */
function stored(slot: string, level: Scenario | null): Document | null {
  try {
    const saved = localStorage.getItem(slot);
    const document = saved === null ? null : readDocument(saved);
    // A level may have changed since: a design that breaks its rules now starts over.
    if (!document || (level && brokenRules(level, document.design).length > 0)) return null;
    return document;
  } catch {
    // Storage can be unavailable.
    return null;
  }
}

/** The design that is open, with what it came with. */
function documentOf(state: Snapshot & Pick<DesignState, 'seed' | 'workload'>): Document | null {
  const design = currentDesign(state);
  if (!design) return null;
  return { design, ...(state.seed === null ? {} : { seed: state.seed }), ...(state.workload === null ? {} : { workload: state.workload }) };
}

function write(slot: string, document: Document): void {
  try {
    localStorage.setItem(slot, JSON.stringify(document));
  } catch {
    // A full or disabled store only costs the user their saved design, not the session.
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
  return { past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT), future: [] };
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

export const useDesign = create<DesignState>((set, get) => ({
  ...fromDesign(designSchema.parse(STARTER)),
  slot: SANDBOX_SLOT,
  level: null,
  seed: null,
  workload: null,
  // Until something is opened there is nothing of the visitor's here to save.
  transient: true,
  past: [],
  future: [],

  onNodesChange: (incoming) => {
    set((state) => {
      const idOf = (change: NodeChange<FlowNode | FlowNote>) => (change.type === 'add' || change.type === 'replace' ? change.item.id : change.id);
      const allowed = incoming.filter((change) => change.type !== 'remove' || isNoteId(change.id) || canRemove(state.level, change.id));
      const forNotes = allowed.filter((change) => isNoteId(idOf(change))) as NodeChange<FlowNote>[];
      const forParts = allowed.filter((change) => !isNoteId(idOf(change))) as NodeChange<FlowNode>[];
      const moved = allowed.flatMap((change) => (change.type === 'position' ? [change.id] : []));
      const history = allowed.some((change) => change.type === 'remove')
        ? remember(state, 'delete')
        : moved.length > 0
          ? remember(state, `move:${moved.join(',')}`)
          : {};
      return {
        ...history,
        ...(forParts.length > 0 ? { nodes: applyNodeChanges(forParts, state.nodes) } : {}),
        ...(forNotes.length > 0 ? { notes: applyNodeChanges(forNotes, state.notes) } : {}),
      };
    });
  },
  onEdgesChange: (incoming) => {
    set((state) => {
      const idOf = (change: EdgeChange<FlowEdge | FlowArrow>) => (change.type === 'add' || change.type === 'replace' ? change.item.id : change.id);
      const allowed = incoming.filter((change) => {
        if (change.type !== 'remove' || isArrowId(change.id)) return true;
        const edge = state.edges.find((candidate) => candidate.id === change.id);
        return !edge || canRemoveEdge(state.level, edge);
      });
      const forArrows = allowed.filter((change) => isArrowId(idOf(change))) as EdgeChange<FlowArrow>[];
      const forEdges = allowed.filter((change) => !isArrowId(idOf(change))) as EdgeChange<FlowEdge>[];
      const history = allowed.some((change) => change.type === 'remove') ? remember(state, 'delete') : {};
      return {
        ...history,
        ...(forEdges.length > 0 ? { edges: applyEdgeChanges(forEdges, state.edges) } : {}),
        ...(forArrows.length > 0 ? { arrows: applyEdgeChanges(forArrows, state.arrows) } : {}),
      };
    });
  },
  connect: ({ source, target }) => {
    set((state) => {
      if (isNoteId(source)) {
        // A line drawn from a note points at a part. It is not a call, so nothing checks it but this.
        const drawn = state.arrows.some((arrow) => arrow.source === source && arrow.target === target);
        if (drawn || !state.nodes.some((node) => node.id === target)) return state;
        return { ...remember(state, 'connect'), arrows: [...state.arrows, createArrow(source, target)] };
      }
      return canConnect(state.nodes, state.edges, source, target)
        ? { ...remember(state, 'connect'), edges: withEdge(state, edgeToDraw(state.nodes, state.edges, source, target)) }
        : state;
    });
  },
  addNote: (position) => {
    set((state) => ({
      ...remember(state, 'add'),
      nodes: state.nodes.map((node) => ({ ...node, selected: false })),
      edges: state.edges.map((edge) => ({ ...edge, selected: false })),
      notes: [...state.notes.map((note) => ({ ...note, selected: false })), { ...createNote(state.notes, position), selected: true }],
    }));
  },
  writeNote: (id, text) => {
    set((state) => ({
      ...remember(state, `write:${id}`),
      notes: state.notes.map((note) => (note.id === id ? { ...note, data: { text } } : note)),
    }));
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
  renameRoute: (id, index, name) => {
    set((state) => {
      const client = state.nodes.find((node) => node.id === id);
      if (client?.type !== 'client') return state;
      const { params } = client.data;
      const before = params.routes[index]?.name;
      if (before === undefined || before === name || params.routes.some((route) => route.name === name)) return state;
      const routes = params.routes.map((route, at) => (at === index ? { ...route, name } : route));
      if (touchesLock(state.level, id, 'client', params, { ...params, routes })) return state;
      // Another client may have a route of the old name; its connections keep it.
      const stillNamed = state.nodes.some((node) => node.id !== id && node.type === 'client' && node.data.params.routes.some((route) => route.name === before));
      return {
        ...remember(state, `route:${id}:${index}`),
        nodes: state.nodes.map((node) => (node.id === id ? ({ ...node, data: { ...node.data, params: { ...params, routes } } } as FlowNode) : node)),
        edges: stillNamed
          ? state.edges
          : state.edges.map((edge) => (edge.data?.params.route === before ? { ...edge, data: { params: { ...edge.data.params, route: name } } } : edge)),
      };
    });
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
        arrows: state.arrows.filter((arrow) => arrow.target !== id),
      };
    });
  },
  replace: (design) => {
    set((state) => ({ ...remember(state, 'replace'), ...fromDesign(design) }));
  },
  adopt: (document) => {
    const { level } = get();
    if (level && brokenRules(level, document.design).length > 0) return false;
    set((state) => ({
      ...remember(state, 'replace'),
      ...fromDesign(document.design),
      // A level's traffic and seed are its own, whatever the document says.
      ...(level ? {} : { seed: document.seed ?? null, workload: document.workload ?? null }),
    }));
    return true;
  },
  open: (slot, fallback, level, { seed, workload, transient = false } = {}) => {
    // The design being left is saved first; its pending save would otherwise be dropped.
    saveNow();
    lastStep = '';
    const document = (transient ? null : stored(slot, level)) ?? {
      design: fallback,
      ...(seed === undefined ? {} : { seed }),
      ...(workload === undefined ? {} : { workload }),
    };
    opening = true;
    try {
      set({
        slot,
        level,
        transient,
        seed: level ? null : (document.seed ?? null),
        workload: level ? null : (document.workload ?? null),
        past: [],
        future: [],
        ...fromDesign(document.design),
      });
    } finally {
      opening = false;
    }
  },
  saveAs: (slot) => {
    const document = documentOf(get());
    if (document) write(slot, document);
  },
  dropWorkload: () => {
    set({ workload: null });
  },
  setWorkload: (workload) => {
    if (get().level === null) set({ workload });
  },
  undo: () => {
    set((state) => {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      lastStep = '';
      return {
        ...previous,
        past: state.past.slice(0, -1),
        future: [...state.future, snapshot(state)],
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
        past: [...state.past, snapshot(state)],
        future: state.future.slice(0, -1),
      };
    });
  },
}));

/** The design on the canvas with its seed and traffic, as it would be saved; null as for `currentDesign`. */
export function currentDocument(): Document | null {
  return documentOf(useDesign.getState());
}

/** The design as the engine sees it, or null while an edit has left it out of bounds. */
export function currentDesign(state: Snapshot): Design | null {
  try {
    return toDesign(state.nodes, state.edges, '', state.notes, state.arrows);
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
  const document = documentOf(state);
  if (document) write(state.slot, document);
}

useDesign.subscribe((state, previous) => {
  if (opening || state.transient) return;
  const drawing = state.nodes === previous.nodes && state.edges === previous.edges && state.notes === previous.notes && state.arrows === previous.arrows;
  if (drawing && state.workload === previous.workload && state.seed === previous.seed) return;
  unsaved = state;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
});
