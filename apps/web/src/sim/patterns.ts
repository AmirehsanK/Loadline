import { workloadSchema } from '@loadline/engine';
import type { Workload } from '@loadline/engine';

// Shapes of traffic for the sandbox. Each is ordinary scripted traffic, a list of moments at which
// every client's rate is multiplied by something new, so the engine needs to know nothing about
// them, and a design shared while one is playing carries it in the link like any other.
//
// A sandbox run has no end and a list has one, so each shape is written out for a while and then
// holds where it stopped.

export const PATTERNS = ['ramp', 'steps', 'wave', 'spikes'] as const;
export type Pattern = (typeof PATTERNS)[number];

type Phase = { atMs: number; multiplier: number };

const SECOND = 1000;
const hundredth = (value: number) => Math.round(value * 100) / 100;

/** From normal to three times as much over two minutes, a little every two seconds. */
function ramp(): Phase[] {
  const phases: Phase[] = [];
  for (let step = 1; step <= 60; step++) phases.push({ atMs: 20 * SECOND + step * 2 * SECOND, multiplier: hundredth(1 + (2 * step) / 60) });
  return phases;
}

/** Half as much again every twenty seconds, up to four times: each level long enough to settle. */
function steps(): Phase[] {
  const phases: Phase[] = [];
  for (let step = 1; step <= 6; step++) phases.push({ atMs: step * 20 * SECOND, multiplier: 1 + step / 2 });
  return phases;
}

/** A day in a minute: rising to two and a half times and falling to half, over and over. */
function wave(): Phase[] {
  const phases: Phase[] = [];
  const period = 60 * SECOND;
  // Every three seconds, which lands on the top and the bottom of the wave. Rounded to hundredths,
  // and none of these values is near the middle of one, so every browser writes the same list.
  for (let atMs = 0; atMs <= 5 * period; atMs += 3 * SECOND) {
    // Between 0.5 and 2.5, starting at the middle on the way up.
    phases.push({ atMs, multiplier: hundredth(1.5 + Math.sin((2 * Math.PI * atMs) / period)) });
  }
  return phases;
}

/** Quiet, with four times the traffic for five seconds every half minute. */
function spikes(): Phase[] {
  const phases: Phase[] = [];
  for (let atMs = 15 * SECOND; atMs < 5 * 60 * SECOND; atMs += 30 * SECOND) {
    phases.push({ atMs, multiplier: 4 }, { atMs: atMs + 5 * SECOND, multiplier: 1 });
  }
  return phases;
}

const SHAPES: Record<Pattern, () => Phase[]> = { ramp, steps, wave, spikes };

/** The scripted traffic of a pattern. */
export function patternWorkload(pattern: Pattern): Workload {
  return workloadSchema.parse({ phases: SHAPES[pattern]() });
}

/** Which pattern a design's traffic is, if it is one of them unchanged. */
export function patternOf(workload: Workload): Pattern | null {
  const text = JSON.stringify(workload);
  return PATTERNS.find((pattern) => JSON.stringify(patternWorkload(pattern)) === text) ?? null;
}
