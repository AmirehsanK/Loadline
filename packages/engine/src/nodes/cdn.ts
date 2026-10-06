import { EV_SERVICE_DONE, FILE, IN_SERVICE, NODE_DOWN, OK, WRITE } from '../codes.ts';
import { PRICES } from '../cost.ts';
import type { CdnNode, DesignNode } from '../model/schema.ts';
import type { Simulation } from '../sim.ts';
import { NodeRuntime } from './base.ts';

// Handing over a file it already holds is quick and never the bottleneck, so this is fixed.
const SERVE_MS = 1;

/**
 * Copies of files, kept near the people asking for them.
 *
 * Everything from the clients passes through it. A request for a file it holds is answered on the
 * spot and goes no further. One it does not hold is fetched over the edge that carries files, and
 * kept. Reads and writes of data are passed on untouched: no two people get the same answer to
 * those, so there is nothing to keep.
 *
 * Like a cache it holds real keys (docs/SPEC.md §4.1, rule 4), so how much it takes off what is
 * behind it is a fact about what has been asked for, and when it is emptied all of that comes back.
 *
 * It has no slots of its own. What limits it is what it calls.
 */
export class CdnRuntime extends NodeRuntime {
  hits = 0;
  misses = 0;
  evictions = 0;
  /** Reads and writes of data handed on untouched. */
  passed = 0;

  private limit: number;
  private ttlMs: number;
  // Key to the time it expires, in recency order: see CacheRuntime.
  private readonly items = new Map<number, number>();

  constructor(sim: Simulation, index: number, node: CdnNode) {
    super(sim, index, node.id, 'cdn');
    this.limit = node.params.capacity;
    this.ttlMs = node.params.ttlMs;
    this.setPrice(PRICES.cdn);
  }

  arrive(call: number): void {
    if (!this.admit(call)) return;
    const sim = this.sim;
    const calls = sim.calls;
    const cls = calls.cls[call]!;

    if (cls === FILE) {
      const key = calls.key[call]!;
      const expires = this.items.get(key);
      if (expires !== undefined && expires > sim.now) {
        this.items.delete(key);
        this.items.set(key, expires);
        this.hits++;
        this.windowHits++;
        this.touch();
        this.busy++;
        calls.state[call] = IN_SERVICE;
        sim.queue.push(sim.now + SERVE_MS * this.slowFactor, EV_SERVICE_DONE, call, calls.gen[call]!, 0);
        return;
      }
      if (expires !== undefined) this.items.delete(key);
      this.misses++;
      this.windowMisses++;
    } else {
      this.passed++;
    }

    const edgeIndex = this.edgeFor(cls);
    if (edgeIndex < 0) {
      this.reject(call, NODE_DOWN);
      return;
    }
    this.touch();
    this.busy++;
    calls.attempt[call] = 0;
    sim.issue(call, edgeIndex);
  }

  override serviceDone(call: number): void {
    const sim = this.sim;
    this.touch();
    this.busy--;
    if (sim.calls.orphan[call] === 1) this.wasted++;
    this.countOk(sim.now - sim.calls.tArrive[call]!);
    sim.finish(call, OK, -1, 0);
  }

  override childDone(call: number, result: number, origin: number, stuck: number): void {
    const sim = this.sim;
    const calls = sim.calls;
    this.touch();
    this.busy--;
    if (result === OK) {
      if (calls.cls[call] === FILE) this.store(calls.key[call]!);
      this.countOk(sim.now - calls.tArrive[call]!);
    } else {
      this.countFailure(result);
    }
    sim.finish(call, result, origin, stuck);
  }

  reconfigure(node: DesignNode): void {
    if (node.type !== 'cdn') return;
    this.limit = node.params.capacity;
    this.ttlMs = node.params.ttlMs;
    while (this.items.size > this.limit) this.evict();
  }

  /** A CDN that goes down comes back holding nothing. */
  override kill(): boolean {
    this.setDown(true);
    this.items.clear();
    return true;
  }

  /** A purge: every file has to be fetched again. */
  override flush(): boolean {
    this.items.clear();
    return true;
  }

  override detail(): Record<string, number> {
    return { hits: this.hits, misses: this.misses, evictions: this.evictions, items: this.items.size, passed: this.passed };
  }

  /**
   * The edge a call of this kind leaves by: the one that names its kind most exactly, so that an
   * edge for files wins over one for everything whichever was drawn first. -1 if none carries it.
   */
  private edgeFor(cls: number): number {
    const exact = cls === FILE ? 'file' : cls === WRITE ? 'write' : 'read';
    let best = -1;
    let rank = 0;
    for (const edgeIndex of this.out) {
      const kinds = this.sim.edges[edgeIndex]!.params.appliesTo;
      const fits = kinds === exact ? 3 : kinds === 'data' && cls !== FILE ? 2 : kinds === 'all' ? 1 : 0;
      if (fits > rank) {
        rank = fits;
        best = edgeIndex;
      }
    }
    return best;
  }

  private store(key: number): void {
    if (this.items.has(key)) this.items.delete(key);
    else if (this.items.size >= this.limit) this.evict();
    this.items.set(key, this.ttlMs === 0 ? Infinity : this.sim.now + this.ttlMs);
  }

  /** Drops the least recently used file. */
  private evict(): void {
    const oldest = this.items.keys().next();
    if (oldest.done) return;
    this.items.delete(oldest.value);
    this.evictions++;
  }
}
