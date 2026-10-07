import { designSchema, edgeSchema, lintDesign, nodeSchema } from '@loadline/engine';
import type { Design, DesignEdge, DesignInput, DesignNode, DesignNote, NodeType } from '@loadline/engine';
import { MarkerType } from '@xyflow/react';
import type { Edge, Node } from '@xyflow/react';

// The canvas keeps the design in React Flow's shape; the engine wants its own. These functions
// convert between the two, and hold the rules for what may be added or connected.

/** The canvas node for one kind of part: its name and its settings. */
export type FlowNodeOf<T extends NodeType> = Node<{ name: string; params: Extract<DesignNode, { type: T }>['params'] }, T>;
export type FlowNode = { [T in NodeType]: FlowNodeOf<T> }[NodeType];
export type FlowEdge = Edge<{ params: DesignEdge['params'] }, 'flow'>;
/** A note on the drawing, and the line from a note to a part it points at. Neither is simulated. */
export type FlowNote = Node<{ text: string }, 'note'>;
export type FlowArrow = Edge<Record<string, never>, 'straight'>;

// A note's id on the canvas has a colon in it, which the id of a part cannot have, so the two can
// share one canvas without ever being taken for each other.
const NOTE_PREFIX = 'note:';
export const isNoteId = (id: string): boolean => id.startsWith(NOTE_PREFIX);
const arrowId = (note: string, part: string) => `${note}>${part}`;
export const isArrowId = (id: string): boolean => id.startsWith(NOTE_PREFIX);

/** What a new visitor sees: a small system that copes at normal traffic and saturates at about 1.6x. */
export const STARTER: DesignInput = {
  name: 'Starter',
  nodes: [
    { id: 'users', type: 'client', name: 'Users', x: 0, y: 60, params: { rps: 200 } },
    {
      id: 'api',
      type: 'service',
      name: 'API',
      x: 300,
      y: 40,
      params: { concurrency: 16, queue: 256, serviceTime: { kind: 'exp', mean: 20 } },
    },
    {
      id: 'store',
      type: 'service',
      name: 'Store',
      x: 620,
      y: 40,
      params: { concurrency: 4, queue: 128, serviceTime: { kind: 'exp', mean: 12 } },
    },
  ],
  edges: [
    { id: 'users--api', from: 'users', to: 'api' },
    { id: 'api--store', from: 'api', to: 'store', params: { timeoutMs: 1000 } },
  ],
};

// The arrowhead that shows which way calls go. An SVG marker cannot read a CSS variable, so this
// repeats the value of --color-ink.
const ARROW = { type: MarkerType.ArrowClosed, width: 18, height: 18, color: '#111111' } as const;

const toFlowEdge = (edge: DesignEdge): FlowEdge => ({
  id: edge.id,
  type: 'flow',
  source: edge.from,
  target: edge.to,
  markerEnd: ARROW,
  data: { params: edge.params },
});

/** The line from a note to a part: dashed, so that it is not taken for a connection. */
export function createArrow(note: string, part: string): FlowArrow {
  return {
    id: arrowId(note, part),
    type: 'straight',
    source: note,
    target: part,
    markerEnd: ARROW,
    style: { stroke: ARROW.color, strokeDasharray: '5 4' },
  };
}

const toFlowNote = (note: DesignNote): FlowNote => ({
  id: `${NOTE_PREFIX}${note.id}`,
  type: 'note',
  position: { x: note.x, y: note.y },
  data: { text: note.text },
});

/** A new, empty note with an unused id. */
export function createNote(notes: FlowNote[], position: { x: number; y: number }): FlowNote {
  const taken = new Set(notes.map((note) => note.id));
  let n = 1;
  while (taken.has(`${NOTE_PREFIX}n${n}`)) n++;
  return toFlowNote({ id: `n${n}`, text: '', x: position.x, y: position.y, to: [] });
}

export function fromDesign(design: Design): { nodes: FlowNode[]; edges: FlowEdge[]; notes: FlowNote[]; arrows: FlowArrow[] } {
  const parts = new Set(design.nodes.map((node) => node.id));
  const notes = design.notes ?? [];
  return {
    notes: notes.map(toFlowNote),
    // A note may point at a part that has since gone; that line is simply not drawn.
    arrows: notes.flatMap((note) =>
      [...new Set(note.to)].filter((part) => parts.has(part)).map((part) => createArrow(`${NOTE_PREFIX}${note.id}`, part)),
    ),
    nodes: design.nodes.map(
      (node) =>
        ({
          id: node.id,
          type: node.type,
          position: { x: node.x, y: node.y },
          ariaLabel: node.name || node.id,
          data: { name: node.name, params: node.params },
          // Each kind of node pairs its type with its own params; the union cannot see that here.
        }) as FlowNode,
    ),
    edges: design.edges.map(toFlowEdge),
  };
}

export function toDesign(nodes: FlowNode[], edges: FlowEdge[], name = '', notes: FlowNote[] = [], arrows: FlowArrow[] = []): Design {
  return designSchema.parse({
    name,
    ...(notes.length === 0
      ? {}
      : {
          notes: notes.map((note) => ({
            id: note.id.slice(NOTE_PREFIX.length),
            text: note.data.text,
            x: Math.round(note.position.x),
            y: Math.round(note.position.y),
            to: arrows.filter((arrow) => arrow.source === note.id).map((arrow) => arrow.target),
          })),
        }),
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      name: node.data.name,
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
      params: node.data.params,
    })),
    edges: edges.map((edge) => ({ id: edge.id, from: edge.source, to: edge.target, params: edge.data?.params })),
  });
}

/**
 * The nodes and edges of a design, without their settings, as a string. While this is unchanged a
 * run can take on new settings without starting again.
 */
export function structureKey(design: Design): string {
  return JSON.stringify({
    nodes: design.nodes.map((node) => [node.id, node.type]),
    edges: design.edges.map((edge) => [edge.id, edge.from, edge.to]),
  });
}

/**
 * Everything about a design the simulation depends on, as a string. Moving or renaming a node
 * leaves it unchanged, so those edits do not touch a run at all.
 */
export function simulationKey(design: Design): string {
  return JSON.stringify({
    nodes: design.nodes.map((node) => [node.id, node.type, node.params]),
    edges: design.edges.map((edge) => [edge.id, edge.from, edge.to, edge.params]),
  });
}

/** A new node of the given type, with the schema's default settings and an unused id. */
export function createNode(type: NodeType, name: string, nodes: FlowNode[], position: { x: number; y: number }): FlowNode {
  const taken = new Set(nodes.map((node) => node.id));
  let n = 1;
  while (taken.has(`${type}-${n}`)) n++;
  const parsed = nodeSchema.parse({ id: `${type}-${n}`, type, name: `${name} ${n}`, x: position.x, y: position.y });
  return fromDesign(designSchema.parse({ nodes: [parsed] })).nodes[0]!;
}

/** A new edge with the schema's default policy. */
export function createEdge(source: string, target: string, route = ''): FlowEdge {
  return toFlowEdge(edgeSchema.parse({ id: `${source}--${target}`, from: source, to: target, params: { route } }));
}

/**
 * The connection that drawing a line from `source` to `target` makes. A client that already has a
 * connection can only have another for requests the first is not for, so its next one is given the
 * first of its routes that has none yet. With no route to spare it is an ordinary connection, and
 * the engine's check then turns it down.
 */
export function edgeToDraw(nodes: FlowNode[], edges: FlowEdge[], source: string, target: string): FlowEdge {
  const from = nodes.find((node) => node.id === source);
  const taken = edges.filter((edge) => edge.source === source).map((edge) => edge.data?.params.route ?? '');
  if (from?.type !== 'client' || taken.length === 0) return createEdge(source, target);
  const free = from.data.params.routes.find((route) => !taken.includes(route.name));
  return createEdge(source, target, free?.name ?? '');
}

/**
 * Whether dragging a connection from `source` to `target` should be allowed: it is, when the
 * design with that connection added has no error the design without it did not have. The engine's
 * own check decides, so the canvas can never allow what the engine would refuse.
 */
export function canConnect(nodes: FlowNode[], edges: FlowEdge[], source: string, target: string): boolean {
  try {
    const errors = (list: FlowEdge[]) =>
      lintDesign(toDesign(nodes, list)).filter((issue) => issue.level === 'error').length;
    return errors([...edges, edgeToDraw(nodes, edges, source, target)]) <= errors(edges);
  } catch {
    return false;
  }
}
