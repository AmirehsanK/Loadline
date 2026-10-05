import { EV_TIMER, OK, READ, WAITING, WRITE } from '../codes.ts';
import { exponential } from '../kernel/dist.ts';
import { RandomStream } from '../kernel/rng.ts';
import { ZipfTable } from '../kernel/zipf.ts';
import type { ClientNode, DesignNode } from '../model/schema.ts';
import type { Simulation } from '../sim.ts';
import { NodeRuntime } from './base.ts';

const TIMER_ARRIVAL = 0;

/**
 * A source of requests.
 *
 * Arrivals are open-loop (docs/SPEC.md §4.1, rule 1): a Poisson process at the configured rate
 * that never waits for a reply. A request is a call at the client; each attempt it makes is a
 * downstream call over the client's one edge, under that edge's timeout and retry policy.
 *
 * Every request is a read or a write and is about one item, its key. Keys follow a Zipf
 * distribution, so a few items get most of the traffic.
 */
export class ClientRuntime extends NodeRuntime {
  private params: ClientNode['params'];
  private keys: ZipfTable;
  private readonly arrivalRng: RandomStream;
  private readonly classRng: RandomStream;
  private readonly keyRng: RandomStream;
  // Bumped whenever the rate changes, so the arrival already scheduled at the old rate is ignored.
  private generation = 0;

  constructor(sim: Simulation, index: number, node: ClientNode) {
    super(sim, index, node.id, 'client');
    this.params = node.params;
    this.keys = new ZipfTable(node.params.keys, node.params.skew);
    this.arrivalRng = new RandomStream(sim.seed, `${node.id}/arrivals`);
    this.classRng = new RandomStream(sim.seed, `${node.id}/class`);
    this.keyRng = new RandomStream(sim.seed, `${node.id}/keys`);
  }

  override get instanceCount(): number {
    return 1;
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

  override childDone(call: number, result: number, origin: number, stuck: number): void {
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

  reconfigure(node: DesignNode): void {
    if (node.type !== 'client') return;
    const previous = this.params;
    this.params = node.params;
    if (node.params.keys !== previous.keys || node.params.skew !== previous.skew) {
      this.keys = new ZipfTable(node.params.keys, node.params.skew);
    }
    if (node.params.rps !== previous.rps) this.rateChanged();
  }

  // A client is outside the system; nothing that can be injected applies to it.
  override kill(): boolean {
    return false;
  }

  override setSlow(): boolean {
    return false;
  }

  override setErrorRate(): boolean {
    return false;
  }

  private scheduleArrival(): void {
    const rate = this.params.rps * this.sim.multiplier;
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
    calls.cls[call] = this.classRng.next() < this.params.readRatio ? READ : WRITE;
    calls.key[call] = this.keys.pick(this.keyRng.next());
    this.countArrival();
    this.touch();
    this.busy++;
    sim.requestCreated();
    sim.issue(call, this.out[0]!);
  }
}
