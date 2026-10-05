import { exp, ln } from './detmath.ts';
import type { RandomStream } from './rng.ts';

/** How a duration varies from one draw to the next. `mean` is in milliseconds. */
export interface Dist {
  kind: 'const' | 'exp' | 'lognormal';
  mean: number;
  /** Coefficient of variation (standard deviation / mean). Only used by `lognormal`. */
  cv?: number | undefined;
}

export type Sampler = (rng: RandomStream) => number;

/** An exponentially distributed duration with the given mean. */
export function exponential(rng: RandomStream, mean: number): number {
  // next() is in [0, 1), so the argument of ln is in (0, 1] and the result is never negative.
  return -mean * ln(1 - rng.next());
}

/**
 * A standard normal variate by Marsaglia's polar method, which needs no trigonometry. The second
 * variate the method yields is discarded so that each call consumes its own draws.
 */
export function standardNormal(rng: RandomStream): number {
  for (;;) {
    const u = 2 * rng.next() - 1;
    const v = 2 * rng.next() - 1;
    const s = u * u + v * v;
    if (s > 0 && s < 1) return u * Math.sqrt((-2 * ln(s)) / s);
  }
}

export function makeSampler(dist: Dist): Sampler {
  const mean = dist.mean;
  switch (dist.kind) {
    case 'const':
      return () => mean;
    case 'exp':
      return (rng) => exponential(rng, mean);
    case 'lognormal': {
      // Parameters of the underlying normal that give this mean and coefficient of variation.
      const cv = dist.cv ?? 1;
      const variance = ln(1 + cv * cv);
      const mu = ln(mean) - variance / 2;
      const sigma = Math.sqrt(variance);
      return (rng) => exp(mu + sigma * standardNormal(rng));
    }
  }
}
