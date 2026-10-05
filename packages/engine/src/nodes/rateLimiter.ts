import { NODE_DOWN, OK, RATE_LIMITED } from '../codes.ts';
import { PRICES } from '../cost.ts';
import type { DesignNode, RateLimiterNode } from '../model/schema.ts';
import type { Simulation } from '../sim.ts';
import { NodeRuntime } from './base.ts';

/**
 * Lets calls through at a steady rate and refuses the rest at once.
 *
 * It is a token bucket: tokens drip in at `rate` per second up to `burst`, and each call spends
 * one. Refusing early is the point. What is behind the limiter only ever sees load it can carry,
 * so it keeps answering the calls it does get.
 */
export class RateLimiterRuntime extends NodeRuntime {
  private rate: number;
  private burst: number;
  private tokens: number;
  private filledAt = 0;

  constructor(sim: Simulation, index: number, node: RateLimiterNode) {
    super(sim, index, node.id, 'rate-limiter');
    this.rate = node.params.rate;
    this.burst = node.params.burst;
    this.tokens = node.params.burst;
    this.setPrice(PRICES.rateLimiter);
  }

  arrive(call: number): void {
    if (!this.admit(call)) return;
    const edgeIndex = this.out[0];
    if (edgeIndex === undefined) {
      this.reject(call, NODE_DOWN);
      return;
    }
    this.refill();
    if (this.tokens < 1) {
      this.reject(call, RATE_LIMITED);
      return;
    }
    this.tokens--;
    this.touch();
    this.busy++;
    this.sim.calls.attempt[call] = 0;
    this.sim.issue(call, edgeIndex);
  }

  override childDone(call: number, result: number, origin: number, stuck: number): void {
    const sim = this.sim;
    this.touch();
    this.busy--;
    if (result === OK) this.countOk(sim.now - sim.calls.tArrive[call]!);
    else this.countFailure(result);
    sim.finish(call, result, origin, stuck);
  }

  reconfigure(node: DesignNode): void {
    if (node.type !== 'rate-limiter') return;
    this.refill();
    this.rate = node.params.rate;
    this.burst = node.params.burst;
    this.tokens = Math.min(this.tokens, this.burst);
  }

  /** Adds the tokens that have dripped in since the bucket was last looked at. */
  private refill(): void {
    const now = this.sim.now;
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.filledAt) * this.rate) / 1000);
    this.filledAt = now;
  }
}
