import { EV_SERVICE_DONE, FREE, IN_SERVICE, NODE_DOWN, OK, stores } from '../codes.ts';
import { PRICES } from '../cost.ts';
import { makeSampler } from '../kernel/dist.ts';
import type { Sampler } from '../kernel/dist.ts';
import { RandomStream } from '../kernel/rng.ts';
import type { DesignNode, ObjectStoreNode } from '../model/schema.ts';
import type { Simulation } from '../sim.ts';
import { NodeRuntime } from './base.ts';

/**
 * A place to keep files, run by somebody else.
 *
 * It has no slots and no queue: however many files are asked for at once, each takes its own time
 * and none waits for another. That is the whole of what it offers, and it is why a surge that
 * would flatten a service does nothing to it. It is not fast, though, and a caller that fetches a
 * file through it holds its own slot for as long as the fetch takes (docs/SPEC.md §4.1, rule 2).
 */
export class ObjectStoreRuntime extends NodeRuntime {
  private readTime: Sampler;
  private writeTime: Sampler;
  private readonly workRng: RandomStream;

  constructor(sim: Simulation, index: number, node: ObjectStoreNode) {
    super(sim, index, node.id, 'object-store');
    this.readTime = makeSampler(node.params.readTime);
    this.writeTime = makeSampler(node.params.writeTime);
    this.workRng = new RandomStream(sim.seed, `${node.id}/work`);
    this.setPrice(PRICES.objectStore);
  }

  arrive(call: number): void {
    if (!this.admit(call)) return;
    const sim = this.sim;
    const calls = sim.calls;
    const work = (stores(calls.cls[call]!) ? this.writeTime(this.workRng) : this.readTime(this.workRng)) * this.slowFactor;
    this.touch();
    this.busy++;
    calls.state[call] = IN_SERVICE;
    sim.queue.push(sim.now + work, EV_SERVICE_DONE, call, calls.gen[call]!, 0);
  }

  override serviceDone(call: number): void {
    const sim = this.sim;
    this.touch();
    this.busy--;
    if (sim.calls.orphan[call] === 1) this.wasted++;
    this.countOk(sim.now - sim.calls.tArrive[call]!);
    sim.finish(call, OK, -1, 0);
  }

  reconfigure(node: DesignNode): void {
    if (node.type !== 'object-store') return;
    this.readTime = makeSampler(node.params.readTime);
    this.writeTime = makeSampler(node.params.writeTime);
  }

  /** What it was part-way through handing over is lost with it. */
  override kill(): boolean {
    const sim = this.sim;
    const calls = sim.calls;
    this.setDown(true);
    this.touch();
    for (let call = 0; call < calls.capacity; call++) {
      if (calls.state[call] === FREE || calls.node[call] !== this.index || calls.state[call] !== IN_SERVICE) continue;
      this.countFailure(NODE_DOWN);
      sim.abort(call, NODE_DOWN, this.index);
    }
    this.busy = 0;
    return true;
  }
}
