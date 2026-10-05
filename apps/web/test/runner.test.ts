import { designSchema } from '@loadline/engine';
import { describe, expect, it } from 'vitest';
import { STARTER } from '../src/design/model.ts';
import { Runner } from '../src/sim/runner.ts';

const design = designSchema.parse(STARTER);

/** A wall clock the test moves by hand. */
function fakeClock() {
  let now = 1000;
  return {
    read: () => now,
    tick: (ms: number) => {
      now += ms;
      return now;
    },
  };
}

function loaded(): { runner: Runner; clock: ReturnType<typeof fakeClock> } {
  const runner = new Runner();
  runner.load(1, design, 7, 1);
  return { runner, clock: fakeClock() };
}

describe('Runner', () => {
  it('starts paused at time zero', () => {
    const { runner, clock } = loaded();
    runner.step(clock.tick(100), 50, clock.read);
    expect(runner.frame(clock.read())).toMatchObject({ run: 1, now: 0, playing: false, measuredSpeed: 0, samples: [] });
  });

  it('follows the wall clock while playing', () => {
    const { runner, clock } = loaded();
    runner.play(clock.read());
    for (let i = 0; i < 20; i++) runner.step(clock.tick(100), 1000, clock.read);
    const frame = runner.frame(clock.read());
    expect(frame.now).toBeCloseTo(2000, 6);
    expect(frame.playing).toBe(true);
    expect(frame.samples.map((sample) => sample.t)).toEqual([1000, 2000]);
    expect(frame.gauges).toHaveLength(design.nodes.length);
    expect(frame.totals.created).toBeGreaterThan(300);
  });

  it('runs faster when the speed is raised, and stops when paused', () => {
    const { runner, clock } = loaded();
    runner.play(clock.read());
    runner.setSpeed(5);
    for (let i = 0; i < 10; i++) runner.step(clock.tick(100), 1000, clock.read);
    expect(runner.frame(clock.read()).now).toBeCloseTo(5000, 6);

    runner.pause();
    for (let i = 0; i < 10; i++) runner.step(clock.tick(100), 1000, clock.read);
    const frame = runner.frame(clock.read());
    expect(frame.now).toBeCloseTo(5000, 6);
    expect(frame.playing).toBe(false);
  });

  it('does not count the time it spent paused when it resumes', () => {
    const { runner, clock } = loaded();
    runner.play(clock.read());
    runner.step(clock.tick(100), 1000, clock.read);
    runner.pause();
    clock.tick(60_000);
    runner.play(clock.read());
    runner.step(clock.tick(100), 1000, clock.read);
    expect(runner.frame(clock.read()).now).toBeCloseTo(200, 6);
  });

  it('hands each sample over once', () => {
    const { runner, clock } = loaded();
    runner.play(clock.read());
    for (let i = 0; i < 12; i++) runner.step(clock.tick(100), 1000, clock.read);
    expect(runner.frame(clock.read()).samples).toHaveLength(1);
    expect(runner.frame(clock.read()).samples).toHaveLength(0);
  });

  it('measures the speed it actually achieved', () => {
    const { runner, clock } = loaded();
    runner.play(clock.read());
    runner.setSpeed(2);
    runner.frame(clock.read());
    for (let i = 0; i < 10; i++) runner.step(clock.tick(100), 1000, clock.read);
    expect(runner.frame(clock.read()).measuredSpeed).toBeCloseTo(2, 6);
  });

  it('falls behind, without piling up a debt, when it runs out of time', () => {
    const { runner, clock } = loaded();
    runner.play(clock.read());
    runner.setSpeed(1000);
    // A clock that always says the budget is spent: each step gets exactly one chunk of events.
    let calls = 0;
    const exhausted = () => {
      calls++;
      return calls * 1e9;
    };
    runner.step(clock.tick(100), 1, exhausted);
    const behind = runner.frame(clock.read()).now;
    expect(behind).toBeGreaterThan(0);
    expect(behind).toBeLessThan(100_000);

    // Back at normal speed it carries on from where it got to, not from where it should have been.
    runner.setSpeed(1);
    runner.step(clock.tick(100), 1000, clock.read);
    expect(runner.frame(clock.read()).now).toBeCloseTo(behind + 100, 6);
  });

  it('does not try to catch up after a long gap between steps', () => {
    const { runner, clock } = loaded();
    runner.play(clock.read());
    runner.step(clock.tick(30_000), 1000, clock.read);
    expect(runner.frame(clock.read()).now).toBeCloseTo(250, 6);
  });

  it('applies the traffic multiplier it was loaded with, and changes to it', () => {
    const quiet = new Runner();
    const clock = fakeClock();
    quiet.load(3, design, 7, 0);
    quiet.play(clock.read());
    for (let i = 0; i < 10; i++) quiet.step(clock.tick(100), 1000, clock.read);
    expect(quiet.frame(clock.read()).totals.created).toBe(0);

    quiet.setMultiplier(2);
    for (let i = 0; i < 10; i++) quiet.step(clock.tick(100), 1000, clock.read);
    const frame = quiet.frame(clock.read());
    expect(frame.run).toBe(3);
    expect(frame.totals.created).toBeGreaterThan(300);
  });

  it('gives the same run for the same seed, whatever the pace of the steps', () => {
    const totals = (stepMs: number, speed: number) => {
      const { runner, clock } = loaded();
      runner.play(clock.read());
      runner.setSpeed(speed);
      const steps = 10_000 / speed / stepMs;
      for (let i = 0; i < steps; i++) runner.step(clock.tick(stepMs), 1000, clock.read);
      const frame = runner.frame(clock.read());
      expect(frame.now).toBeCloseTo(10_000, 6);
      return frame.totals;
    };
    expect(totals(16, 1)).toEqual(totals(100, 5));
  });
});
