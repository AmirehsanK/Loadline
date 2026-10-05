import { CACHE_DELETE, CACHE_GET, EV_SERVICE_DONE, FREE, IN_SERVICE, NODE_DOWN, OK, QUEUE_FULL, QUEUED } from '../codes.ts';
import { cachePrice } from '../cost.ts';
import { IntRing } from '../kernel/ring.ts';
import { RandomStream } from '../kernel/rng.ts';
import type { CacheNode, DesignNode } from '../model/schema.ts';
import type { Simulation } from '../sim.ts';
import { NodeRuntime } from './base.ts';

// A cache is quick and rarely the bottleneck, so these are fixed rather than settings.
const OPERATION_MS = 0.5;
const SLOTS = 256;
const BACKLOG = 4096;

/**
 * A store of items that are cheap to read.
 *
 * It holds real keys (docs/SPEC.md §4.1, rule 4): the ones the requests passing through have asked
 * for, each until it expires or is pushed out by newer ones. Whether a lookup hits is a fact about
 * its contents at that moment, so an empty cache after a restart, and everything expiring at once,
 * behave as they do in production without being programmed in.
 */
export class CacheRuntime extends NodeRuntime {
  /** Whether callers should let one call fetch a missing item for everyone waiting on it. */
  singleFlight: boolean;
  hits = 0;
  misses = 0;
  evictions = 0;

  private limit: number;
  private ttlMs: number;
  private ttlJitter: number;
  // Key to the time it expires. A Map keeps insertion order, which is used as recency order: an
  // item that is read is moved to the end, so the first one is always the least recently used.
  private readonly items = new Map<number, number>();
  private readonly ttlRng: RandomStream;
  private active = 0;
  private readonly backlog = new IntRing();

  constructor(sim: Simulation, index: number, node: CacheNode) {
    super(sim, index, node.id, 'cache');
    const params = node.params;
    this.limit = params.capacity;
    this.ttlMs = params.ttlMs;
    this.ttlJitter = params.ttlJitter;
    this.singleFlight = params.singleFlight;
    this.ttlRng = new RandomStream(sim.seed, `${node.id}/ttl`);
    this.capacity = SLOTS;
    this.setPrice(cachePrice(params.capacity));
  }

  /** Items held right now, expired ones included until something notices. */
  get size(): number {
    return this.items.size;
  }

  arrive(call: number): void {
    if (!this.admit(call)) return;
    if (this.active < SLOTS) {
      this.begin(call);
    } else if (this.backlog.length < BACKLOG) {
      this.touch();
      this.queued++;
      this.noteQueued();
      this.backlog.push(call);
      this.sim.calls.state[call] = QUEUED;
    } else {
      this.reject(call, QUEUE_FULL);
    }
  }

  override serviceDone(call: number): void {
    const sim = this.sim;
    const calls = sim.calls;
    const key = calls.key[call]!;
    const operation = calls.tag[call]!;

    if (operation === CACHE_GET) {
      const expires = this.items.get(key);
      if (expires !== undefined && expires > sim.now) {
        this.items.delete(key);
        this.items.set(key, expires);
        calls.reply[call] = 1;
        this.hits++;
        this.windowHits++;
      } else {
        if (expires !== undefined) this.items.delete(key);
        calls.reply[call] = 0;
        this.misses++;
        this.windowMisses++;
      }
    } else if (operation === CACHE_DELETE) {
      this.items.delete(key);
    } else {
      this.store(key);
    }

    this.touch();
    this.busy--;
    this.active--;
    if (calls.orphan[call] === 1) this.wasted++;
    this.countOk(sim.now - calls.tArrive[call]!);
    sim.finish(call, OK, -1, 0);
    if (this.backlog.length > 0) {
      this.queued--;
      this.begin(this.backlog.shift());
    }
  }

  reconfigure(node: DesignNode): void {
    if (node.type !== 'cache') return;
    const params = node.params;
    this.touch();
    this.limit = params.capacity;
    this.ttlMs = params.ttlMs;
    this.ttlJitter = params.ttlJitter;
    this.singleFlight = params.singleFlight;
    this.setPrice(cachePrice(params.capacity));
    while (this.items.size > this.limit) this.evict();
  }

  /** A cache that goes down loses what it held, and comes back empty. */
  override kill(): boolean {
    const sim = this.sim;
    const calls = sim.calls;
    this.setDown(true);
    this.touch();
    for (let call = 0; call < calls.capacity; call++) {
      const state = calls.state[call]!;
      if (state === FREE || calls.node[call] !== this.index) continue;
      if (state !== QUEUED && state !== IN_SERVICE) continue;
      this.countFailure(NODE_DOWN);
      sim.abort(call, NODE_DOWN, this.index);
    }
    this.busy = 0;
    this.queued = 0;
    this.active = 0;
    this.backlog.clear();
    this.items.clear();
    return true;
  }

  override flush(): boolean {
    this.items.clear();
    return true;
  }

  override detail(): Record<string, number> {
    return { hits: this.hits, misses: this.misses, evictions: this.evictions, items: this.items.size };
  }

  private begin(call: number): void {
    const sim = this.sim;
    this.touch();
    this.busy++;
    this.active++;
    sim.calls.state[call] = IN_SERVICE;
    sim.queue.push(sim.now + OPERATION_MS * this.slowFactor, EV_SERVICE_DONE, call, sim.calls.gen[call]!, 0);
  }

  private store(key: number): void {
    if (this.items.has(key)) this.items.delete(key);
    else if (this.items.size >= this.limit) this.evict();
    // Spreading lifetimes out stops items that were stored together from all expiring together.
    const life = this.ttlMs * (1 - this.ttlJitter * this.ttlRng.next());
    this.items.set(key, this.ttlMs === 0 ? Infinity : this.sim.now + life);
  }

  /** Drops the least recently used item. */
  private evict(): void {
    const oldest = this.items.keys().next();
    if (oldest.done) return;
    this.items.delete(oldest.value);
    this.evictions++;
  }
}
