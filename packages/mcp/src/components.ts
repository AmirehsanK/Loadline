import { NODE_TYPES, edgeSchema, nodeSchema } from '@loadline/engine';
import type { NodeType } from '@loadline/engine';

// What an agent needs to know to write a design: the kinds of part, what each one does, and every
// setting with the value it has when left out. The values come from the schema itself, so this
// cannot drift from what the engine accepts.

const WHAT: Record<NodeType, string> = {
  client:
    'Sends requests at a steady rate (rps), whatever happens to them: it does not slow down when the system does. ' +
    'readRatio is the share that only read; keys and skew say how many different items are asked for and how unevenly. Has exactly one outgoing edge.',
  'load-balancer':
    'Spreads calls over the instances of the one service behind it. It only learns that an instance has died at its next health check ' +
    '(healthCheckMs); a retry on its outgoing edge goes to a different instance. A service with more than one instance needs one in front, ' +
    'or every call lands on the first instance.',
  'rate-limiter': 'A token bucket in front of one part: lets through `rate` calls a second and refuses the rest at once.',
  service:
    'Does work. Each instance handles `concurrency` calls at once (each taking serviceTime) and holds `queue` more waiting; beyond that it rejects. ' +
    'After its own work a call goes through the outgoing edges in order, and a synchronous call holds its slot while it waits. ' +
    'With autoscale it adds and removes instances by itself, late: it sizes for load it has already seen, and a new instance takes bootMs.',
  cache:
    'Answers repeat reads. An edge from a service to a cache must come before the edge to the store it fronts: a hit skips that next edge, ' +
    'a miss reads the store and fills the cache. Holds `capacity` items (least recently used goes first) for ttlMs each. ' +
    'singleFlight makes calls that miss the same item wait for one fetch instead of each making their own. A leaf: it makes no calls.',
  database:
    'A primary that takes writes, and optional replicas that share reads. `concurrency` is its cores: that many queries run at full speed, ' +
    'and beyond that they share the cores and all slow down, so limit callers with poolSize on the edge into it. A leaf: it makes no calls.',
  queue: 'Stores messages and answers the publisher at once. Only workers read from it. Use an async edge into it for work that can be done later.',
  worker: 'Takes messages from a queue at its own pace and processes them like a service. Its only incoming edge is from a queue.',
};

const EDGES =
  'An edge is a call from one part to another, and carries the caller\'s policy: timeoutMs (0 waits forever), retries with backoffMs, backoffFactor and jitter, ' +
  'poolSize (connections per caller instance; 0 is no limit), a circuit breaker, latencyMs each way, appliesTo (all, read or write) and mode ' +
  '(sync waits for the answer; async hands the call over and moves on). A timeout does not cancel the work downstream.';

const DOCUMENT =
  'A design is { name?, nodes: [{ id, type, name?, x?, y?, params? }], edges: [{ id, from, to, params? }] }. Ids are 1-64 letters, digits, "_" or "-". ' +
  'Every setting left out takes the default shown here. All times are in milliseconds. ' +
  'A duration of work is { kind: "const" | "exp" | "lognormal", mean, cv? }. ' +
  'Costs are made-up dollars a month: an instance is 15 + 3 per slot, a database server 40 + 12 per core, a cache 10 + 2 per 1000 items, a load balancer 20, a rate limiter 10, a queue 15.';

export interface Components {
  document: string;
  parts: { type: NodeType; what: string; defaults: unknown }[];
  edges: { what: string; defaults: unknown };
}

export function describeComponents(): Components {
  return {
    document: DOCUMENT,
    parts: NODE_TYPES.map((type) => ({ type, what: WHAT[type], defaults: nodeSchema.parse({ id: 'example', type }).params })),
    edges: { what: EDGES, defaults: edgeSchema.parse({ id: 'a--b', from: 'a', to: 'b' }).params },
  };
}
