import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { exponential, makeSampler } from '../src/kernel/dist.ts';
import { EventQueue } from '../src/kernel/eventQueue.ts';
import { IntRing } from '../src/kernel/ring.ts';
import { RandomStream, hashString } from '../src/kernel/rng.ts';
import { Histogram } from '../src/metrics/histogram.ts';

describe('RandomStream', () => {
  it('repeats for the same seed and key', () => {
    const a = new RandomStream(42, 'api/service');
    const b = new RandomStream(42, 'api/service');
    for (let i = 0; i < 1000; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it('differs when the seed or the key differs', () => {
    const take = (seed: number, key: string) => {
      const rng = new RandomStream(seed, key);
      return Array.from({ length: 8 }, () => rng.nextU32());
    };
    expect(take(42, 'api/service')).not.toEqual(take(43, 'api/service'));
    expect(take(42, 'api/service')).not.toEqual(take(42, 'api/arrivals'));
    expect(take(1, 'b')).not.toEqual(take(2, 'a'));
  });

  it('is uniform on [0, 1)', () => {
    const rng = new RandomStream(1, 'uniform');
    const bins = new Array<number>(20).fill(0);
    let sum = 0;
    const n = 400_000;
    for (let i = 0; i < n; i++) {
      const u = rng.next();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      sum += u;
      bins[Math.floor(u * 20)]!++;
    }
    expect(sum / n).toBeCloseTo(0.5, 2);
    for (const count of bins) expect(Math.abs(count - n / 20) / (n / 20)).toBeLessThan(0.03);
  });

  it('keeps its output stable', () => {
    const rng = new RandomStream(2026, 'users/arrivals');
    expect(Array.from({ length: 4 }, () => rng.nextU32())).toMatchInlineSnapshot(`
      [
        200985720,
        4158732341,
        2401031811,
        3249125131,
      ]
    `);
    expect(hashString('users/arrivals')).toMatchInlineSnapshot(`233263318`);
  });
});

describe('distributions', () => {
  it('exponential has the requested mean and a standard deviation equal to it', () => {
    const rng = new RandomStream(3, 'exp');
    const n = 400_000;
    let sum = 0;
    let squares = 0;
    for (let i = 0; i < n; i++) {
      const x = exponential(rng, 20);
      expect(x).toBeGreaterThanOrEqual(0);
      sum += x;
      squares += x * x;
    }
    const mean = sum / n;
    const deviation = Math.sqrt(squares / n - mean * mean);
    expect(mean).toBeGreaterThan(19.8);
    expect(mean).toBeLessThan(20.2);
    expect(deviation).toBeGreaterThan(19.7);
    expect(deviation).toBeLessThan(20.3);
  });

  it('lognormal has the requested mean and coefficient of variation', () => {
    const sample = makeSampler({ kind: 'lognormal', mean: 50, cv: 0.5 });
    const rng = new RandomStream(3, 'lognormal');
    const n = 400_000;
    let sum = 0;
    let squares = 0;
    for (let i = 0; i < n; i++) {
      const x = sample(rng);
      sum += x;
      squares += x * x;
    }
    const mean = sum / n;
    const cv = Math.sqrt(squares / n - mean * mean) / mean;
    expect(mean).toBeGreaterThan(49.5);
    expect(mean).toBeLessThan(50.5);
    expect(cv).toBeGreaterThan(0.49);
    expect(cv).toBeLessThan(0.51);
  });

  it('const always returns the mean', () => {
    const sample = makeSampler({ kind: 'const', mean: 7 });
    const rng = new RandomStream(3, 'const');
    for (let i = 0; i < 10; i++) expect(sample(rng)).toBe(7);
  });
});

describe('EventQueue', () => {
  it('returns events in time order, and in push order within one instant', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 50 }), { maxLength: 3000 }), (times) => {
        const queue = new EventQueue(4);
        times.forEach((time, i) => {
          queue.push(time, i % 7, i, 0, 0);
        });
        const expected = times.map((time, i) => ({ time, i })).sort((x, y) => x.time - y.time || x.i - y.i);
        for (const want of expected) {
          expect(queue.peekTime()).toBe(want.time);
          queue.pop();
          expect(queue.poppedTime).toBe(want.time);
          expect(queue.poppedA).toBe(want.i);
          expect(queue.poppedKind).toBe(want.i % 7);
        }
        expect(queue.size).toBe(0);
        expect(queue.peekTime()).toBe(Infinity);
      }),
    );
  });

  it('stays ordered when pushes and pops are interleaved', () => {
    // null pops; a number pushes an event at that time.
    const op = fc.option(fc.double({ min: 0, max: 1000, noNaN: true }), { nil: null });
    fc.assert(
      fc.property(fc.array(op, { maxLength: 2000 }), (ops) => {
        const queue = new EventQueue(2);
        const pending: number[] = [];
        let last = -Infinity;
        for (const op of ops) {
          if (op === null) {
            if (pending.length === 0) continue;
            queue.pop();
            pending.sort((x, y) => x - y);
            expect(queue.poppedTime).toBe(pending.shift());
            last = queue.poppedTime;
          } else {
            // A simulation never schedules into the past.
            const time = Math.max(op, last);
            queue.push(time, 0, 0, 0, 0);
            pending.push(time);
          }
        }
        expect(queue.size).toBe(pending.length);
      }),
    );
  });

  it('carries every field of an event', () => {
    const queue = new EventQueue();
    queue.push(5, 3, 11, -22, 33);
    queue.pop();
    expect([queue.poppedTime, queue.poppedKind, queue.poppedA, queue.poppedB, queue.poppedC]).toEqual([5, 3, 11, -22, 33]);
  });
});

describe('IntRing', () => {
  it('is first-in-first-out across growth and wrap-around', () => {
    fc.assert(
      fc.property(fc.array(fc.option(fc.integer(), { nil: null }), { maxLength: 500 }), (ops) => {
        const ring = new IntRing(2);
        const model: number[] = [];
        for (const op of ops) {
          if (op === null) {
            if (model.length > 0) expect(ring.shift()).toBe(model.shift());
          } else {
            ring.push(op);
            model.push(op);
          }
          expect(ring.length).toBe(model.length);
        }
      }),
    );
  });
});

describe('Histogram', () => {
  it('reports quantiles within 0.8% of the true value', () => {
    const histogram = new Histogram();
    const values: number[] = [];
    const rng = new RandomStream(5, 'histogram');
    for (let i = 0; i < 200_000; i++) {
      const ms = exponential(rng, 40);
      values.push(ms);
      histogram.record(ms);
    }
    values.sort((x, y) => x - y);
    for (const q of [0.01, 0.1, 0.5, 0.9, 0.99, 0.999]) {
      const exact = values[Math.ceil(q * values.length) - 1]!;
      // Recording rounds to a whole microsecond before bucketing.
      expect(Math.abs(histogram.quantile(q) - exact)).toBeLessThan(exact * 0.008 + 0.001);
    }
    expect(histogram.quantile(1)).toBe(values[values.length - 1]);
  });

  it('tracks the count, mean, minimum and maximum exactly', () => {
    const histogram = new Histogram();
    for (const ms of [3, 1, 4, 1, 5, 9, 2, 6]) histogram.record(ms);
    expect(histogram.count).toBe(8);
    expect(histogram.mean()).toBe(31 / 8);
    expect(histogram.min()).toBe(1);
    expect(histogram.max()).toBe(9);
  });

  it('is exact for whole microseconds below 64', () => {
    const histogram = new Histogram();
    for (let micros = 0; micros < 64; micros++) histogram.record(micros / 1000);
    expect(histogram.quantile(0.5)).toBeCloseTo(0.031, 12);
    expect(histogram.quantile(1 / 64)).toBe(0);
  });

  it('is empty after a reset and tolerates out-of-range values', () => {
    const histogram = new Histogram();
    histogram.record(-5);
    histogram.record(1e12);
    expect(histogram.count).toBe(2);
    expect(histogram.quantile(0.99)).toBeGreaterThan(2_000_000);
    histogram.reset();
    expect(histogram.count).toBe(0);
    expect(histogram.mean()).toBe(0);
    expect(histogram.quantile(0.5)).toBe(0);
    expect(histogram.max()).toBe(0);
  });
});
