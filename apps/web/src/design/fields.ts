import type { NodeType } from '@loadline/engine';

// What can be edited on each kind of part and on a connection, in the order the inspector shows
// it. The bounds repeat the engine's schema, which has the final say: a value the schema refuses
// never reaches a run. The words for each field are in the message catalog, under the same path.

export type Field =
  | { kind: 'number'; path: string; min: number; max: number; step?: number; integer?: boolean; unit?: 'ms' | 'times' }
  | { kind: 'choice'; path: string; options: readonly string[] }
  | { kind: 'toggle'; path: string }
  /** A duration and how much it varies. */
  | { kind: 'work'; path: string };

export type FieldSpec = Field & {
  /** Shown only while the setting at this path is true. */
  when?: string;
};

const MS = { unit: 'ms' } as const;

export const NODE_FIELDS: Record<NodeType, FieldSpec[]> = {
  client: [
    { kind: 'number', path: 'rps', min: 0, max: 200_000, step: 10 },
    { kind: 'number', path: 'fileRatio', min: 0, max: 1, step: 0.05 },
    { kind: 'number', path: 'readRatio', min: 0, max: 1, step: 0.05 },
    { kind: 'number', path: 'keys', min: 1, max: 1_000_000, step: 1000, integer: true },
    { kind: 'number', path: 'skew', min: 0, max: 2, step: 0.1 },
  ],
  service: [
    { kind: 'number', path: 'instances', min: 1, max: 1000, integer: true },
    { kind: 'number', path: 'concurrency', min: 1, max: 100_000, integer: true },
    { kind: 'work', path: 'serviceTime' },
    { kind: 'number', path: 'queue', min: 0, max: 1_000_000, integer: true },
    { kind: 'toggle', path: 'autoscale.enabled' },
    { kind: 'number', path: 'autoscale.min', min: 1, max: 1000, integer: true, when: 'autoscale.enabled' },
    { kind: 'number', path: 'autoscale.max', min: 1, max: 1000, integer: true, when: 'autoscale.enabled' },
    { kind: 'number', path: 'autoscale.target', min: 0.1, max: 0.95, step: 0.05, when: 'autoscale.enabled' },
    { kind: 'number', path: 'autoscale.bootMs', min: 0, max: 3_600_000, step: 1000, ...MS, when: 'autoscale.enabled' },
    { kind: 'number', path: 'autoscale.cooldownMs', min: 0, max: 3_600_000, step: 1000, ...MS, when: 'autoscale.enabled' },
  ],
  worker: [
    { kind: 'number', path: 'instances', min: 1, max: 1000, integer: true },
    { kind: 'number', path: 'concurrency', min: 1, max: 100_000, integer: true },
    { kind: 'work', path: 'serviceTime' },
    { kind: 'number', path: 'failureRate', min: 0, max: 1, step: 0.05 },
    { kind: 'number', path: 'maxDeliveries', min: 1, max: 20, integer: true },
  ],
  'load-balancer': [
    { kind: 'choice', path: 'algorithm', options: ['round-robin', 'random', 'least-connections', 'two-choices'] },
    { kind: 'number', path: 'healthCheckMs', min: 100, max: 600_000, step: 500, ...MS },
  ],
  cache: [
    { kind: 'number', path: 'capacity', min: 1, max: 10_000_000, step: 100, integer: true },
    { kind: 'number', path: 'ttlMs', min: 0, max: 86_400_000, step: 1000, ...MS },
    { kind: 'number', path: 'ttlJitter', min: 0, max: 1, step: 0.1 },
    { kind: 'toggle', path: 'singleFlight' },
  ],
  database: [
    { kind: 'number', path: 'concurrency', min: 1, max: 1024, integer: true },
    { kind: 'number', path: 'maxConnections', min: 1, max: 100_000, integer: true },
    { kind: 'work', path: 'readTime' },
    { kind: 'work', path: 'writeTime' },
    { kind: 'number', path: 'replicas', min: 0, max: 15, integer: true },
    { kind: 'number', path: 'failoverMs', min: 0, max: 3_600_000, step: 1000, ...MS },
  ],
  queue: [
    { kind: 'number', path: 'maxDepth', min: 1, max: 1_000_000, step: 100, integer: true },
    { kind: 'choice', path: 'overflow', options: ['reject', 'drop-oldest'] },
  ],
  'rate-limiter': [
    { kind: 'number', path: 'rate', min: 0.1, max: 1_000_000, step: 10 },
    { kind: 'number', path: 'burst', min: 1, max: 1_000_000, step: 10 },
  ],
  cdn: [
    { kind: 'number', path: 'capacity', min: 1, max: 10_000_000, step: 1000, integer: true },
    { kind: 'number', path: 'ttlMs', min: 0, max: 86_400_000, step: 1000, ...MS },
  ],
  'object-store': [
    { kind: 'work', path: 'readTime' },
    { kind: 'work', path: 'writeTime' },
  ],
  function: [
    { kind: 'number', path: 'maxConcurrency', min: 1, max: 5000, integer: true },
    { kind: 'work', path: 'serviceTime' },
    { kind: 'number', path: 'coldStartMs', min: 0, max: 60_000, step: 50, ...MS },
    { kind: 'number', path: 'keepWarmMs', min: 0, max: 3_600_000, step: 1000, ...MS },
    { kind: 'number', path: 'provisioned', min: 0, max: 5000, integer: true },
  ],
};

export const EDGE_FIELDS: FieldSpec[] = [
  { kind: 'choice', path: 'appliesTo', options: ['all', 'data', 'read', 'write', 'file'] },
  { kind: 'choice', path: 'mode', options: ['sync', 'async'] },
  { kind: 'number', path: 'timeoutMs', min: 0, max: 600_000, step: 100, ...MS },
  { kind: 'number', path: 'retries', min: 0, max: 10, integer: true },
  { kind: 'number', path: 'backoffMs', min: 0, max: 60_000, step: 10, ...MS },
  { kind: 'number', path: 'backoffFactor', min: 1, max: 10, step: 0.5, unit: 'times' },
  { kind: 'number', path: 'jitter', min: 0, max: 1, step: 0.1 },
  { kind: 'number', path: 'poolSize', min: 0, max: 100_000, integer: true },
  { kind: 'toggle', path: 'breaker.enabled' },
  { kind: 'number', path: 'breaker.failureRate', min: 0.05, max: 1, step: 0.05, when: 'breaker.enabled' },
  { kind: 'number', path: 'breaker.window', min: 5, max: 1000, integer: true, when: 'breaker.enabled' },
  { kind: 'number', path: 'breaker.openMs', min: 100, max: 600_000, step: 500, ...MS, when: 'breaker.enabled' },
  { kind: 'number', path: 'latencyMs', min: 0, max: 60_000, step: 1, ...MS },
];

/** The value at a dotted path such as `autoscale.min`. */
export function getPath(source: unknown, path: string): unknown {
  let value = source;
  for (const key of path.split('.')) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** A copy of `source` with the value at a dotted path replaced. */
export function setPath<T>(source: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split('.') as [string, ...string[]];
  const record = source as Record<string, unknown>;
  return { ...record, [head]: rest.length === 0 ? value : setPath(record[head], rest.join('.'), value) } as T;
}
