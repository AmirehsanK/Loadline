import { OUTCOMES } from '../codes.ts';
import { Histogram } from '../metrics/histogram.ts';
import type { NodeType } from '../model/schema.ts';
import type { Simulation } from '../sim.ts';

/** What one node did during one sampling window. */
export interface NodeWindow {
  arrivals: number;
  ok: number;
  failed: number;
  /** Busy slot-time over available slot-time, 0 to 1. */
  utilization: number;
  /** Calls waiting for a slot at the end of the window. */
  queued: number;
  /** Calls holding a slot at the end of the window. */
  inFlight: number;
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

  // Occupancy now, and its integral over time. Subclasses call touch() before changing any of the
  // three, so the integrals always cover the interval that just ended at the old values.
  protected busy = 0;
  protected queued = 0;
  protected capacity = 0;
  private busyArea = 0;
  private queuedArea = 0;
  private capacityArea = 0;
  private touchedAt = 0;

  private windowArrivals = 0;
  private windowOk = 0;
  private windowFailed = 0;
  private windowBusyArea = 0;
  private windowCapacityArea = 0;

  constructor(sim: Simulation, index: number, id: string, type: NodeType) {
    this.sim = sim;
    this.index = index;
    this.id = id;
    this.type = type;
  }

  /** Called once at time zero. */
  start(): void {}

  /** A call has reached this node. */
  abstract arrive(call: number): void;

  /** The node's own work on a call is done. */
  serviceDone(call: number): void {
    throw new Error(`${this.type} node "${this.id}" scheduled no service for call ${call}`);
  }

  /** A downstream call made for `call` has finished, retries included. */
  abstract childDone(call: number, result: number, origin: number, stuck: number): void;

  timer(id: number, arg: number): void {
    throw new Error(`${this.type} node "${this.id}" has no timer ${id} (${arg})`);
  }

  /** The traffic multiplier of the workload has changed. */
  rateChanged(): void {}

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
    this.ok++;
    this.windowOk++;
    this.latency.record(latencyMs);
  }

  protected countFailure(result: number): void {
    this.failed++;
    this.windowFailed++;
    this.failedBy[result]!++;
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
    };
    this.windowArrivals = 0;
    this.windowOk = 0;
    this.windowFailed = 0;
    this.windowBusyArea = this.busyArea;
    this.windowCapacityArea = this.capacityArea;
    return window;
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
}
