import type { Design } from '../model/schema.ts';
import type { NodeWindow } from '../nodes/base.ts';
import type { EdgeWindow, WindowSample } from '../sim.ts';

/** A caller is "spending its time on" a dependency when that takes at least this share of it. */
const DOMINANT = 0.5;
/** Busy enough that calls have started to wait. */
const SATURATED = 0.85;

/** Where a design's time is going, and what it is short of there. */
export interface Bottleneck {
  /** The node at the end of the trail. */
  nodeId: string;
  /**
   * - `saturated`: its slots are full, and calls wait for one. The waiting may be happening in
   *   a caller's connection pool, when that is what keeps the node from being given too much.
   * - `contended`: a database running more queries than it has cores for.
   * - `pool`: callers are waiting for a connection over `edgeId` while the node behind it has
   *   room: the pool is what is short.
   * - `down`: it has no instance up.
   * - `work`: the time is its own work, and it has room to spare. Nothing is short; it is just slow.
   */
  kind: 'saturated' | 'contended' | 'pool' | 'down' | 'work';
  /** For `pool`: the edge whose connections have run out. */
  edgeId?: string;
  /** The nodes the slowness passes through on its way upstream, entry point first. */
  path: string[];
  /** Share of the node's slots that were busy. */
  utilization: number;
}

/**
 * Adds up a run of sampling windows into one. Counts and times are summed; utilization is averaged;
 * what was held at an instant (queued, in flight, instances) is taken from the last window.
 */
export function summarize(samples: WindowSample[]): WindowSample | undefined {
  const last = samples[samples.length - 1];
  if (!last) return undefined;
  const sum = (pick: (sample: WindowSample) => number) => samples.reduce((total, sample) => total + pick(sample), 0);
  const ok = sum((sample) => sample.ok);
  const weighted = (pick: (sample: WindowSample) => number) =>
    ok > 0 ? sum((sample) => pick(sample) * sample.ok) / ok : 0;

  return {
    t: last.t,
    created: sum((sample) => sample.created),
    ok,
    failed: sum((sample) => sample.failed),
    attempts: sum((sample) => sample.attempts),
    meanMs: weighted((sample) => sample.meanMs),
    // A percentile cannot be rebuilt from windows; the worst window is the honest stand-in.
    p50: Math.max(...samples.map((sample) => sample.p50)),
    p95: Math.max(...samples.map((sample) => sample.p95)),
    p99: Math.max(...samples.map((sample) => sample.p99)),
    nodes: last.nodes.map((node, index): NodeWindow => {
      const each = samples.map((sample) => sample.nodes[index]!);
      const total = (pick: (window: NodeWindow) => number) => each.reduce((value, window) => value + pick(window), 0);
      const done = total((window) => window.ok);
      return {
        ...node,
        arrivals: total((window) => window.arrivals),
        ok: done,
        failed: total((window) => window.failed),
        utilization: total((window) => window.utilization) / each.length,
        busyMs: total((window) => window.busyMs),
        meanMs: done > 0 ? total((window) => window.meanMs * window.ok) / done : 0,
        p99: Math.max(...each.map((window) => window.p99)),
        hits: total((window) => window.hits),
        misses: total((window) => window.misses),
      };
    }),
    edges: last.edges.map((_edge, index): EdgeWindow => {
      const each = samples.map((sample) => sample.edges[index]!);
      const total = (pick: (window: EdgeWindow) => number) => each.reduce((value, window) => value + pick(window), 0);
      return {
        calls: total((window) => window.calls),
        failed: total((window) => window.failed),
        waitMs: total((window) => window.waitMs),
        poolWaitMs: total((window) => window.poolWaitMs),
      };
    }),
  };
}

/**
 * Follows the time. Starting from each client, it asks what the node spent its busy time on: if
 * most of it went on waiting for one dependency, it moves to that dependency and asks again. Where
 * it stops is where the time is really going, however far upstream the symptoms showed.
 *
 * `sample` is one sampling window, or several put together by `summarize`. Returns null when no
 * traffic is flowing.
 */
export function findBottleneck(design: Design, sample: WindowSample): Bottleneck | null {
  const indexOf = new Map(design.nodes.map((node, index) => [node.id, index]));
  const outgoing: number[][] = design.nodes.map(() => []);
  design.edges.forEach((edge, index) => {
    const from = indexOf.get(edge.from);
    if (from !== undefined && edge.params.mode === 'sync') outgoing[from]!.push(index);
  });

  // Something that is down fails its callers at once, so no time is spent waiting on it and the
  // trail below would never reach it. Look for that first.
  const down = findDown(design, sample, outgoing, indexOf);
  if (down) return down;

  for (let start = 0; start < design.nodes.length; start++) {
    if (design.nodes[start]!.type !== 'client') continue;
    const path: string[] = [];
    let at = start;
    // A design has no loops, so this ends; the bound is a guard against a sample that lies.
    for (let hops = 0; hops <= design.nodes.length; hops++) {
      const node = design.nodes[at]!;
      const window = sample.nodes[at]!;
      const isClient = node.type === 'client';
      if (!isClient) path.push(node.id);

      let heaviest = -1;
      let most = 0;
      for (const edgeIndex of outgoing[at]!) {
        const waited = sample.edges[edgeIndex]!.waitMs;
        if (waited > most) {
          most = waited;
          heaviest = edgeIndex;
        }
      }
      if (heaviest >= 0 && most >= DOMINANT * window.busyMs) {
        const edge = sample.edges[heaviest]!;
        const next = indexOf.get(design.edges[heaviest]!.to)!;
        if (!isClient && edge.poolWaitMs >= DOMINANT * edge.waitMs) {
          // Waiting for a connection. If what is behind the pool is flat out, the pool is doing
          // its job and that node is what is short; if it has room, the pool is.
          const behind = sample.nodes[next]!;
          if (behind.utilization >= SATURATED) {
            const target = design.nodes[next]!.id;
            return { nodeId: target, kind: 'saturated', path: [...path, target], utilization: behind.utilization };
          }
          return { nodeId: node.id, kind: 'pool', edgeId: design.edges[heaviest]!.id, path, utilization: window.utilization };
        }
        at = next;
        continue;
      }

      // No dependency accounts for it: the time is spent here.
      if (isClient) break;
      const contended = node.type === 'database' && window.queued > 0;
      const full = window.utilization >= SATURATED || window.queued > 0;
      return {
        nodeId: node.id,
        kind: contended ? 'contended' : full ? 'saturated' : 'work',
        path,
        utilization: window.utilization,
      };
    }
  }
  return null;
}

/** The node nearest a client, along the calls it makes, that has no instance up. */
function findDown(
  design: Design,
  sample: WindowSample,
  outgoing: number[][],
  indexOf: Map<string, number>,
): Bottleneck | null {
  // Breadth first, so the nearest one is found; `via` remembers how each node was reached.
  const via = new Map<number, number>();
  const pending: number[] = [];
  design.nodes.forEach((node, index) => {
    if (node.type !== 'client') return;
    via.set(index, -1);
    pending.push(index);
  });

  for (let i = 0; i < pending.length; i++) {
    const at = pending[i]!;
    const node = design.nodes[at]!;
    if (node.type !== 'client' && sample.nodes[at]!.instances === 0) {
      const path: string[] = [];
      for (let step = at; step >= 0 && design.nodes[step]!.type !== 'client'; step = via.get(step)!) {
        path.unshift(design.nodes[step]!.id);
      }
      return { nodeId: node.id, kind: 'down', path, utilization: 0 };
    }
    for (const edgeIndex of outgoing[at]!) {
      const next = indexOf.get(design.edges[edgeIndex]!.to)!;
      if (via.has(next)) continue;
      via.set(next, at);
      pending.push(next);
    }
  }
  return null;
}
