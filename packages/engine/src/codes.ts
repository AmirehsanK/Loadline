/**
 * How a call ended. Index 0 is success; the rest are the failure causes. Every request ends in
 * exactly one of these (docs/SPEC.md §4.1, rule 6).
 */
export const OUTCOMES = [
  'ok',
  'timeout',
  'queue-full',
  'rate-limited',
  'node-down',
  'circuit-open',
  'injected-error',
  'network-drop',
] as const;
export type OutcomeName = (typeof OUTCOMES)[number];

export const OK = 0;
export const TIMEOUT = 1;
export const QUEUE_FULL = 2;
export const RATE_LIMITED = 3;
export const NODE_DOWN = 4;
export const CIRCUIT_OPEN = 5;
export const INJECTED_ERROR = 6;
export const NETWORK_DROP = 7;

/** Where a call is in its life. */
export const CALL_STATES = [
  'free',
  'traveling',
  'queued',
  'in-service',
  'waiting',
  'backoff',
  'returning',
  'pool',
  'refused',
] as const;
export type CallStateName = (typeof CALL_STATES)[number];

export const FREE = 0;
/** On the network, on its way to the node. */
export const TRAVELING = 1;
/** At the node, waiting for a free slot. */
export const QUEUED = 2;
/** Holding a slot and doing the node's own work. */
export const IN_SERVICE = 3;
/** Holding a slot and waiting for a downstream call, or for another call to fetch the same key. */
export const WAITING = 4;
/** Holding a slot and waiting to retry a downstream call. */
export const BACKOFF = 5;
/** Finished; the response is on the network. */
export const RETURNING = 6;
/** Holding a slot and waiting for a free connection in an edge's pool. */
export const POOL_WAIT = 7;
/** A downstream call was refused without being made; the refusal is about to be delivered. */
export const REFUSED = 8;

/**
 * The kinds of request. Edges can be limited to some of them. A read and a write are about data;
 * a file is a read of something that is the same for everyone who asks: an image, a script.
 */
export const READ = 0;
export const WRITE = 1;
export const FILE = 2;
/** A file being sent in rather than fetched: a photo posted, a video uploaded. */
export const UPLOAD = 3;

/** Whether a request of this kind changes what is stored. */
export const stores = (cls: number): boolean => cls === WRITE || cls === UPLOAD;

/** What a call to a cache asks it to do, carried in the call's tag. */
export const CACHE_GET = 0;
export const CACHE_SET = 1;
export const CACHE_DELETE = 2;

/** Returned by a node's `route` when there is nowhere to send the call. */
export const NO_ROUTE = -2;

export const EV_ARRIVE = 0;
export const EV_SERVICE_DONE = 1;
export const EV_RETURN = 2;
export const EV_TIMEOUT = 3;
export const EV_RETRY = 4;
export const EV_TIMER = 5;
export const EV_PHASE = 6;
export const EV_SAMPLE = 7;
export const EV_REFUSE = 8;
export const EV_POOL_TIMEOUT = 9;
export const EV_COMMAND = 10;
export const EV_RESTORE = 11;
