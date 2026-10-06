import { buildReport, createSimulation, describeBlame, findBottleneck, summarize, totalMonthlyCost } from '@loadline/engine';
import type { Command, Design, Simulation, Workload } from '@loadline/engine';
import { evaluate, startScenario } from '@loadline/scenarios';
import type { Scenario } from '@loadline/scenarios';
import type { Frame, FullReport } from './protocol.ts';

// A slice of work is cut into chunks this size, so the time budget is checked often enough.
const CHUNK_EVENTS = 20_000;
// After a long gap between steps (a sleeping tab), do not try to catch up on all of it.
const MAX_GAP_MS = 250;
/** How many sampling windows the bottleneck is judged over. */
const BOTTLENECK_WINDOWS = 5;
/** At full speed, how much simulated time one slice of work reaches for. */
const FULL_SPEED_REACH_MS = 60_000;

/**
 * Drives a simulation against real time.
 *
 * Simulated time follows the wall clock, scaled by the speed. When the simulation cannot keep up
 * the run simply falls behind; it never skips work, so the result is the same at any speed.
 *
 * A run of a level uses the level's traffic, faults and seed, and stops when it reaches the
 * level's end. The same `evaluate` that scores a level everywhere else scores it here.
 *
 * It takes the wall clock as an argument and touches no worker or DOM API, so it can be tested.
 */
export class Runner {
  private sim: Simulation | null = null;
  private design: Design | null = null;
  private level: Scenario | null = null;
  private run = 0;
  private playing = false;
  private speed = 1;
  /** Simulated time the run should have reached by now. */
  private target = 0;
  /** Simulated time at which the run is over. */
  private endMs = Infinity;
  private steppedAt = 0;
  private framedAt = 0;
  private framedNow = 0;

  /**
   * Replaces the current run with a fresh one, paused at time zero. A level brings its own traffic
   * and faults; without one, `workload` is what the design came with.
   */
  load(run: number, design: Design, seed: number, multiplier: number, level: Scenario | null = null, workload: Workload | null = null): void {
    this.run = run;
    this.sim = null;
    this.design = design;
    this.level = level;
    this.playing = false;
    this.target = 0;
    this.framedNow = 0;
    this.endMs = level ? level.durationMs : Infinity;
    if (level) {
      this.sim = startScenario(level, design, seed);
      return;
    }
    const sim = createSimulation(design, { seed, ...(workload ? { workload } : {}) });
    // Scripted traffic sets its own level; the control is for designs that have none.
    if (!workload && multiplier !== 1) sim.setMultiplier(multiplier);
    this.sim = sim;
  }

  /** Applies new settings to the run in progress. The design's nodes and edges must be the same. */
  reconfigure(design: Design): void {
    this.sim?.reconfigure(design);
    this.design = design;
  }

  play(wallNow: number): void {
    if (this.isFinished) return;
    this.playing = true;
    this.steppedAt = wallNow;
  }

  pause(): void {
    this.playing = false;
  }

  setSpeed(value: number): void {
    this.speed = value;
  }

  setMultiplier(value: number): void {
    this.sim?.setMultiplier(value);
  }

  /** Injects a fault into the run in progress. */
  command(command: Command): void {
    this.sim?.command(command);
  }

  get isPlaying(): boolean {
    return this.playing && this.sim !== null;
  }

  /** Whether the run has reached its end. Only a run of a level has one. */
  get isFinished(): boolean {
    return this.sim !== null && this.sim.now >= this.endMs;
  }

  /**
   * Advances the run for the real time that has passed, spending at most `budgetMs` doing it.
   * `clock` reads the wall clock in milliseconds. Returns true when this step took the run to
   * its end.
   */
  step(wallNow: number, budgetMs: number, clock: () => number): boolean {
    const sim = this.sim;
    if (!sim || !this.playing) return false;
    const gap = Math.min(wallNow - this.steppedAt, MAX_GAP_MS);
    this.steppedAt = wallNow;
    // At full speed there is no pace to keep: it goes as far as the time budget lets it.
    const ahead = Number.isFinite(this.speed) ? this.target + gap * this.speed : sim.now + FULL_SPEED_REACH_MS;
    this.target = Math.min(ahead, this.endMs);

    const deadline = clock() + budgetMs;
    while (!sim.advance(this.target, CHUNK_EVENTS)) {
      if (clock() >= deadline) {
        // Out of time for this slice. Carry on from here rather than piling up a debt.
        this.target = sim.now;
        break;
      }
    }
    if (sim.now < this.endMs) return false;
    this.playing = false;
    return true;
  }

  /** The whole report of the run so far, as the command line would print it, or null with no run. */
  report(): FullReport | null {
    const sim = this.sim;
    if (!sim) return null;
    return { report: buildReport(sim), outcome: this.level && this.design ? evaluate(this.level, this.design, sim) : null };
  }

  /** The state of the run, with the samples closed since the previous frame. */
  frame(wallNow: number): Frame {
    const sim = this.sim;
    const elapsed = wallNow - this.framedAt;
    const now = sim?.now ?? 0;
    const measuredSpeed = this.playing && elapsed > 0 ? (now - this.framedNow) / elapsed : 0;
    this.framedAt = wallNow;
    this.framedNow = now;
    const recent = sim ? summarize(sim.samples.slice(-BOTTLENECK_WINDOWS)) : undefined;
    return {
      run: this.run,
      now,
      measuredSpeed,
      playing: this.isPlaying,
      traffic: sim?.multiplier ?? 1,
      samples: sim?.takeSamples() ?? [],
      gauges: sim?.gauges() ?? [],
      totals: {
        created: sim?.created ?? 0,
        ok: sim?.ok ?? 0,
        failed: sim?.failed ?? 0,
        attempts: sim?.attempts ?? 0,
        events: sim?.events ?? 0,
      },
      blame: sim ? describeBlame(sim) : [],
      bottleneck: recent && this.design ? findBottleneck(this.design, recent) : null,
      monthlyCost: sim ? totalMonthlyCost(sim) : 0,
      level:
        sim && this.level && this.design
          ? { outcome: evaluate(this.level, this.design, sim), finished: this.isFinished }
          : null,
    };
  }
}
