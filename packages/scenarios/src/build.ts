import { designSchema, workloadSchema } from '@loadline/engine';
import type { Design, DesignInput, Workload, WorkloadInput } from '@loadline/engine';

// Small helpers for writing levels: a design from a compact description, and traffic that ramps.

export type NodeInput = NonNullable<DesignInput['nodes']>[number];
export type Link = [from: string, to: string, params?: NonNullable<DesignInput['edges']>[number]['params']];

/** Canvas positions are on a grid, so a level reads as columns of parts from left to right. */
const COLUMN = 280;
const ROW = 120;

/** A node at a place on the grid. `row` may be a half, to sit between two rows. */
export function at<T extends Omit<NodeInput, 'x' | 'y'>>(column: number, row: number, node: T): T & { x: number; y: number } {
  return { ...node, x: column * COLUMN, y: row * ROW };
}

/** A design from nodes and `[from, to, policy]` connections. An edge's id is `from--to`. */
export function design(name: string, nodes: NodeInput[], links: Link[]): Design {
  return designSchema.parse({
    name,
    nodes,
    edges: links.map(([from, to, params]) => ({ id: `${from}--${to}`, from, to, ...(params ? { params } : {}) })),
  });
}

export function workload(input: WorkloadInput): Workload {
  return workloadSchema.parse(input);
}

/** Traffic that climbs from one level to another in even steps, one a second. */
export function ramp(fromMs: number, toMs: number, from: number, to: number): { atMs: number; multiplier: number }[] {
  const steps = Math.max(1, Math.round((toMs - fromMs) / 1000));
  return Array.from({ length: steps }, (_, i) => ({
    atMs: fromMs + ((toMs - fromMs) * i) / steps,
    multiplier: from + ((to - from) * (i + 1)) / steps,
  }));
}
