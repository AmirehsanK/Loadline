import { EV_SERVICE_DONE, IN_SERVICE, RATE_LIMITED } from '../codes.ts';
import { PRICES } from '../cost.ts';
import type { DesignNode, FunctionNode } from '../model/schema.ts';
import type { Simulation } from '../sim.ts';
import { NO_SCALING, ServiceRuntime } from './service.ts';
import type { Instance, PoolConfig } from './service.ts';

// An environment is an instance that works on one call at a time and holds none waiting.
const poolConfig = (params: FunctionNode['params']): PoolConfig => ({
  instances: params.maxConcurrency,
  concurrency: 1,
  queue: 0,
  serviceTime: params.serviceTime,
  autoscale: NO_SCALING,
});

/**
 * Code that runs when it is called, with nothing kept running in between.
 *
 * Each call gets an environment to itself. If one that has just finished a call is still around,
 * the call starts at once; if not, an environment is started for it and the call waits out the
 * start. So there is no queue and no instance count to get wrong, and a surge is met at once, up
 * to `maxConcurrency`, past which calls are refused. What is paid for it is in the slowest calls:
 * the first of a surge, and the first after a quiet spell, when the environments have been let go.
 *
 * In every other way it is a service. It makes the same downstream calls and holds its
 * environment while it waits for them (docs/SPEC.md §4.1, rule 2), and that waiting is charged
 * for, because the charge is for time and not for work.
 */
export class FunctionRuntime extends ServiceRuntime {
  coldStarts = 0;

  private coldStartMs: number;
  private keepWarmMs: number;
  // Unset while the constructor of the class above is running, which already asks for the price.
  private reserved: number | undefined;

  // Environments with nothing to do, by instance index. Each is in exactly one of these.
  /** Kept ready at all times. */
  private readonly ready: number[] = [];
  /** Finished a call a while ago, most recently on top, so the ones underneath are left to go cold. */
  private readonly warm: number[] = [];
  /** Not started, or let go. */
  private readonly spare: number[] = [];
  private readonly listed: boolean[] = [];
  /** Whether the environment has run a call since it was last started. */
  private readonly started: boolean[] = [];
  private readonly freedAt: number[] = [];
  /** Whether the environment `take` has just handed out has to be started first. */
  private cold = false;

  constructor(sim: Simulation, index: number, node: FunctionNode) {
    super(sim, index, node.id, 'function', poolConfig(node.params));
    this.coldStartMs = node.params.coldStartMs;
    this.keepWarmMs = node.params.keepWarmMs;
    this.reserved = node.params.provisioned;
    this.applyConfig(poolConfig(node.params));
  }

  /** Its environments come and go by themselves; from outside it is one thing, up or down. */
  override get instanceCount(): number {
    return this.down ? 0 : 1;
  }

  override arrive(call: number): void {
    if (!this.admit(call)) return;
    const instance = this.take();
    if (!instance) {
      // Every environment it is allowed is busy. There is nowhere to wait.
      this.reject(call, RATE_LIMITED);
      return;
    }
    this.sim.calls.inst[call] = instance.index;
    this.begin(call, instance);
  }

  override reconfigure(node: DesignNode): void {
    if (node.type !== 'function') return;
    this.coldStartMs = node.params.coldStartMs;
    this.keepWarmMs = node.params.keepWarmMs;
    this.reserved = node.params.provisioned;
    this.applyConfig(poolConfig(node.params));
  }

  /** There are no instances to lose one by one: it is the whole function or nothing. */
  override kill(): boolean {
    super.kill(undefined);
    this.ready.length = 0;
    this.warm.length = 0;
    this.spare.length = 0;
    this.listed.fill(false);
    this.started.fill(false);
    return true;
  }

  override revive(): void {
    super.revive(undefined);
  }

  /** The time its environments spent on calls is what a function costs, on top of any kept ready. */
  override monthlyCost(): number {
    const now = this.sim.now;
    const busy = now > 0 ? this.slotTime().busy / now : 0;
    return super.monthlyCost() + PRICES.functionBusy * busy;
  }

  override detail(): Record<string, number> {
    return { coldStarts: this.coldStarts, throttled: this.failedBy[RATE_LIMITED]!, warm: this.warmNow() };
  }

  protected override priceOf(): number {
    return (this.reserved ?? 0) * PRICES.functionProvisioned;
  }

  protected override idle(instance: Instance): void {
    if (this.reserved === undefined) return;
    const index = instance.index;
    if (this.listed[index] === true) return;
    this.listed[index] = true;
    if (index < this.reserved) {
      this.ready.push(index);
    } else if (this.started[index] === true) {
      this.freedAt[index] = this.sim.now;
      this.warm.push(index);
    } else {
      this.spare.push(index);
    }
  }

  protected override begin(call: number, instance: Instance): void {
    const sim = this.sim;
    this.touch();
    this.busy++;
    instance.active++;
    sim.calls.state[call] = IN_SERVICE;
    let work = this.serviceTime(this.serviceRng) * this.slowFactor;
    if (this.cold) {
      work += this.coldStartMs;
      this.coldStarts++;
      this.cold = false;
    }
    this.started[instance.index] = true;
    sim.queue.push(sim.now + work, EV_SERVICE_DONE, call, sim.calls.gen[call]!, 0);
  }

  /** An environment for a new call: one that is ready if there is one, else one to be started. */
  private take(): Instance | undefined {
    if (this.down) return undefined;
    this.cold = false;
    const ready = this.pop(this.ready);
    if (ready) return ready;

    const now = this.sim.now;
    while (this.warm.length > 0) {
      const index = this.warm[this.warm.length - 1]!;
      if (this.freedAt[index]! + this.keepWarmMs <= now) {
        // It has been let go, and so has everything under it, which finished earlier still.
        for (const gone of this.warm) {
          this.started[gone] = false;
          this.spare.push(gone);
        }
        this.warm.length = 0;
        break;
      }
      const warm = this.pop(this.warm);
      if (warm) return warm;
    }

    const spare = this.pop(this.spare);
    if (spare) this.cold = true;
    return spare;
  }

  /** Takes the top usable environment off a list. One that has been retired or is busy is dropped. */
  private pop(list: number[]): Instance | undefined {
    while (list.length > 0) {
      const index = list.pop()!;
      this.listed[index] = false;
      const instance = this.instances[index]!;
      if (instance.up && !instance.draining && instance.active === 0) return instance;
    }
    return undefined;
  }

  /** Environments that could take a call now without being started. */
  private warmNow(): number {
    const now = this.sim.now;
    let count = this.ready.length;
    for (let i = this.warm.length - 1; i >= 0; i--) {
      if (this.freedAt[this.warm[i]!]! + this.keepWarmMs <= now) break;
      count++;
    }
    return count;
  }
}
