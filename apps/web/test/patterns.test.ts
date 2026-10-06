import { createSimulation, designSchema, workloadSchema } from '@loadline/engine';
import { describe, expect, it } from 'vitest';
import { STARTER } from '../src/design/model.ts';
import { scriptOfWorkload } from '../src/level/Timeline.tsx';
import { PATTERNS, patternOf, patternWorkload } from '../src/sim/patterns.ts';

const multipliers = (pattern: (typeof PATTERNS)[number]) => patternWorkload(pattern).phases.map((phase) => phase.multiplier);

describe('the traffic patterns', () => {
  it('are each scripted traffic the engine accepts, in order of time, with nothing done to the system', () => {
    for (const pattern of PATTERNS) {
      const workload = patternWorkload(pattern);
      expect(workloadSchema.parse(workload), pattern).toEqual(workload);
      expect(workload.chaos, pattern).toEqual([]);
      expect(workload.phases.length, pattern).toBeGreaterThan(1);
      const times = workload.phases.map((phase) => phase.atMs);
      expect([...times].sort((a, b) => a - b), pattern).toEqual(times);
    }
  });

  it('can each be told apart from the others, and from traffic that is none of them', () => {
    for (const pattern of PATTERNS) expect(patternOf(patternWorkload(pattern))).toBe(pattern);
    expect(patternOf(workloadSchema.parse({ phases: [{ atMs: 5000, multiplier: 2 }] }))).toBeNull();
    // What a link gives back is the same traffic, and is recognised as the pattern it was.
    const sent: unknown = JSON.parse(JSON.stringify(patternWorkload('wave')));
    expect(patternOf(workloadSchema.parse(sent))).toBe('wave');
  });

  it('have the shapes their names say', () => {
    const ramp = multipliers('ramp');
    expect(ramp.every((value, index) => index === 0 || value > ramp[index - 1]!)).toBe(true);
    expect(ramp.at(-1)).toBe(3);

    expect(multipliers('steps')).toEqual([1.5, 2, 2.5, 3, 3.5, 4]);

    const wave = multipliers('wave');
    expect(Math.max(...wave)).toBe(2.5);
    expect(Math.min(...wave)).toBe(0.5);
    // It comes back to where it started once a minute.
    expect(wave[20]).toBe(wave[0]);

    const spikes = patternWorkload('spikes').phases;
    expect(new Set(spikes.map((phase) => phase.multiplier))).toEqual(new Set([4, 1]));
    expect(spikes[1]!.atMs - spikes[0]!.atMs).toBe(5000);
    expect(spikes[2]!.atMs - spikes[0]!.atMs).toBe(30_000);
  });

  it('drive a run: the traffic at a moment is what the pattern says it is', () => {
    const sim = createSimulation(designSchema.parse(STARTER), { seed: 1, workload: patternWorkload('steps') });
    sim.advance(10_000);
    expect(sim.multiplier).toBe(1);
    sim.advance(45_000);
    expect(sim.multiplier).toBe(2);
    sim.advance(600_000);
    expect(sim.multiplier).toBe(4);
  });

  it('are drawn on a line that reaches a little past their last change', () => {
    for (const pattern of PATTERNS) {
      const workload = patternWorkload(pattern);
      expect(scriptOfWorkload(workload).durationMs, pattern).toBe(workload.phases.at(-1)!.atMs + 20_000);
    }
  });
});
