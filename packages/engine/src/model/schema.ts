import { z } from 'zod';

// Every bound here is also a safety limit: a design can arrive from a share link, a file or an
// agent, and must not be able to ask for an absurd amount of work.

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'must be 1-64 letters, digits, "_" or "-"');
const nameSchema = z.string().max(80).default('');
const coordinateSchema = z.number().min(-1_000_000).max(1_000_000).default(0);
const count = (min: number, max: number) => z.number().int().min(min).max(max);
const fraction = z.number().min(0).max(1);
const duration = (max: number) => z.number().min(0).max(max);

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
  /** Share of requests that are for a file: an image, a script, the same for everyone who asks. */
  fileRatio: fraction.default(0),
  /** Of the requests that are not for a file, the share that only read. The rest write. */
  readRatio: fraction.default(0.9),
  /** How many different items requests ask about. */
  keys: count(1, 1_000_000).default(10_000),
  /** How unevenly requests are spread over the items: 0 is evenly, 1 is typical of real traffic. */
  skew: z.number().min(0).max(2).default(1),
});

export const autoscaleSchema = z.object({
  enabled: z.boolean().default(false),
  min: count(1, 1000).default(1),
  max: count(1, 1000).default(10),
  /** Add instances when busy slots pass this share; remove them well below it. */
  target: z.number().min(0.1).max(0.95).default(0.6),
  /** How long a new instance takes before it can serve. */
  bootMs: duration(3_600_000).default(30_000),
  /** How long to wait after a change before removing an instance. */
  cooldownMs: duration(3_600_000).default(60_000),
});

export const serviceParamsSchema = z.object({
  instances: count(1, 1000).default(1),
  /** Calls one instance works on at once. */
  concurrency: count(1, 100_000).default(8),
  /** Calls one instance holds waiting for a free slot; beyond this they are rejected. */
  queue: count(0, 1_000_000).default(256),
  /** The service's own work per call, not counting time spent waiting on dependencies. */
  serviceTime: distSchema.prefault({ mean: 20 }),
  autoscale: autoscaleSchema.prefault({}),
});

export const workerParamsSchema = z.object({
  instances: count(1, 1000).default(1),
  /** Messages one instance works on at once. */
  concurrency: count(1, 100_000).default(4),
  /** Work per message, not counting time spent waiting on dependencies. */
  serviceTime: distSchema.prefault({ mean: 50 }),
  /** Share of messages whose processing fails by itself. */
  failureRate: fraction.default(0),
  /** A message that has failed this many times is set aside instead of being tried again. */
  maxDeliveries: count(1, 20).default(5),
});

export const loadBalancerParamsSchema = z.object({
  algorithm: z.enum(['round-robin', 'random', 'least-connections', 'two-choices']).default('round-robin'),
  /** How often it checks which instances are alive. A dead one keeps receiving calls until then. */
  healthCheckMs: z.number().min(100).max(600_000).default(5000),
});

export const cacheParamsSchema = z.object({
  /** Items it can hold. The least recently used is dropped to make room. */
  capacity: count(1, 10_000_000).default(1000),
  /** How long an item stays valid; 0 keeps it until it is dropped for room. */
  ttlMs: duration(86_400_000).default(60_000),
  /** Share of each item's lifetime that is randomised, so items stored together do not expire together. */
  ttlJitter: fraction.default(0),
  /** When many calls miss the same item at once, let one fetch it and the rest wait for that. */
  singleFlight: z.boolean().default(false),
});

export const databaseParamsSchema = z.object({
  /** Queries it can run at full speed at once. More than this share the same cores and all slow down. */
  concurrency: count(1, 1024).default(8),
  /** Connections it accepts; beyond this, new ones are refused. */
  maxConnections: count(1, 100_000).default(100),
  readTime: distSchema.prefault({ mean: 5 }),
  writeTime: distSchema.prefault({ mean: 10 }),
  /** Read-only copies. Reads are spread over them; writes always go to the primary. */
  replicas: count(0, 15).default(0),
  /** How long writes are unavailable when the primary fails. */
  failoverMs: duration(3_600_000).default(30_000),
});

export const queueParamsSchema = z.object({
  maxDepth: count(1, 1_000_000).default(10_000),
  /** What happens to a new message when the queue is full. */
  overflow: z.enum(['reject', 'drop-oldest']).default('reject'),
});

export const rateLimiterParamsSchema = z.object({
  /** Calls let through per second. */
  rate: z.number().min(0.1).max(1_000_000).default(100),
  /** Calls let through at once after a quiet spell. */
  burst: z.number().min(1).max(1_000_000).default(100),
});

export const cdnParamsSchema = z.object({
  /** Files it can hold near the people asking. The least recently used is dropped to make room. */
  capacity: count(1, 10_000_000).default(10_000),
  /** How long it keeps a file before asking for it again; 0 keeps it until it is dropped for room. */
  ttlMs: duration(86_400_000).default(300_000),
});

export const objectStoreParamsSchema = z.object({
  /** Time to hand a file over. However many are asked for at once, each takes this long. */
  readTime: distSchema.prefault({ kind: 'lognormal', mean: 40, cv: 0.5 }),
  /** Time to take a file in. */
  writeTime: distSchema.prefault({ kind: 'lognormal', mean: 80, cv: 0.5 }),
});

export const functionParamsSchema = z.object({
  /** Calls it will work on at once, each in an environment of its own; beyond this they are refused. */
  maxConcurrency: count(1, 5000).default(100),
  /** The function's own work per call, not counting time spent waiting on dependencies. */
  serviceTime: distSchema.prefault({ mean: 20 }),
  /** Extra time a call takes when no environment is ready for it and one has to be started. */
  coldStartMs: duration(60_000).default(400),
  /** How long an environment that has finished a call stays ready for another. */
  keepWarmMs: duration(3_600_000).default(300_000),
  /** Environments kept ready at all times, and paid for whether or not they are used. */
  provisioned: count(0, 5000).default(0),
});

const node = <T extends string, P extends z.ZodType>(type: T, params: P) =>
  z.object({ ...nodeBase, type: z.literal(type), params });

export const clientNodeSchema = node('client', clientParamsSchema.prefault({}));
export const serviceNodeSchema = node('service', serviceParamsSchema.prefault({}));
export const workerNodeSchema = node('worker', workerParamsSchema.prefault({}));
export const loadBalancerNodeSchema = node('load-balancer', loadBalancerParamsSchema.prefault({}));
export const cacheNodeSchema = node('cache', cacheParamsSchema.prefault({}));
export const databaseNodeSchema = node('database', databaseParamsSchema.prefault({}));
export const queueNodeSchema = node('queue', queueParamsSchema.prefault({}));
export const rateLimiterNodeSchema = node('rate-limiter', rateLimiterParamsSchema.prefault({}));
export const cdnNodeSchema = node('cdn', cdnParamsSchema.prefault({}));
export const objectStoreNodeSchema = node('object-store', objectStoreParamsSchema.prefault({}));
export const functionNodeSchema = node('function', functionParamsSchema.prefault({}));

export const nodeSchema = z.discriminatedUnion('type', [
  clientNodeSchema,
  serviceNodeSchema,
  workerNodeSchema,
  loadBalancerNodeSchema,
  cacheNodeSchema,
  databaseNodeSchema,
  queueNodeSchema,
  rateLimiterNodeSchema,
  cdnNodeSchema,
  objectStoreNodeSchema,
  functionNodeSchema,
]);

export const breakerSchema = z.object({
  enabled: z.boolean().default(false),
  /** Stop calling when this share of recent calls failed. */
  failureRate: z.number().min(0.05).max(1).default(0.5),
  /** How many recent calls the share is measured over. */
  window: count(5, 1000).default(20),
  /** How long to stop for before trying one call again. */
  openMs: z.number().min(100).max(600_000).default(5000),
});

/** An edge carries the caller's policy for the calls it makes over it. */
export const edgeParamsSchema = z.object({
  /** One-way network delay. */
  latencyMs: duration(60_000).default(1),
  /** How long the caller waits for a reply; 0 waits forever. */
  timeoutMs: duration(600_000).default(3000),
  /** Extra attempts after a failed one. */
  retries: count(0, 10).default(0),
  /** Wait before the first retry. */
  backoffMs: duration(60_000).default(100),
  /** Each further retry waits this many times longer. */
  backoffFactor: z.number().min(1).max(10).default(2),
  /** Fraction of each wait that is randomised: 0 is none, 1 picks anywhere from zero to the full wait. */
  jitter: fraction.default(0),
  /** Which requests use this edge. `data` is reads and writes, which is everything but files. */
  appliesTo: z.enum(['all', 'read', 'write', 'file', 'data']).default('all'),
  /** `async` hands the call over and carries on without waiting for the result. */
  mode: z.enum(['sync', 'async']).default('sync'),
  /** Calls each instance of the caller may have open over this edge at once; 0 is no limit. */
  poolSize: count(0, 100_000).default(0),
  breaker: breakerSchema.prefault({}),
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

const optionalDuration = duration(86_400_000).optional();

/** Something done to a running system: a change in traffic, or a failure injected into it. */
export const commandSchema = z.discriminatedUnion('type', [
  /** Multiplies traffic, on top of the workload's own phases. */
  z.object({ type: z.literal('traffic'), multiplier: z.number().min(0).max(1000), durationMs: optionalDuration }),
  /** Takes instances of a node down. Without `count`, all of them. */
  z.object({ type: z.literal('kill'), nodeId: idSchema, count: count(1, 1000).optional(), durationMs: optionalDuration }),
  /** Makes a node's own work take `factor` times as long. */
  z.object({ type: z.literal('slow'), nodeId: idSchema, factor: z.number().min(1).max(1000), durationMs: optionalDuration }),
  /** Makes a node fail a share of its calls outright, as a bad deploy would. */
  z.object({ type: z.literal('errors'), nodeId: idSchema, rate: fraction, durationMs: optionalDuration }),
  /** Empties a cache. */
  z.object({ type: z.literal('flush'), nodeId: idSchema }),
  /** Fails a database's primary. */
  z.object({ type: z.literal('failover'), nodeId: idSchema }),
  /** Cuts a connection: calls over it fail. */
  z.object({ type: z.literal('sever'), edgeId: idSchema, durationMs: optionalDuration }),
  /** Adds network delay to a connection, each way. */
  z.object({ type: z.literal('delay'), edgeId: idSchema, addMs: duration(600_000), durationMs: optionalDuration }),
]);

/** A change in traffic at a point in time. */
export const phaseSchema = z.object({
  atMs: duration(86_400_000),
  /** Applied to every client's `rps` from `atMs` until the next phase. */
  multiplier: z.number().min(0).max(1000),
});

export const scheduledCommandSchema = z.object({
  atMs: duration(86_400_000),
  command: commandSchema,
});

export const workloadSchema = z.object({
  phases: z.array(phaseSchema).max(500).default([]),
  /** Failures injected at set times. */
  chaos: z.array(scheduledCommandSchema).max(200).default([]),
});

export type Design = z.output<typeof designSchema>;
export type DesignInput = z.input<typeof designSchema>;
export type DesignNode = z.output<typeof nodeSchema>;
export type ClientNode = z.output<typeof clientNodeSchema>;
export type ServiceNode = z.output<typeof serviceNodeSchema>;
export type WorkerNode = z.output<typeof workerNodeSchema>;
export type LoadBalancerNode = z.output<typeof loadBalancerNodeSchema>;
export type CacheNode = z.output<typeof cacheNodeSchema>;
export type DatabaseNode = z.output<typeof databaseNodeSchema>;
export type QueueNode = z.output<typeof queueNodeSchema>;
export type RateLimiterNode = z.output<typeof rateLimiterNodeSchema>;
export type CdnNode = z.output<typeof cdnNodeSchema>;
export type ObjectStoreNode = z.output<typeof objectStoreNodeSchema>;
export type FunctionNode = z.output<typeof functionNodeSchema>;
export type DesignEdge = z.output<typeof edgeSchema>;
export type EdgeParams = z.output<typeof edgeParamsSchema>;
export type NodeType = DesignNode['type'];
export type Command = z.output<typeof commandSchema>;
export type CommandInput = z.input<typeof commandSchema>;
export type Workload = z.output<typeof workloadSchema>;
export type WorkloadInput = z.input<typeof workloadSchema>;

// A record rather than an array, so that leaving a node type out fails to compile.
const listed: Record<NodeType, true> = {
  client: true,
  cdn: true,
  'load-balancer': true,
  'rate-limiter': true,
  service: true,
  function: true,
  cache: true,
  database: true,
  'object-store': true,
  queue: true,
  worker: true,
};

/** Every node type, in the order a palette should list them. */
export const NODE_TYPES = Object.keys(listed) as NodeType[];
