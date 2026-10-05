import { z } from 'zod';

// Every bound here is also a safety limit: a design can arrive from a share link, a file or an
// agent, and must not be able to ask for an absurd amount of work.

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'must be 1-64 letters, digits, "_" or "-"');
const nameSchema = z.string().max(80).default('');
const coordinateSchema = z.number().min(-1_000_000).max(1_000_000).default(0);
const count = (min: number, max: number) => z.number().int().min(min).max(max);

/** How a duration varies from one draw to the next. */
export const distSchema = z.object({
  kind: z.enum(['const', 'exp', 'lognormal']).default('exp'),
  /** Mean, in milliseconds. */
  mean: z.number().positive().max(600_000),
  /** Coefficient of variation; used by `lognormal` only. */
  cv: z.number().min(0).max(10).optional(),
});

const nodeBase = {
  id: idSchema,
  name: nameSchema,
  x: coordinateSchema,
  y: coordinateSchema,
};

export const clientParamsSchema = z.object({
  /** New requests per second, before the workload's multiplier. */
  rps: z.number().min(0).max(200_000).default(100),
});

export const serviceParamsSchema = z.object({
  instances: count(1, 1000).default(1),
  /** Calls one instance works on at once. */
  concurrency: count(1, 100_000).default(8),
  /** Calls one instance holds waiting for a free slot; beyond this they are rejected. */
  queue: count(0, 1_000_000).default(256),
  /** The service's own work per call, not counting time spent waiting on dependencies. */
  serviceTime: distSchema.prefault({ mean: 20 }),
});

export const clientNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('client'),
  params: clientParamsSchema.prefault({}),
});

export const serviceNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('service'),
  params: serviceParamsSchema.prefault({}),
});

export const nodeSchema = z.discriminatedUnion('type', [clientNodeSchema, serviceNodeSchema]);

/** An edge carries the caller's policy for the calls it makes over it. */
export const edgeParamsSchema = z.object({
  /** One-way network delay. */
  latencyMs: z.number().min(0).max(60_000).default(1),
  /** How long the caller waits for a reply; 0 waits forever. */
  timeoutMs: z.number().min(0).max(600_000).default(3000),
  /** Extra attempts after a failed one. */
  retries: count(0, 10).default(0),
  /** Wait before the first retry. */
  backoffMs: z.number().min(0).max(60_000).default(100),
  /** Each further retry waits this many times longer. */
  backoffFactor: z.number().min(1).max(10).default(2),
  /** Fraction of each wait that is randomised: 0 is none, 1 picks anywhere from zero to the full wait. */
  jitter: z.number().min(0).max(1).default(0),
});

export const edgeSchema = z.object({
  id: idSchema,
  from: idSchema,
  to: idSchema,
  params: edgeParamsSchema.prefault({}),
});

export const designSchema = z.object({
  version: z.literal(1).default(1),
  name: z.string().max(120).default(''),
  nodes: z.array(nodeSchema).max(200).default([]),
  edges: z.array(edgeSchema).max(500).default([]),
});

/** A change in traffic at a point in time. */
export const phaseSchema = z.object({
  atMs: z.number().min(0).max(86_400_000),
  /** Applied to every client's `rps` from `atMs` until the next phase. */
  multiplier: z.number().min(0).max(1000),
});

export const workloadSchema = z.object({
  phases: z.array(phaseSchema).max(500).default([]),
});

export type Design = z.output<typeof designSchema>;
export type DesignInput = z.input<typeof designSchema>;
export type DesignNode = z.output<typeof nodeSchema>;
export type ClientNode = z.output<typeof clientNodeSchema>;
export type ServiceNode = z.output<typeof serviceNodeSchema>;
export type DesignEdge = z.output<typeof edgeSchema>;
export type EdgeParams = z.output<typeof edgeParamsSchema>;
export type NodeType = DesignNode['type'];
export type Workload = z.output<typeof workloadSchema>;
export type WorkloadInput = z.input<typeof workloadSchema>;
