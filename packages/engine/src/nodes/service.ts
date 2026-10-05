import { EV_SERVICE_DONE, IN_SERVICE, OK, QUEUE_FULL, QUEUED } from '../codes.ts';
import { makeSampler } from '../kernel/dist.ts';
import type { Sampler } from '../kernel/dist.ts';
import { IntRing } from '../kernel/ring.ts';
import { RandomStream } from '../kernel/rng.ts';
import type { ServiceNode } from '../model/schema.ts';
import type { Simulation } from '../sim.ts';
import { NodeRuntime } from './base.ts';

interface Instance {
  /** Calls holding one of this instance's slots. */
  active: number;
  /** Calls waiting for one. */
  waiting: IntRing;
}

/**
 * A pool of identical instances, each working on up to `concurrency` calls at once and holding up
 * to `queue` more.
 *
 * A call takes a slot, does the service's own work, then makes one synchronous downstream call per
 * outgoing edge, in order. It keeps its slot the whole time (docs/SPEC.md §4.1, rule 2): a slow
 * dependency therefore fills this service's slots, and its own callers start to queue.
 */
export class ServiceRuntime extends NodeRuntime {
  private readonly concurrency: number;
  private readonly queueLimit: number;
  private readonly instances: Instance[] = [];
  private readonly serviceTime: Sampler;
  private readonly serviceRng: RandomStream;

  constructor(sim: Simulation, index: number, node: ServiceNode) {
    super(sim, index, node.id, 'service');
    const params = node.params;
    this.concurrency = params.concurrency;
    this.queueLimit = params.queue;
    this.serviceTime = makeSampler(params.serviceTime);
    this.serviceRng = new RandomStream(sim.seed, `${node.id}/service`);
    for (let i = 0; i < params.instances; i++) this.instances.push({ active: 0, waiting: new IntRing() });
    this.capacity = params.instances * params.concurrency;
  }

  arrive(call: number): void {
    const calls = this.sim.calls;
    this.countArrival();
    // Without a load balancer in front, every call lands on the first instance.
    let chosen = calls.inst[call]!;
    if (chosen < 0) {
      chosen = 0;
      calls.inst[call] = 0;
    }
    const instance = this.instances[chosen]!;
    if (instance.active < this.concurrency) {
      this.begin(call, instance);
    } else if (instance.waiting.length < this.queueLimit) {
      this.touch();
      this.queued++;
      if (this.queued > this.maxQueued) this.maxQueued = this.queued;
      instance.waiting.push(call);
      calls.state[call] = QUEUED;
    } else {
      this.countFailure(QUEUE_FULL);
      this.sim.finish(call, QUEUE_FULL, this.index, 0);
    }
  }

  override serviceDone(call: number): void {
    this.sim.calls.step[call] = 0;
    this.advance(call);
  }

  childDone(call: number, result: number, origin: number, stuck: number): void {
    if (result === OK) {
      this.sim.calls.step[call]!++;
      this.advance(call);
    } else {
      this.complete(call, result, origin, stuck);
    }
  }

  private begin(call: number, instance: Instance): void {
    const sim = this.sim;
    this.touch();
    this.busy++;
    instance.active++;
    sim.calls.state[call] = IN_SERVICE;
    sim.queue.push(sim.now + this.serviceTime(this.serviceRng), EV_SERVICE_DONE, call, sim.calls.gen[call]!, 0);
  }

  /** Makes the next downstream call, or completes the call when there are none left. */
  private advance(call: number): void {
    const calls = this.sim.calls;
    const step = calls.step[call]!;
    if (step >= this.out.length) {
      this.complete(call, OK, -1, 0);
      return;
    }
    calls.attempt[call] = 0;
    this.sim.issue(call, this.out[step]!);
  }

  private complete(call: number, result: number, origin: number, stuck: number): void {
    const sim = this.sim;
    const calls = sim.calls;
    const instance = this.instances[calls.inst[call]!]!;
    this.touch();
    this.busy--;
    instance.active--;
    if (calls.orphan[call] === 1) this.wasted++;
    if (result === OK) this.countOk(sim.now - calls.tArrive[call]!);
    else this.countFailure(result);
    sim.finish(call, result, origin, stuck);

    if (instance.waiting.length > 0) {
      this.queued--;
      this.begin(instance.waiting.shift(), instance);
    }
  }
}
