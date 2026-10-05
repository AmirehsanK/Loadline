import { EV_TIMER, NODE_DOWN, NO_ROUTE, OK } from '../codes.ts';
import { PRICES } from '../cost.ts';
import { RandomStream } from '../kernel/rng.ts';
import type { DesignNode, LoadBalancerNode } from '../model/schema.ts';
import type { Simulation } from '../sim.ts';
import { NodeRuntime } from './base.ts';
import { ServiceRuntime } from './service.ts';

const TIMER_HEALTH = 0;

/**
 * Spreads calls over the instances of the service behind it.
 *
 * It only knows which instances are alive as of its last health check. An instance that dies is
 * sent calls, which fail, until the next check notices. That window is the cost of a slow check.
 */
export class LoadBalancerRuntime extends NodeRuntime {
  private algorithm: LoadBalancerNode['params']['algorithm'];
  private healthCheckMs: number;
  private readonly pickRng: RandomStream;
  // What the balancer believes about each instance: what its last health check found, or for an
  // instance added since then, what the instance said when it announced itself.
  private readonly healthy: boolean[] = [];
  private turn = 0;
  private target: ServiceRuntime | null = null;

  constructor(sim: Simulation, index: number, node: LoadBalancerNode) {
    super(sim, index, node.id, 'load-balancer');
    this.algorithm = node.params.algorithm;
    this.healthCheckMs = node.params.healthCheckMs;
    this.pickRng = new RandomStream(sim.seed, `${node.id}/pick`);
    this.setPrice(PRICES.loadBalancer);
  }

  override start(): void {
    const edgeIndex = this.out[0];
    if (edgeIndex === undefined) return;
    const target = this.sim.nodes[this.sim.edges[edgeIndex]!.to];
    if (target instanceof ServiceRuntime) {
      this.target = target;
      this.sim.queue.push(this.sim.now + this.healthCheckMs, EV_TIMER, this.index, TIMER_HEALTH, 0);
    }
  }

  arrive(call: number): void {
    if (!this.admit(call)) return;
    const edgeIndex = this.out[0];
    if (edgeIndex === undefined) {
      this.reject(call, NODE_DOWN);
      return;
    }
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

  override timer(id: number): void {
    if (id !== TIMER_HEALTH || !this.target) return;
    for (let i = 0; i < this.target.instanceSlots; i++) this.healthy[i] = this.target.isUp(i);
    this.sim.queue.push(this.sim.now + this.healthCheckMs, EV_TIMER, this.index, TIMER_HEALTH, 0);
  }

  override route(): number {
    const target = this.target;
    if (!target) return -1;
    const slots = target.instanceSlots;
    let candidates = 0;
    for (let i = 0; i < slots; i++) if (this.eligible(target, i)) candidates++;
    if (candidates === 0) return NO_ROUTE;

    switch (this.algorithm) {
      case 'round-robin': {
        for (let i = 0; i < slots; i++) {
          const index = (this.turn + i) % slots;
          if (!this.eligible(target, index)) continue;
          this.turn = index + 1;
          return index;
        }
        return NO_ROUTE;
      }
      case 'random':
        return this.nth(target, this.pickRng.below(candidates));
      case 'least-connections': {
        // Start from a different instance each time, so equally loaded ones share the calls.
        let best = -1;
        let least = Infinity;
        for (let i = 0; i < slots; i++) {
          const index = (this.turn + i) % slots;
          if (!this.eligible(target, index)) continue;
          const load = target.loadOf(index);
          if (load < least) {
            least = load;
            best = index;
          }
        }
        this.turn = best + 1;
        return best;
      }
      case 'two-choices': {
        // Look at two instances picked at random and take the less loaded of them.
        const first = this.nth(target, this.pickRng.below(candidates));
        const second = this.nth(target, this.pickRng.below(candidates));
        return target.loadOf(second) < target.loadOf(first) ? second : first;
      }
    }
  }

  reconfigure(node: DesignNode): void {
    if (node.type !== 'load-balancer') return;
    this.algorithm = node.params.algorithm;
    this.healthCheckMs = node.params.healthCheckMs;
  }

  /** Whether the balancer would send a call to instance `index`. */
  private eligible(target: ServiceRuntime, index: number): boolean {
    // An instance that is being retired says so at once; one that has died is only found out.
    if (target.isDraining(index)) return false;
    // An instance seen for the first time has just announced itself.
    return (this.healthy[index] ??= target.isUp(index));
  }

  /** The `n`-th eligible instance, counting from zero. */
  private nth(target: ServiceRuntime, n: number): number {
    let seen = 0;
    for (let i = 0; i < target.instanceSlots; i++) {
      if (!this.eligible(target, i)) continue;
      if (seen === n) return i;
      seen++;
    }
    return NO_ROUTE;
  }
}
