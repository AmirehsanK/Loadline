import { commandSchema, designSchema } from '@loadline/engine';
import { findLevel, runScenario } from '@loadline/scenarios';
import { describe, expect, it } from 'vitest';
import { STARTER } from '../src/design/model.ts';
import { FULL_SPEED } from '../src/sim/protocol.ts';
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

  it('reports what the design costs, where the time goes, and why requests fail', () => {
    const { runner, clock } = loaded();
    expect(runner.frame(clock.read())).toMatchObject({ monthlyCost: 63 + 27, bottleneck: null, blame: [] });

    runner.play(clock.read());
    runner.setSpeed(10);
    for (let i = 0; i < 100; i++) runner.step(clock.tick(100), 1000, clock.read);
    // The starter spends most of its time on the API's own 20 ms of work, and has room to spare.
    expect(runner.frame(clock.read()).bottleneck).toMatchObject({ nodeId: 'api', kind: 'work', path: ['api'] });

    runner.command(commandSchema.parse({ type: 'kill', nodeId: 'store' }));
    for (let i = 0; i < 100; i++) runner.step(clock.tick(100), 1000, clock.read);
    const frame = runner.frame(clock.read());
    expect(frame.bottleneck).toMatchObject({ nodeId: 'store', kind: 'down' });
    expect(frame.blame[0]).toMatchObject({ cause: 'node-down', nodeId: 'store' });
    expect(frame.gauges[2]).toMatchObject({ instances: 0 });
  });

  it('applies new settings to the run in progress', () => {
    const { runner, clock } = loaded();
    runner.play(clock.read());
    for (let i = 0; i < 50; i++) runner.step(clock.tick(100), 1000, clock.read);
    const before = runner.frame(clock.read());

    const slower = designSchema.parse({
      ...design,
      nodes: design.nodes.map((node) => (node.type === 'client' ? { ...node, params: { ...node.params, rps: 20 } } : node)),
    });
    runner.reconfigure(slower);
    for (let i = 0; i < 50; i++) runner.step(clock.tick(100), 1000, clock.read);
    const after = runner.frame(clock.read());

    // The clock carried on, and the last five seconds saw a tenth of the traffic.
    expect(after.now).toBeCloseTo(10_000, 6);
    expect(before.totals.created).toBeGreaterThan(800);
    expect(after.totals.created - before.totals.created).toBeLessThan(160);
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

describe('Runner, on a level', () => {
  const level = findLevel('first-traffic')!;

  function onLevel(target = level.starter) {
    const runner = new Runner();
    runner.load(1, target, level.seed, 1, level);
    return { runner, clock: fakeClock() };
  }

  it('sends the traffic of the level, and stops at its end with the result', () => {
    const { runner, clock } = onLevel();
    runner.play(clock.read());
    runner.setSpeed(10);
    let ended = 0;
    for (let i = 0; i < 100; i++) if (runner.step(clock.tick(100), 1000, clock.read)) ended++;

    const frame = runner.frame(clock.read());
    expect(ended).toBe(1);
    expect(frame.now).toBe(level.durationMs);
    expect(frame.playing).toBe(false);
    // The level's traffic had climbed to three times its base by the end.
    expect(frame.traffic).toBe(3);
    expect(frame.level?.finished).toBe(true);
    // The result is the one the same design gets anywhere else.
    expect(frame.level?.outcome).toEqual(runScenario(level, level.starter));
    expect(frame.level?.outcome.passed).toBe(false);

    // A run that is over does not start again by itself.
    runner.play(clock.read());
    expect(runner.step(clock.tick(100), 1000, clock.read)).toBe(false);
    expect(runner.frame(clock.read()).now).toBe(level.durationMs);
  });

  it('judges the run as it goes, with nothing scored during warm-up', () => {
    const { runner, clock } = onLevel(level.reference);
    runner.play(clock.read());
    runner.setSpeed(10);
    for (let i = 0; i < 20; i++) runner.step(clock.tick(100), 1000, clock.read);

    const early = runner.frame(clock.read());
    expect(early.now).toBeCloseTo(20_000, 6);
    expect(early.totals.ok).toBeGreaterThan(2000);
    expect(early.level).toMatchObject({ finished: false, outcome: { passed: false, score: { fromMs: level.warmupMs, ok: 0, failed: 0 } } });

    for (let i = 0; i < 20; i++) runner.step(clock.tick(100), 1000, clock.read);
    const later = runner.frame(clock.read());
    expect(later.level?.outcome.score.ok).toBeGreaterThan(2500);
    expect(later.level?.outcome.passed).toBe(true);
  });

  it('goes as fast as it can at full speed, to the same result', () => {
    const { runner, clock } = onLevel(level.reference);
    runner.play(clock.read());
    runner.setSpeed(FULL_SPEED);
    let steps = 1;
    while (!runner.step(clock.tick(16), 1000, clock.read)) {
      steps++;
      if (steps > 50) throw new Error('the run never ended');
    }
    // A minute of simulated time to a slice: 75 s is two of them.
    expect(steps).toBe(2);
    const frame = runner.frame(clock.read());
    expect(frame.level?.outcome).toEqual(runScenario(level, level.reference));
    expect(frame.level?.outcome.stars).toBe(3);
  });

  it('stops short of forever at full speed when the run has no end', () => {
    const { runner, clock } = loaded();
    runner.play(clock.read());
    runner.setSpeed(FULL_SPEED);
    expect(runner.step(clock.tick(16), 1000, clock.read)).toBe(false);
    expect(runner.frame(clock.read())).toMatchObject({ now: 60_000, playing: true, level: null });
  });
});
