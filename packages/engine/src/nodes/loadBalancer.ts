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
 *
 * A retry does not wait for the check: it goes to a different instance from the one that has just
 * failed the call, if there is another. A call's `tag` holds the instance it was last sent to.
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
    this.sim.calls.tag[call] = -1;
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

  override route(call: number): number {
    const target = this.target;
    if (!target) return -1;
    const calls = this.sim.calls;
    // On a retry, the instance that has just failed this call is passed over if there is another.
    let avoid = calls.attempt[call]! > 0 ? calls.tag[call]! : -1;
    let candidates = this.count(target, avoid);
    if (candidates === 0 && avoid >= 0) {
      avoid = -1;
      candidates = this.count(target, avoid);
    }
    if (candidates === 0) return NO_ROUTE;
    const chosen = this.pick(target, candidates, avoid);
    calls.tag[call] = chosen;
    return chosen;
  }

  private pick(target: ServiceRuntime, candidates: number, avoid: number): number {
    const slots = target.instanceSlots;
    switch (this.algorithm) {
      case 'round-robin': {
        for (let i = 0; i < slots; i++) {
          const index = (this.turn + i) % slots;
          if (index === avoid || !this.eligible(target, index)) continue;
          this.turn = index + 1;
          return index;
        }
        return NO_ROUTE;
      }
      case 'random':
        return this.nth(target, this.pickRng.below(candidates), avoid);
      case 'least-connections': {
        // Start from a different instance each time, so equally loaded ones share the calls.
        let best = -1;
        let least = Infinity;
        for (let i = 0; i < slots; i++) {
          const index = (this.turn + i) % slots;
          if (index === avoid || !this.eligible(target, index)) continue;
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
        const first = this.nth(target, this.pickRng.below(candidates), avoid);
        const second = this.nth(target, this.pickRng.below(candidates), avoid);
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

  /** How many instances the balancer would send a call to, leaving out `avoid`. */
  private count(target: ServiceRuntime, avoid: number): number {
    let candidates = 0;
    for (let i = 0; i < target.instanceSlots; i++) if (i !== avoid && this.eligible(target, i)) candidates++;
    return candidates;
  }

  /** The `n`-th eligible instance, counting from zero and leaving out `avoid`. */
  private nth(target: ServiceRuntime, n: number, avoid: number): number {
    let seen = 0;
    for (let i = 0; i < target.instanceSlots; i++) {
      if (i === avoid || !this.eligible(target, i)) continue;
      if (seen === n) return i;
      seen++;
    }
    return NO_ROUTE;
  }
}
