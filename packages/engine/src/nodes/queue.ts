import { OK, QUEUE_FULL } from '../codes.ts';
import { PRICES } from '../cost.ts';
import { FloatRing, IntRing } from '../kernel/ring.ts';
import type { DesignNode, QueueNode } from '../model/schema.ts';
import type { Simulation } from '../sim.ts';
import { NodeRuntime } from './base.ts';
import { WorkerRuntime } from './worker.ts';

interface Consumer {
  worker: WorkerRuntime;
  /** The edge from this queue to the worker. */
  edgeIndex: number;
}

/**
 * Holds messages until a worker is free to take them.
 *
 * A publisher gets its answer as soon as the message is stored, so a burst of writes costs the
 * caller nothing; the work is done later, at the pace the workers can manage. The price is the
 * backlog: the time a message waits is this node's latency.
 */
export class QueueRuntime extends NodeRuntime {
  published = 0;
  delivered = 0;
  /** Messages pushed out to make room, when the queue drops its oldest. */
  dropped = 0;
  /** Messages set aside after failing too many times. */
  deadLettered = 0;

  private maxDepth: number;
  private overflow: QueueNode['params']['overflow'];
  // The waiting messages, oldest first: what each is, how often it has been tried, and since when
  // it has waited.
  private readonly classes = new IntRing();
  private readonly keys = new IntRing();
  private readonly tries = new IntRing();
  private readonly since = new FloatRing();
  private readonly consumers: Consumer[] = [];
  private turn = 0;
  private dispatching = false;

  constructor(sim: Simulation, index: number, node: QueueNode) {
    super(sim, index, node.id, 'queue');
    this.maxDepth = node.params.maxDepth;
    this.overflow = node.params.overflow;
    this.setPrice(PRICES.queue);
  }

  override start(): void {
    for (const edgeIndex of this.out) {
      const worker = this.sim.nodes[this.sim.edges[edgeIndex]!.to];
      if (!(worker instanceof WorkerRuntime)) continue;
      this.consumers.push({ worker, edgeIndex });
      worker.attach(this);
    }
  }

  /** A message is published. */
  arrive(call: number): void {
    const calls = this.sim.calls;
    if (!this.admit(call)) return;
    if (this.keys.length >= this.maxDepth) {
      if (this.overflow === 'reject') {
        this.reject(call, QUEUE_FULL);
        return;
      }
      this.take();
      this.dropped++;
    }
    this.put(calls.cls[call]!, calls.key[call]!, 0);
    this.published++;
    this.countAccepted();
    this.sim.finish(call, OK, -1, 0);
    this.dispatch();
  }

  /** Hands messages to workers for as long as there is a message and a worker with room. */
  dispatch(): void {
    // A worker that takes a message can finish it and ask for more before this returns.
    if (this.dispatching || this.down) return;
    this.dispatching = true;
    while (this.keys.length > 0) {
      const consumer = this.freeConsumer();
      if (!consumer) break;
      const waitedSince = this.since.shift();
      this.touch();
      this.queued--;
      this.countLatency(this.sim.now - waitedSince);
      this.delivered++;
      consumer.worker.accept(this.classes.shift(), this.keys.shift(), this.tries.shift(), consumer.edgeIndex);
    }
    this.dispatching = false;
  }

  /** A worker failed to process a message: try it again later, unless it has had enough chances. */
  giveBack(cls: number, key: number, tries: number, limit: number): void {
    if (tries >= limit) {
      this.deadLettered++;
      return;
    }
    this.put(cls, key, tries);
  }

  reconfigure(node: DesignNode): void {
    if (node.type !== 'queue') return;
    this.maxDepth = node.params.maxDepth;
    this.overflow = node.params.overflow;
  }

  override revive(count: number | undefined): void {
    super.revive(count);
    this.dispatch();
  }

  override detail(): Record<string, number> {
    return {
      published: this.published,
      delivered: this.delivered,
      dropped: this.dropped,
      deadLettered: this.deadLettered,
      depth: this.keys.length,
    };
  }

  private put(cls: number, key: number, tries: number): void {
    this.touch();
    this.queued++;
    this.noteQueued();
    this.classes.push(cls);
    this.keys.push(key);
    this.tries.push(tries);
    this.since.push(this.sim.now);
  }

  /** Removes the oldest message without delivering it. */
  private take(): void {
    this.touch();
    this.queued--;
    this.classes.shift();
    this.keys.shift();
    this.tries.shift();
    this.since.shift();
  }

  /** The next worker, in turn, that can take a message now. */
  private freeConsumer(): Consumer | undefined {
    const count = this.consumers.length;
    for (let i = 0; i < count; i++) {
      const index = (this.turn + i) % count;
      const consumer = this.consumers[index]!;
      if (!consumer.worker.hasRoom()) continue;
      this.turn = index + 1;
      return consumer;
    }
    return undefined;
  }
}
