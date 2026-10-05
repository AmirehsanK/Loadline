import { INJECTED_ERROR, NODE_DOWN, OUTCOMES } from '../codes.ts';
import { RandomStream } from '../kernel/rng.ts';
import { Histogram } from '../metrics/histogram.ts';
import type { DesignNode, NodeType } from '../model/schema.ts';
import type { Simulation } from '../sim.ts';

/** What one node did during one sampling window. */
export interface NodeWindow {
  arrivals: number;
  ok: number;
  failed: number;
  /** Busy slot-time over available slot-time, 0 to 1. */
  utilization: number;
  /** Calls waiting for a slot at the end of the window. For a queue: messages waiting. */
  queued: number;
  /** Calls holding a slot at the end of the window. */
  inFlight: number;
  /** Slot-time in use during the window: one slot busy for the whole window is the window's length. */
  busyMs: number;
  /** Time from arrival to completion, for the calls that succeeded in this window. */
  meanMs: number;
  p99: number;
  /** Instances up at the end of the window. */
  instances: number;
  /** For a cache: lookups that found their item, and those that did not. */
  hits: number;
  misses: number;
}

/**
 * The running form of one node of the design.
 *
 * A node receives calls (`arrive`), may make downstream calls through `sim.issue`, hears how each
 * turned out (`childDone`), and eventually hands every call back with `sim.finish`.
 */
export abstract class NodeRuntime {
  readonly sim: Simulation;
  readonly index: number;
  readonly id: string;
  readonly type: NodeType;
  /** Indices of the outgoing edges, in design order. */
  readonly out: number[] = [];

  arrivals = 0;
  ok = 0;
  failed = 0;
  /** Calls finished here after a caller upstream had already stopped waiting. */
  wasted = 0;
  maxQueued = 0;
  readonly failedBy = new Float64Array(OUTCOMES.length);
  /** Time from arrival to completion, for calls that succeeded. */
  readonly latency = new Histogram();

  // Occupancy now, and its integral over time. Subclasses call touch() before changing any of
  // these, so the integrals always cover the interval that just ended at the old values.
  protected busy = 0;
  protected queued = 0;
  protected capacity = 0;
  private busyArea = 0;
  private queuedArea = 0;
  private capacityArea = 0;
  private touchedAt = 0;

  // What the node costs to run as it stands, in dollars a month, and its integral over time. Kept
  // apart from the integrals above and only added to when the price changes, so that a price that
  // never changes averages to exactly itself.
  private price = 0;
  private priceArea = 0;
  private pricedAt = 0;

  // Injected faults.
  /** Every call fails while this is set. */
  protected down = false;
  /** The node's own work takes this many times as long. */
  protected slowFactor = 1;
  private errorRate = 0;
  private faults: RandomStream | null = null;

  private windowArrivals = 0;
  private windowOk = 0;
  private windowFailed = 0;
  private windowBusyArea = 0;
  private windowCapacityArea = 0;
  private readonly windowLatency = new Histogram();
  protected windowHits = 0;
  protected windowMisses = 0;

  constructor(sim: Simulation, index: number, id: string, type: NodeType) {
    this.sim = sim;
    this.index = index;
    this.id = id;
    this.type = type;
  }

  /** Calls holding a slot right now. */
  get inFlight(): number {
    return this.busy;
  }

  /** Calls waiting for a slot right now. */
  get waiting(): number {
    return this.queued;
  }

  /** Instances that are up. */
  get instanceCount(): number {
    return this.down ? 0 : 1;
  }

  /** Called once at time zero, when every node and edge exists. */
  start(): void {}

  /** A call has reached this node. */
  abstract arrive(call: number): void;

  /** The node's own work on a call is done. */
  serviceDone(call: number): void {
    throw new Error(`${this.type} node "${this.id}" scheduled no service for call ${call}`);
  }

  /** A downstream call made for `call` has finished, retries included. */
  childDone(call: number, result: number, origin: number, stuck: number): void {
    throw new Error(`${this.type} node "${this.id}" made no call for ${call} (${result}, ${origin}, ${stuck})`);
  }

  timer(id: number, arg: number): void {
    throw new Error(`${this.type} node "${this.id}" has no timer ${id} (${arg})`);
  }

  /** The traffic multiplier of the workload has changed. */
  rateChanged(): void {}

  /**
   * Which instance of the target a call over `edgeIndex` should go to: an index, -1 for no
   * preference, or `NO_ROUTE` when there is nowhere to send it.
   */
  route(_call: number, _edgeIndex: number): number {
    return -1;
  }

  /** Takes on new parameters while the run is in progress. */
  abstract reconfigure(node: DesignNode): void;

  // --- Faults a run can inject. Each returns false when it does not apply to this kind of node. ---

  /** Takes `count` instances down, or the whole node when `count` is undefined. */
  kill(_count: number | undefined): boolean {
    this.setDown(true);
    return true;
  }

  /** Brings back what `kill` took down. */
  revive(_count: number | undefined): void {
    this.setDown(false);
  }

  setSlow(factor: number): boolean {
    this.slowFactor = factor;
    return true;
  }

  setErrorRate(rate: number): boolean {
    this.errorRate = rate;
    this.faults ??= new RandomStream(this.sim.seed, `${this.id}/faults`);
    return true;
  }

  flush(): boolean {
    return false;
  }

  failover(): boolean {
    return false;
  }

  /** Numbers particular to this kind of node, for the report. */
  detail(): Record<string, number> {
    return {};
  }

  protected setDown(down: boolean): void {
    this.down = down;
  }

  /**
   * The first thing `arrive` does. Counts the arrival and returns false if the call has already
   * been failed because the node is down or was told to fail it.
   */
  protected admit(call: number): boolean {
    this.countArrival();
    if (this.down) {
      this.reject(call, NODE_DOWN);
      return false;
    }
    if (this.errorRate > 0 && this.faults!.next() < this.errorRate) {
      this.reject(call, INJECTED_ERROR);
      return false;
    }
    return true;
  }

  /** Fails a call that this node never started work on. */
  protected reject(call: number, result: number): void {
    this.countFailure(result);
    this.sim.finish(call, result, this.index, 0);
  }

  protected touch(): void {
    const dt = this.sim.now - this.touchedAt;
    if (dt <= 0) return;
    this.busyArea += this.busy * dt;
    this.queuedArea += this.queued * dt;
    this.capacityArea += this.capacity * dt;
    this.touchedAt = this.sim.now;
  }

  protected countArrival(): void {
    this.arrivals++;
    this.windowArrivals++;
  }

  protected countOk(latencyMs: number): void {
    this.countAccepted();
    this.countLatency(latencyMs);
  }

  /** Counts a success whose duration is recorded separately, or not at all. */
  protected countAccepted(): void {
    this.ok++;
    this.windowOk++;
  }

  protected countLatency(latencyMs: number): void {
    this.latency.record(latencyMs);
    this.windowLatency.record(latencyMs);
  }

  protected countFailure(result: number): void {
    this.failed++;
    this.windowFailed++;
    this.failedBy[result]!++;
  }

  protected noteQueued(): void {
    if (this.queued > this.maxQueued) this.maxQueued = this.queued;
  }

  /** Closes the current sampling window and returns what happened in it. */
  sample(): NodeWindow {
    this.touch();
    const busy = this.busyArea - this.windowBusyArea;
    const capacity = this.capacityArea - this.windowCapacityArea;
    const window: NodeWindow = {
      arrivals: this.windowArrivals,
      ok: this.windowOk,
      failed: this.windowFailed,
      utilization: capacity > 0 ? busy / capacity : 0,
      queued: this.queued,
      inFlight: this.busy,
      busyMs: busy,
      meanMs: this.windowLatency.mean(),
      p99: this.windowLatency.quantile(0.99),
      instances: this.instanceCount,
      hits: this.windowHits,
      misses: this.windowMisses,
    };
    this.windowLatency.reset();
    this.windowArrivals = 0;
    this.windowOk = 0;
    this.windowFailed = 0;
    this.windowHits = 0;
    this.windowMisses = 0;
    this.windowBusyArea = this.busyArea;
    this.windowCapacityArea = this.capacityArea;
    return window;
  }

  /** Busy and available slot-time since the start of the run. */
  protected slotTime(): { busy: number; capacity: number } {
    this.touch();
    return { busy: this.busyArea, capacity: this.capacityArea };
  }

  /** Busy slot-time over available slot-time since the start of the run. */
  utilization(): number {
    this.touch();
    return this.capacityArea > 0 ? this.busyArea / this.capacityArea : 0;
  }

  /** Time-average number of calls waiting for a slot since the start of the run. */
  meanQueued(): number {
    this.touch();
    return this.sim.now > 0 ? this.queuedArea / this.sim.now : 0;
  }

  /** Sets what the node costs to run from now on, in dollars a month. */
  protected setPrice(price: number): void {
    if (price === this.price) return;
    this.priceArea += this.price * (this.sim.now - this.pricedAt);
    this.pricedAt = this.sim.now;
    this.price = price;
  }

  /** Average cost over the run so far, in dollars a month. Before any time has passed: the price now. */
  monthlyCost(): number {
    const now = this.sim.now;
    if (now <= 0 || this.priceArea === 0) return this.price;
    return (this.priceArea + this.price * (now - this.pricedAt)) / now;
  }
}
