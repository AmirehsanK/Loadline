import { INJECTED_ERROR, OK } from '../codes.ts';
import { RandomStream } from '../kernel/rng.ts';
import type { DesignNode, WorkerNode } from '../model/schema.ts';
import type { Simulation } from '../sim.ts';
import type { QueueRuntime } from './queue.ts';
import { NO_SCALING, ServiceRuntime } from './service.ts';
import type { Instance, PoolConfig } from './service.ts';

const poolConfig = (params: WorkerNode['params']): PoolConfig => ({
  instances: params.instances,
  concurrency: params.concurrency,
  serviceTime: params.serviceTime,
  // A worker has no queue of its own; what it has not started stays in the queue it reads.
  queue: 0,
  autoscale: NO_SCALING,
});

/**
 * Takes messages from a queue and processes them.
 *
 * It works like a service, including the calls it makes to its own dependencies, except that
 * nothing is pushed at it: an instance asks for the next message when it has a free slot. So a
 * worker is never overloaded. What grows instead is the backlog in the queue.
 *
 * A message whose processing fails goes back to the queue and is tried again, until it has failed
 * `maxDeliveries` times and is set aside.
 */
export class WorkerRuntime extends ServiceRuntime {
  private failureRate: number;
  private maxDeliveries: number;
  private readonly failRng: RandomStream;
  // Set in attach(), which the queues call once every node exists.
  private sources: QueueRuntime[] | undefined;

  constructor(sim: Simulation, index: number, node: WorkerNode) {
    super(sim, index, node.id, 'worker', poolConfig(node.params));
    this.failureRate = node.params.failureRate;
    this.maxDeliveries = node.params.maxDeliveries;
    this.failRng = new RandomStream(sim.seed, `${node.id}/failures`);
  }

  /** Called by a queue that feeds this worker. */
  attach(queue: QueueRuntime): void {
    (this.sources ??= []).push(queue);
  }

  override arrive(call: number): void {
    throw new Error(`call ${call} was sent to the worker "${this.id}"; workers take their work from a queue`);
  }

  /** Whether an instance could start a message now. */
  hasRoom(): boolean {
    return this.roomiest() !== undefined;
  }

  /** Starts work on a message from the queue at the other end of `edgeIndex`. */
  accept(cls: number, key: number, tries: number, edgeIndex: number): void {
    const sim = this.sim;
    const calls = sim.calls;
    const instance = this.roomiest()!;
    const call = calls.alloc();
    calls.node[call] = this.index;
    calls.edge[call] = edgeIndex;
    calls.inst[call] = instance.index;
    calls.cls[call] = cls;
    calls.key[call] = key;
    calls.tag[call] = tries;
    calls.tArrive[call] = sim.now;
    const edge = sim.edges[edgeIndex]!;
    edge.calls++;
    edge.windowCalls++;
    this.countArrival();
    this.begin(call, instance);
  }

  override serviceDone(call: number): void {
    if (this.failureRate > 0 && this.failRng.next() < this.failureRate) {
      this.complete(call, INJECTED_ERROR, this.index, 0);
      return;
    }
    super.serviceDone(call);
  }

  override reconfigure(node: DesignNode): void {
    if (node.type !== 'worker') return;
    this.failureRate = node.params.failureRate;
    this.maxDeliveries = node.params.maxDeliveries;
    this.applyConfig(poolConfig(node.params));
  }

  protected override idle(): void {
    // This runs during construction too, before there is a queue to ask.
    if (!this.sources) return;
    for (const queue of this.sources) queue.dispatch();
  }

  protected override ended(call: number, result: number): void {
    if (result === OK) return;
    const calls = this.sim.calls;
    const queue = this.sim.nodes[this.sim.edges[calls.edge[call]!]!.from] as QueueRuntime;
    queue.giveBack(calls.cls[call]!, calls.key[call]!, calls.tag[call]! + 1, this.maxDeliveries);
  }

  /** The instance with the most free slots, if any has one. */
  private roomiest(): Instance | undefined {
    if (this.down) return undefined;
    let best: Instance | undefined;
    for (const instance of this.instances) {
      if (!instance.up || instance.draining || instance.active >= this.concurrency) continue;
      if (!best || instance.active < best.active) best = instance;
    }
    return best;
  }
}
