import { EV_TIMER, OK, WAITING } from '../codes.ts';
import { exponential } from '../kernel/dist.ts';
import { RandomStream } from '../kernel/rng.ts';
import type { ClientNode } from '../model/schema.ts';
import type { Simulation } from '../sim.ts';
import { NodeRuntime } from './base.ts';

const TIMER_ARRIVAL = 0;

/**
 * A source of requests.
 *
 * Arrivals are open-loop (docs/SPEC.md §4.1, rule 1): a Poisson process at the configured rate
 * that never waits for a reply. A request is a call at the client; each attempt it makes is a
 * downstream call over the client's one edge, under that edge's timeout and retry policy.
 */
export class ClientRuntime extends NodeRuntime {
  private readonly rps: number;
  private readonly arrivalRng: RandomStream;
  // Bumped whenever the rate changes, so the arrival already scheduled at the old rate is ignored.
  private generation = 0;

  constructor(sim: Simulation, index: number, node: ClientNode) {
    super(sim, index, node.id, 'client');
    this.rps = node.params.rps;
    this.arrivalRng = new RandomStream(sim.seed, `${node.id}/arrivals`);
  }

  override start(): void {
    this.scheduleArrival();
  }

  override rateChanged(): void {
    this.generation++;
    // Poisson arrivals are memoryless, so drawing a fresh gap from now is exact.
    this.scheduleArrival();
  }

  override timer(id: number, arg: number): void {
    if (id !== TIMER_ARRIVAL || arg !== this.generation) return;
    this.createRequest();
    this.scheduleArrival();
  }

  arrive(call: number): void {
    throw new Error(`call ${call} arrived at the client "${this.id}"; clients only send`);
  }

  childDone(call: number, result: number, origin: number, stuck: number): void {
    const sim = this.sim;
    const latency = sim.now - sim.calls.tArrive[call]!;
    this.touch();
    this.busy--;
    if (result === OK) {
      this.countOk(latency);
      sim.requestOk(latency);
    } else {
      this.countFailure(result);
      sim.requestFailed(result, origin, stuck);
    }
    sim.calls.release(call);
  }

  private scheduleArrival(): void {
    const rate = this.rps * this.sim.multiplier;
    if (rate <= 0 || this.out.length === 0) return;
    const gap = exponential(this.arrivalRng, 1000 / rate);
    this.sim.queue.push(this.sim.now + gap, EV_TIMER, this.index, TIMER_ARRIVAL, this.generation);
  }

  private createRequest(): void {
    const sim = this.sim;
    const calls = sim.calls;
    const call = calls.alloc();
    calls.node[call] = this.index;
    calls.state[call] = WAITING;
    calls.tArrive[call] = sim.now;
    this.countArrival();
    this.touch();
    this.busy++;
    sim.requestCreated();
    sim.issue(call, this.out[0]!);
  }
}
