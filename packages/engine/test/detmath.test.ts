import { describe, expect, it } from 'vitest';
import { exp, ln, pow } from '../src/kernel/detmath.ts';
import { RandomStream } from '../src/kernel/rng.ts';

/** The 64 bits of a double, as hex. */
function bitsOf(x: number): string {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  return view.getBigUint64(0).toString(16).padStart(16, '0');
}

describe('ln', () => {
  it('agrees with Math.log to a few units in the last place', () => {
    const rng = new RandomStream(7, 'ln');
    let worst = 0;
    for (let i = 0; i < 200_000; i++) {
      // Spread the inputs over 600 orders of magnitude.
      const x = Math.pow(10, (rng.next() - 0.5) * 600) * (1 + rng.next());
      const expected = Math.log(x);
      const error = Math.abs(ln(x) - expected) / Math.max(Math.abs(expected), Number.MIN_VALUE);
      if (error > worst) worst = error;
    }
    expect(worst).toBeLessThan(1e-15);
  });

  it('is accurate close to 1, where the result is tiny', () => {
    for (const delta of [1e-3, 1e-6, 1e-9, 1e-12, 1e-15]) {
      expect(ln(1 + delta)).toBeCloseTo(Math.log1p(delta), 15);
      expect(Math.abs(ln(1 + delta) - Math.log(1 + delta))).toBeLessThan(delta * 1e-13 + 1e-30);
    }
    expect(ln(1)).toBe(0);
  });

  it('handles the edges of the domain', () => {
    expect(ln(0)).toBe(-Infinity);
    expect(ln(Infinity)).toBe(Infinity);
    expect(ln(-1)).toBeNaN();
    expect(ln(NaN)).toBeNaN();
    expect(ln(Number.MIN_VALUE)).toBeCloseTo(Math.log(Number.MIN_VALUE), 10);
    expect(ln(Number.MAX_VALUE)).toBeCloseTo(Math.log(Number.MAX_VALUE), 10);
    expect(ln(2)).toBeCloseTo(Math.LN2, 15);
  });
});

describe('exp', () => {
  it('agrees with Math.exp to a few units in the last place', () => {
    const rng = new RandomStream(7, 'exp');
    let worst = 0;
    for (let i = 0; i < 200_000; i++) {
      const x = (rng.next() - 0.5) * 1400;
      const expected = Math.exp(x);
      const error = Math.abs(exp(x) - expected) / expected;
      if (error > worst) worst = error;
    }
    expect(worst).toBeLessThan(2e-15);
  });

  it('handles the edges of the range', () => {
    expect(exp(0)).toBe(1);
    expect(exp(710)).toBe(Infinity);
    expect(exp(-746)).toBe(0);
    expect(exp(NaN)).toBeNaN();
    expect(exp(-745)).toBeGreaterThan(0);
    expect(exp(709.7)).toBeCloseTo(Math.exp(709.7), -295);
    expect(exp(1)).toBeCloseTo(Math.E, 15);
  });

  it('undoes ln', () => {
    for (const x of [1e-300, 1e-9, 0.5, 1, 3, 12345.678, 1e300]) {
      expect(Math.abs(exp(ln(x)) - x) / x).toBeLessThan(1e-13);
    }
  });
});

describe('pow', () => {
  it('matches Math.pow', () => {
    expect(pow(2, 10)).toBeCloseTo(1024, 9);
    expect(pow(10, -3)).toBeCloseTo(0.001, 15);
    expect(pow(7, 0)).toBe(1);
    expect(pow(0, 2)).toBe(0);
    expect(pow(0, -1)).toBe(Infinity);
    expect(pow(1.5, 2.5)).toBeCloseTo(Math.pow(1.5, 2.5), 13);
  });
});

// These pin the exact bits. If one changes, every recorded report changes with it; and because the
// functions use only exactly-specified operations, the same bits must come out of every JS engine.
describe('bit patterns', () => {
  it('are stable', () => {
    const logs = [1e-10, 0.1, 0.5, 0.9999, 1.0001, 2, 3, 10, 1234.5678, 1e10];
    const powers = [-700, -10, -1, -0.1, 1e-9, 0.1, 0.5, 1, 10, 700];
    expect(logs.map((x) => `ln(${x}) = ${bitsOf(ln(x))}`)).toMatchInlineSnapshot(`
      [
        "ln(1e-10) = c037069e2aa2aa5b",
        "ln(0.1) = c0026bb1bbb55515",
        "ln(0.5) = bfe62e42fefa39ef",
        "ln(0.9999) = bf1a3738d2cf1cc2",
        "ln(1.0001) = 3f1a368d0657fcd4",
        "ln(2) = 3fe62e42fefa39ef",
        "ln(3) = 3ff193ea7aad030b",
        "ln(10) = 40026bb1bbb55516",
        "ln(1234.5678) = 401c7951d51791d7",
        "ln(10000000000) = 4037069e2aa2aa5b",
      ]
    `);
    expect(powers.map((x) => `exp(${x}) = ${bitsOf(exp(x))}`)).toMatchInlineSnapshot(`
      [
        "exp(-700) = 00d14f2b0fb9307f",
        "exp(-10) = 3f07cd79b5647c9a",
        "exp(-1) = 3fd78b56362cef38",
        "exp(-0.1) = 3fecf46d99d52b3a",
        "exp(1e-9) = 3ff000000044b830",
        "exp(0.1) = 3ff1aec7b35a00d4",
        "exp(0.5) = 3ffa61298e1e069c",
        "exp(1) = 4005bf0a8b14576a",
        "exp(10) = 40d5829dcf950560",
        "exp(700) = 7f0d945df4f8ec8e",
      ]
    `);
  });
});
