import { designSchema, edgeSchema, nodeSchema } from '@loadline/engine';
import type { ClientNode, Design, DesignEdge, DesignInput, NodeType, ServiceNode } from '@loadline/engine';
import { MarkerType } from '@xyflow/react';
import type { Edge, Node } from '@xyflow/react';

// The canvas keeps the design in React Flow's shape; the engine wants its own. These functions
// convert between the two, and hold the rules for what may be added or connected.

export type ClientFlowNode = Node<{ name: string; params: ClientNode['params'] }, 'client'>;
export type ServiceFlowNode = Node<{ name: string; params: ServiceNode['params'] }, 'service'>;
export type FlowNode = ClientFlowNode | ServiceFlowNode;
export type FlowEdge = Edge<{ params: DesignEdge['params'] }, 'flow'>;

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

const DEFAULT_NAMES: Record<NodeType, string> = { client: 'Client', service: 'Service' };

// The arrowhead that shows which way calls go. An SVG marker cannot read a CSS variable, so this
// repeats the value of --color-ink-3.
const ARROW = { type: MarkerType.ArrowClosed, width: 18, height: 18, color: '#5e7183' } as const;

export function fromDesign(design: Design): { nodes: FlowNode[]; edges: FlowEdge[] } {
  return {
    nodes: design.nodes.map((node): FlowNode => {
      const shared = { id: node.id, position: { x: node.x, y: node.y }, ariaLabel: node.name || node.id };
      // Spelled out per type so that each node's params keep their own type.
      return node.type === 'client'
        ? { ...shared, type: 'client', data: { name: node.name, params: node.params } }
        : { ...shared, type: 'service', data: { name: node.name, params: node.params } };
    }),
    edges: design.edges.map((edge) => ({
      id: edge.id,
      type: 'flow',
      source: edge.from,
      target: edge.to,
      markerEnd: ARROW,
      data: { params: edge.params },
    })),
  };
}

export function toDesign(nodes: FlowNode[], edges: FlowEdge[], name = ''): Design {
  return designSchema.parse({
    name,
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
 * The part of a design the simulation depends on, as a string. Moving or renaming a node leaves it
 * unchanged, so those edits do not restart a run.
 */
export function simulationKey(design: Design): string {
  return JSON.stringify({
    nodes: design.nodes.map((node) => [node.id, node.type, node.params]),
    edges: design.edges.map((edge) => [edge.id, edge.from, edge.to, edge.params]),
  });
}

/** A new node of the given type, with the schema's default parameters and an unused id. */
export function createNode(type: NodeType, nodes: FlowNode[], position: { x: number; y: number }): FlowNode {
  const taken = new Set(nodes.map((node) => node.id));
  let n = 1;
  while (taken.has(`${type}-${n}`)) n++;
  const parsed = nodeSchema.parse({ id: `${type}-${n}`, type, name: `${DEFAULT_NAMES[type]} ${n}` });
  const design = designSchema.parse({ nodes: [{ ...parsed, x: position.x, y: position.y }] });
  return fromDesign(design).nodes[0]!;
}

/** A new edge with the schema's default policy. */
export function createEdge(source: string, target: string): FlowEdge {
  const parsed = edgeSchema.parse({ id: `${source}--${target}`, from: source, to: target });
  return { id: parsed.id, type: 'flow', source, target, markerEnd: ARROW, data: { params: parsed.params } };
}

/** Whether dragging a connection from `source` to `target` should be allowed. */
export function canConnect(nodes: FlowNode[], edges: FlowEdge[], source: string, target: string): boolean {
  if (source === target) return false;
  const from = nodes.find((node) => node.id === source);
  const to = nodes.find((node) => node.id === target);
  if (!from || !to || to.type === 'client') return false;
  if (edges.some((edge) => edge.source === source && edge.target === target)) return false;
  // A client sends to one entry point.
  if (from.type === 'client' && edges.some((edge) => edge.source === source)) return false;
  // Following calls from the target must not lead back to the source.
  const seen = new Set<string>([target]);
  const pending = [target];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === source) return false;
    for (const edge of edges) {
      if (edge.source === current && !seen.has(edge.target)) {
        seen.add(edge.target);
        pending.push(edge.target);
      }
    }
  }
  return true;
}
