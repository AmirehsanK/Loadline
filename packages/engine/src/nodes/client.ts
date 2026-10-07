import { EV_TIMER, FILE, NODE_DOWN, OK, READ, UPLOAD, WAITING, WRITE } from '../codes.ts';
import { pickEdge } from '../edge.ts';
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
 * Every request is a read, a write, a request for a file or a file sent in, and is about one item,
 * its key. Keys follow a Zipf distribution, so a few items get most of the traffic.
 *
 * A client may divide its requests among routes, each with a share and a mix of its own. A request
 * then leaves by the edge that is for its route, so different routes can enter the system at
 * different parts.
 */
export class ClientRuntime extends NodeRuntime {
  private params: ClientNode['params'];
  private keys: ZipfTable;
  private readonly arrivalRng: RandomStream;
  private readonly classRng: RandomStream;
  // A stream of its own, so that a design with no files draws exactly what it drew before files existed.
  private readonly fileRng: RandomStream;
  // And one for the route, drawn from only when there are routes.
  private readonly routeRng: RandomStream;
  /** The routes, each with its number in the run and the weight of it and all before it. */
  private lanes: { route: number; upTo: number; fileRatio: number; uploadRatio: number; readRatio: number }[] = [];
  private readonly keyRng: RandomStream;
  // Bumped whenever the rate changes, so the arrival already scheduled at the old rate is ignored.
  private generation = 0;

  constructor(sim: Simulation, index: number, node: ClientNode) {
    super(sim, index, node.id, 'client');
    this.params = node.params;
    this.keys = new ZipfTable(node.params.keys, node.params.skew);
    this.arrivalRng = new RandomStream(sim.seed, `${node.id}/arrivals`);
    this.classRng = new RandomStream(sim.seed, `${node.id}/class`);
    this.fileRng = new RandomStream(sim.seed, `${node.id}/files`);
    this.routeRng = new RandomStream(sim.seed, `${node.id}/routes`);
    this.layLanes();
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
    const route = sim.calls.route[call]!;
    this.touch();
    this.busy--;
    if (result === OK) {
      this.countOk(latency);
      sim.requestOk(latency, route);
    } else {
      this.countFailure(result);
      sim.requestFailed(result, origin, stuck, route);
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
    this.layLanes();
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

  private layLanes(): void {
    let upTo = 0;
    this.lanes = this.params.routes.map((route) => {
      upTo += route.weight;
      return { route: this.sim.routeOf(route.name), upTo, fileRatio: route.fileRatio, uploadRatio: route.uploadRatio, readRatio: route.readRatio };
    });
  }

  private createRequest(): void {
    const sim = this.sim;
    const calls = sim.calls;

    // Which route it comes in by, and so what mix of requests it is drawn from.
    let route = 0;
    let mix: { fileRatio: number; uploadRatio: number; readRatio: number } = this.params;
    const lanes = this.lanes;
    if (lanes.length > 0) {
      const at = this.routeRng.next() * lanes[lanes.length - 1]!.upTo;
      const lane = lanes.find((candidate) => at < candidate.upTo) ?? lanes[lanes.length - 1]!;
      route = lane.route;
      mix = lane;
    }

    let cls = -1;
    const files = mix.fileRatio + mix.uploadRatio;
    if (files > 0) {
      const at = this.fileRng.next();
      if (at < mix.fileRatio) cls = FILE;
      else if (at < files) cls = UPLOAD;
    }
    if (cls < 0) cls = this.classRng.next() < mix.readRatio ? READ : WRITE;
    const key = this.keys.pick(this.keyRng.next());

    this.countArrival();
    sim.requestCreated();
    const edgeIndex = pickEdge(sim.edges, this.out, cls, route);
    if (edgeIndex < 0) {
      // Nothing the client is connected to takes this kind of request on this route.
      this.countFailure(NODE_DOWN);
      sim.requestFailed(NODE_DOWN, this.index, 0, route);
      return;
    }
    const call = calls.alloc();
    calls.node[call] = this.index;
    calls.state[call] = WAITING;
    calls.tArrive[call] = sim.now;
    calls.cls[call] = cls;
    calls.key[call] = key;
    calls.route[call] = route;
    this.touch();
    this.busy++;
    sim.issue(call, edgeIndex);
  }
}
