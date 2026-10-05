import { FREE } from '../codes.ts';

/** Thrown when more calls are in flight at once than the simulation allows. */
export class SimulationLimitError extends Error {
  constructor(limit: number) {
    super(
      `More than ${limit} calls were in flight at once. The design lets work pile up without bound: ` +
        'give its queues a limit or its callers a timeout.',
    );
    this.name = 'SimulationLimitError';
  }
}

/**
 * Every call in flight, as parallel typed arrays indexed by slot.
 *
 * A call is one invocation of a node on behalf of a request (docs/SPEC.md §4.2). Slots are reused,
 * so anything that outlives a call — a scheduled event, mostly — must carry the slot's generation
 * and check it before acting.
 */
export class CallPool {
  /** Index of the node handling the call. */
  node: Int32Array;
  /** Slot of the call that made this one, or -1 if nothing is waiting for it. */
  parent: Int32Array;
  /** Index of the edge the call travelled over, or -1 for a client's request. */
  edge: Int32Array;
  /** Which instance of the node handles it, or -1 before one is chosen. */
  inst: Int32Array;
  /** Which instance of the calling node made it; identifies the connection pool it drew from. */
  from: Int32Array;
  state: Uint8Array;
  /** Incremented each time the slot is released. */
  gen: Int32Array;
  /** Slot of the downstream call this call is waiting for, or -1. */
  awaited: Int32Array;
  /** Index of the edge of the downstream attempt in progress, from being made to being settled; else -1. */
  pending: Int32Array;
  /** Which of the node's outgoing edges the call is working through. */
  step: Int32Array;
  /** Retries already made on the current step. */
  attempt: Int32Array;
  /** Read or write. Downstream calls inherit it. */
  cls: Uint8Array;
  /** The item the request is about. Downstream calls inherit it. */
  key: Int32Array;
  /**
   * Meaning depends on the node: the operation asked of a cache, a message's delivery count, the
   * instance a balancer last sent the call to.
   */
  tag: Int32Array;
  /** Outcome, set when the call finishes. */
  result: Uint8Array;
  /** A flag the callee sends back with a successful result: whether a cache had the key. */
  reply: Uint8Array;
  /** For a failure: the node it is attributed to. */
  origin: Int32Array;
  /** For a timeout: the state of the call that was holding things up. */
  stuck: Uint8Array;
  /** 1 once a caller upstream has stopped waiting; the work it still does is wasted. */
  orphan: Uint8Array;
  /** When the call reached its node (for a client's request: when it was created). */
  tArrive: Float64Array;
  /** When the current downstream attempt began, pool wait included. */
  tAttempt: Float64Array;

  private free: Int32Array;
  private freeCount = 0;
  private size = 0;
  private liveCount = 0;
  private readonly limit: number;

  constructor(limit: number, capacity = 1024) {
    this.limit = limit;
    this.node = new Int32Array(0);
    this.parent = new Int32Array(0);
    this.edge = new Int32Array(0);
    this.inst = new Int32Array(0);
    this.from = new Int32Array(0);
    this.state = new Uint8Array(0);
    this.gen = new Int32Array(0);
    this.awaited = new Int32Array(0);
    this.pending = new Int32Array(0);
    this.step = new Int32Array(0);
    this.attempt = new Int32Array(0);
    this.cls = new Uint8Array(0);
    this.key = new Int32Array(0);
    this.tag = new Int32Array(0);
    this.result = new Uint8Array(0);
    this.reply = new Uint8Array(0);
    this.origin = new Int32Array(0);
    this.stuck = new Uint8Array(0);
    this.orphan = new Uint8Array(0);
    this.tArrive = new Float64Array(0);
    this.tAttempt = new Float64Array(0);
    this.free = new Int32Array(0);
    this.resize(Math.min(capacity, limit));
  }

  /** Number of calls currently in flight. */
  get live(): number {
    return this.liveCount;
  }

  /** Number of slots, free or not. Every live call has a slot below this. */
  get capacity(): number {
    return this.size;
  }

  /** Takes a slot and resets its fields. */
  alloc(): number {
    if (this.freeCount === 0) {
      if (this.size >= this.limit) throw new SimulationLimitError(this.limit);
      this.resize(Math.min(this.size * 2, this.limit));
    }
    const slot = this.free[--this.freeCount]!;
    this.liveCount++;
    this.parent[slot] = -1;
    this.edge[slot] = -1;
    this.inst[slot] = -1;
    this.from[slot] = -1;
    this.awaited[slot] = -1;
    this.pending[slot] = -1;
    this.step[slot] = 0;
    this.attempt[slot] = 0;
    this.cls[slot] = 0;
    this.key[slot] = 0;
    this.tag[slot] = 0;
    this.result[slot] = 0;
    this.reply[slot] = 0;
    this.origin[slot] = -1;
    this.stuck[slot] = 0;
    this.orphan[slot] = 0;
    return slot;
  }

  release(slot: number): void {
    this.state[slot] = FREE;
    this.awaited[slot] = -1;
    this.gen[slot] = (this.gen[slot]! + 1) | 0;
    this.free[this.freeCount++] = slot;
    this.liveCount--;
  }

  private resize(capacity: number): void {
    const old = this.size;
    this.node = extend(this.node, new Int32Array(capacity));
    this.parent = extend(this.parent, new Int32Array(capacity));
    this.edge = extend(this.edge, new Int32Array(capacity));
    this.inst = extend(this.inst, new Int32Array(capacity));
    this.from = extend(this.from, new Int32Array(capacity));
    this.state = extend(this.state, new Uint8Array(capacity));
    this.gen = extend(this.gen, new Int32Array(capacity));
    this.awaited = extend(this.awaited, new Int32Array(capacity));
    this.pending = extend(this.pending, new Int32Array(capacity));
    this.step = extend(this.step, new Int32Array(capacity));
    this.attempt = extend(this.attempt, new Int32Array(capacity));
    this.cls = extend(this.cls, new Uint8Array(capacity));
    this.key = extend(this.key, new Int32Array(capacity));
    this.tag = extend(this.tag, new Int32Array(capacity));
    this.result = extend(this.result, new Uint8Array(capacity));
    this.reply = extend(this.reply, new Uint8Array(capacity));
    this.origin = extend(this.origin, new Int32Array(capacity));
    this.stuck = extend(this.stuck, new Uint8Array(capacity));
    this.orphan = extend(this.orphan, new Uint8Array(capacity));
    this.tArrive = extend(this.tArrive, new Float64Array(capacity));
    this.tAttempt = extend(this.tAttempt, new Float64Array(capacity));
    this.free = extend(this.free, new Int32Array(capacity));
    // Lowest new slot on top of the stack, so slots are handed out in ascending order.
    for (let slot = capacity - 1; slot >= old; slot--) this.free[this.freeCount++] = slot;
    this.size = capacity;
  }
}

function extend<T extends Int32Array | Uint8Array | Float64Array>(from: T, to: T): T {
  to.set(from);
  return to;
}
