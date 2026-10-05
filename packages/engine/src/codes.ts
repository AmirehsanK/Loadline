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
export const CALL_STATES = ['free', 'traveling', 'queued', 'in-service', 'waiting', 'backoff', 'returning'] as const;
export type CallStateName = (typeof CALL_STATES)[number];

export const FREE = 0;
/** On the network, on its way to the node. */
export const TRAVELING = 1;
/** At the node, waiting for a free slot. */
export const QUEUED = 2;
/** Holding a slot and doing the node's own work. */
export const IN_SERVICE = 3;
/** Holding a slot and waiting for a downstream call. */
export const WAITING = 4;
/** Holding a slot and waiting to retry a downstream call. */
export const BACKOFF = 5;
/** Finished; the response is on the network. */
export const RETURNING = 6;

export const EV_ARRIVE = 0;
export const EV_SERVICE_DONE = 1;
export const EV_RETURN = 2;
export const EV_TIMEOUT = 3;
export const EV_RETRY = 4;
export const EV_TIMER = 5;
export const EV_PHASE = 6;
export const EV_SAMPLE = 7;
