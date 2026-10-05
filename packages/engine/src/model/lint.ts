import { designSchema } from './schema.ts';
import type { Design, DesignEdge, DesignNode } from './schema.ts';

/** A problem found in a design. An `error` stops the design from running; a `warning` does not. */
export interface Issue {
  level: 'error' | 'warning';
  /** Stable identifier, for translation. */
  code: string;
  /** English description. */
  message: string;
  nodeId?: string;
  edgeId?: string;
}

/** Thrown when a design with errors is asked to run. */
export class DesignError extends Error {
  readonly issues: Issue[];

  constructor(issues: Issue[]) {
    super(`The design has errors: ${issues.map((issue) => issue.message).join(' ')}`);
    this.name = 'DesignError';
    this.issues = issues;
  }
}

/** Checks the structure of a design that already has the right shape. */
export function lintDesign(design: Design): Issue[] {
  const issues: Issue[] = [];
  const error = (code: string, message: string, where: Pick<Issue, 'nodeId' | 'edgeId'>) =>
    issues.push({ level: 'error', code, message, ...where });
  const warning = (code: string, message: string, where: Pick<Issue, 'nodeId' | 'edgeId'> = {}) =>
    issues.push({ level: 'warning', code, message, ...where });

  const nodes = new Map<string, DesignNode>();
  for (const node of design.nodes) {
    if (nodes.has(node.id)) error('duplicate-node', `Two nodes share the id "${node.id}".`, { nodeId: node.id });
    nodes.set(node.id, node);
  }

  const edgeIds = new Set<string>();
  const pairs = new Set<string>();
  // The valid edges leaving and entering each node, in design order.
  const outgoing = new Map<string, DesignEdge[]>();
  const incoming = new Map<string, DesignEdge[]>();
  const push = (map: Map<string, DesignEdge[]>, key: string, edge: DesignEdge) => {
    const list = map.get(key);
    if (list) list.push(edge);
    else map.set(key, [edge]);
  };

  for (const edge of design.edges) {
    const where = { edgeId: edge.id };
    if (edgeIds.has(edge.id)) error('duplicate-edge', `Two edges share the id "${edge.id}".`, where);
    edgeIds.add(edge.id);

    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to) {
      const missing = from ? edge.to : edge.from;
      error('dangling-edge', `Edge "${edge.id}" refers to "${missing}", which does not exist.`, where);
      continue;
    }
    if (edge.from === edge.to) {
      error('self-loop', `Edge "${edge.id}" connects "${edge.from}" to itself.`, where);
      continue;
    }
    const pair = `${edge.from}\n${edge.to}`;
    if (pairs.has(pair)) {
      error('parallel-edge', `"${edge.from}" has more than one edge to "${edge.to}".`, where);
      continue;
    }
    pairs.add(pair);
    if (to.type === 'client') {
      error('edge-into-client', `Edge "${edge.id}" points at the client "${edge.to}"; clients only send.`, where);
      continue;
    }
    if (from.type === 'cache' || from.type === 'database') {
      error('leaf-calls', `"${edge.from}" is a ${from.type}; it answers calls and makes none.`, where);
      continue;
    }
    if (from.type === 'queue' && to.type !== 'worker') {
      error('queue-target', `The queue "${edge.from}" can only feed workers, and "${edge.to}" is not one.`, where);
      continue;
    }
    if (to.type === 'worker' && from.type !== 'queue') {
      error('worker-source', `The worker "${edge.to}" takes its work from a queue, not from "${edge.from}".`, where);
      continue;
    }
    if (from.type === 'client' && edge.params.mode === 'async') {
      error('client-async', `The client "${edge.from}" has to wait for its reply; its edge cannot be async.`, where);
      continue;
    }
    push(outgoing, edge.from, edge);
    push(incoming, edge.to, edge);
  }

  let clients = 0;
  for (const node of design.nodes) {
    const where = { nodeId: node.id };
    const out = outgoing.get(node.id) ?? [];
    const callers = incoming.get(node.id) ?? [];

    switch (node.type) {
      case 'client':
        clients++;
        if (out.length === 0) {
          warning('client-unconnected', `The client "${node.id}" is not connected, so it sends no traffic.`, where);
        } else if (out.length > 1) {
          error('client-fan-out', `The client "${node.id}" has ${out.length} outgoing edges; it can have one.`, where);
        }
        break;
      case 'load-balancer':
      case 'rate-limiter':
        if (out.length === 0) {
          warning('pass-through-unconnected', `"${node.id}" has nothing behind it, so every call to it fails.`, where);
        } else if (out.length > 1) {
          error('pass-through-fan-out', `"${node.id}" has ${out.length} outgoing edges; it can have one.`, where);
        } else if (node.type === 'load-balancer' && nodes.get(out[0]!.to)?.type !== 'service') {
          warning('balancer-target', `The load balancer "${node.id}" only spreads load over a service's instances.`, where);
        }
        break;
      case 'service': {
        const many = node.params.instances > 1 || node.params.autoscale.enabled;
        const direct = callers.find((edge) => nodes.get(edge.from)?.type !== 'load-balancer');
        if (many && direct) {
          warning(
            'needs-balancer',
            `"${direct.from}" calls "${node.id}" directly, so its calls all land on the first instance. ` +
              'Put a load balancer in between.',
            where,
          );
        }
        // A cache is checked before the store behind it, which is the next edge reads use.
        out.forEach((edge, index) => {
          if (nodes.get(edge.to)?.type !== 'cache' || edge.params.appliesTo === 'write') return;
          const behind = out.slice(index + 1).find((next) => next.params.appliesTo !== 'write');
          if (!behind || behind.params.mode === 'async') {
            warning('cache-fronts-nothing', `"${node.id}" checks the cache "${edge.to}" but has no store to read after it.`, where);
          }
        });
        break;
      }
      case 'queue':
        if (out.length === 0) {
          warning('queue-unread', `Nothing takes messages from the queue "${node.id}", so it only fills up.`, where);
        }
        break;
      default:
        break;
    }

    if (node.type !== 'client' && callers.length === 0) {
      warning('unreachable', `Nothing calls "${node.id}".`, where);
    }
  }
  if (clients === 0 && design.nodes.length > 0) {
    warning('no-client', 'The design has no client, so nothing sends traffic.');
  }

  // A call that could come back round to a node already handling it would never finish.
  const looping = findCycle(design, outgoing);
  if (looping !== undefined) error('cycle', `The calls through "${looping}" form a loop.`, { nodeId: looping });

  return issues;
}

/** Returns the id of a node on a cycle, if there is one. */
function findCycle(design: Design, outgoing: Map<string, DesignEdge[]>): string | undefined {
  // 1 while a node is on the current path, 2 once everything reachable from it has been cleared.
  const mark = new Map<string, number>();

  for (const start of design.nodes) {
    if (mark.has(start.id)) continue;
    const path: { id: string; next: number }[] = [{ id: start.id, next: 0 }];
    mark.set(start.id, 1);
    while (path.length > 0) {
      const top = path[path.length - 1]!;
      const targets = outgoing.get(top.id) ?? [];
      if (top.next >= targets.length) {
        mark.set(top.id, 2);
        path.pop();
        continue;
      }
      const target = targets[top.next++]!.to;
      const seen = mark.get(target);
      if (seen === 1) return target;
      if (seen === undefined) {
        mark.set(target, 1);
        path.push({ id: target, next: 0 });
      }
    }
  }
  return undefined;
}

/** Parses and lints an untrusted value. `design` is present when the value has the right shape. */
export function checkDesign(input: unknown): { design?: Design; issues: Issue[] } {
  const parsed = designSchema.safeParse(input);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((issue) => ({
        level: 'error',
        code: 'schema',
        message: issue.path.length > 0 ? `${issue.path.map(String).join('.')}: ${issue.message}` : issue.message,
      })),
    };
  }
  return { design: parsed.data, issues: lintDesign(parsed.data) };
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((issue) => issue.level === 'error');
}
