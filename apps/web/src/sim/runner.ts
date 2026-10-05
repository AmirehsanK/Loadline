import { createSimulation } from '@loadline/engine';
import type { Design, Simulation } from '@loadline/engine';
import type { Frame } from './protocol.ts';

// A slice of work is cut into chunks this size, so the time budget is checked often enough.
const CHUNK_EVENTS = 20_000;
// After a long gap between steps (a sleeping tab), do not try to catch up on all of it.
const MAX_GAP_MS = 250;

/**
 * Drives a simulation against real time.
 *
 * Simulated time follows the wall clock, scaled by the speed. When the simulation cannot keep up
 * the run simply falls behind; it never skips work, so the result is the same at any speed.
 *
 * It takes the wall clock as an argument and touches no worker or DOM API, so it can be tested.
 */
export class Runner {
  private sim: Simulation | null = null;
  private run = 0;
  private playing = false;
  private speed = 1;
  /** Simulated time the run should have reached by now. */
  private target = 0;
  private steppedAt = 0;
  private framedAt = 0;
  private framedNow = 0;

  /** Replaces the current run with a fresh one, paused at time zero. */
  load(run: number, design: Design, seed: number, multiplier: number): void {
    this.run = run;
    this.sim = null;
    this.target = 0;
    this.framedNow = 0;
    const sim = createSimulation(design, { seed });
    if (multiplier !== 1) sim.setMultiplier(multiplier);
    this.sim = sim;
  }

  play(wallNow: number): void {
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

  get isPlaying(): boolean {
    return this.playing && this.sim !== null;
  }

  /**
   * Advances the run for the real time that has passed, spending at most `budgetMs` doing it.
   * `clock` reads the wall clock in milliseconds.
   */
  step(wallNow: number, budgetMs: number, clock: () => number): void {
    const sim = this.sim;
    if (!sim || !this.playing) return;
    const gap = Math.min(wallNow - this.steppedAt, MAX_GAP_MS);
    this.steppedAt = wallNow;
    this.target += gap * this.speed;

    const deadline = clock() + budgetMs;
    while (!sim.advance(this.target, CHUNK_EVENTS)) {
      if (clock() >= deadline) {
        // Out of time for this slice. Carry on from here rather than piling up a debt.
        this.target = sim.now;
        break;
      }
    }
  }

  /** The state of the run, with the samples closed since the previous frame. */
  frame(wallNow: number): Frame {
    const sim = this.sim;
    const elapsed = wallNow - this.framedAt;
    const now = sim?.now ?? 0;
    const measuredSpeed = this.playing && elapsed > 0 ? (now - this.framedNow) / elapsed : 0;
    this.framedAt = wallNow;
    this.framedNow = now;
    return {
      run: this.run,
      now,
      measuredSpeed,
      playing: this.isPlaying,
      samples: sim?.takeSamples() ?? [],
      gauges: sim?.gauges() ?? [],
      totals: {
        created: sim?.created ?? 0,
        ok: sim?.ok ?? 0,
        failed: sim?.failed ?? 0,
        attempts: sim?.attempts ?? 0,
        events: sim?.events ?? 0,
      },
    };
  }
}
