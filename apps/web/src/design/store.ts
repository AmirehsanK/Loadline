import { checkDesign, designSchema, hasErrors } from '@loadline/engine';
import type { Design, DesignEdge, NodeType } from '@loadline/engine';
import { applyEdgeChanges, applyNodeChanges } from '@xyflow/react';
import type { Connection, EdgeChange, NodeChange } from '@xyflow/react';
import { create } from 'zustand';
import { STARTER, canConnect, createEdge, createNode, fromDesign, toDesign } from './model.ts';
import type { FlowEdge, FlowNode } from './model.ts';

const STORAGE_KEY = 'loadline:design:v1';

interface DesignState {
  nodes: FlowNode[];
  edges: FlowEdge[];
  onNodesChange: (changes: NodeChange<FlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<FlowEdge>[]) => void;
  connect: (connection: Connection) => void;
  addNode: (type: NodeType, position: { x: number; y: number }) => void;
  renameNode: (id: string, name: string) => void;
  /** Merges `patch` into a node's parameters. */
  patchNode: (id: string, patch: Record<string, unknown>) => void;
  patchEdge: (id: string, patch: Partial<DesignEdge['params']>) => void;
  remove: (kind: 'node' | 'edge', id: string) => void;
  replace: (design: Design) => void;
}

/** The design saved by an earlier visit, if it is still valid; otherwise the starter. */
function initial(): Design {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      // Saved data is checked like any other input: it may be from an older version, or edited.
      const { design, issues } = checkDesign(JSON.parse(stored));
      if (design && !hasErrors(issues)) return design;
    }
  } catch {
    // Storage can be unavailable or hold something unreadable; start from the starter either way.
  }
  return designSchema.parse(STARTER);
}

export const useDesign = create<DesignState>((set) => ({
  ...fromDesign(initial()),

  onNodesChange: (changes) => {
    set((state) => ({ nodes: applyNodeChanges(changes, state.nodes) }));
  },
  onEdgesChange: (changes) => {
    set((state) => ({ edges: applyEdgeChanges(changes, state.edges) }));
  },
  connect: ({ source, target }) => {
    set((state) =>
      canConnect(state.nodes, state.edges, source, target)
        ? { edges: [...state.edges, createEdge(source, target)] }
        : state,
    );
  },
  addNode: (type, position) => {
    set((state) => {
      const node = createNode(type, state.nodes, position);
      // Select the new node, so its settings are in front of the user straight away.
      return {
        nodes: [...state.nodes.map((other) => ({ ...other, selected: false })), { ...node, selected: true }],
        edges: state.edges.map((edge) => ({ ...edge, selected: false })),
      };
    });
  },
  renameNode: (id, name) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id ? ({ ...node, ariaLabel: name || id, data: { ...node.data, name } } as FlowNode) : node,
      ),
    }));
  },
  patchNode: (id, patch) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id
          ? ({ ...node, data: { ...node.data, params: { ...node.data.params, ...patch } } } as FlowNode)
          : node,
      ),
    }));
  },
  patchEdge: (id, patch) => {
    set((state) => ({
      edges: state.edges.map((edge) =>
        edge.id === id && edge.data ? { ...edge, data: { params: { ...edge.data.params, ...patch } } } : edge,
      ),
    }));
  },
  remove: (kind, id) => {
    set((state) =>
      kind === 'edge'
        ? { edges: state.edges.filter((edge) => edge.id !== id) }
        : {
            nodes: state.nodes.filter((node) => node.id !== id),
            edges: state.edges.filter((edge) => edge.source !== id && edge.target !== id),
          },
    );
  },
  replace: (design) => {
    set(fromDesign(design));
  },
}));

/** The design as the engine sees it, or null while an edit has left it out of bounds. */
export function currentDesign(state: Pick<DesignState, 'nodes' | 'edges'>): Design | null {
  try {
    return toDesign(state.nodes, state.edges);
  } catch {
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
useDesign.subscribe((state) => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const design = currentDesign(state);
    if (!design) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(design));
    } catch {
      // A full or disabled store only costs the user their saved design, not the session.
    }
  }, 400);
});
