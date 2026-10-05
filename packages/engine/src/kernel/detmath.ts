/**
 * Elementary functions that give the same bits on every JS engine.
 *
 * ECMAScript leaves `Math.log`, `Math.exp` and `Math.pow` implementation-approximated, so V8,
 * SpiderMonkey and JavaScriptCore may disagree in the last bit. One differing bit in a sampled
 * service time is enough to reorder two events, and from there a run diverges. Everything here is
 * built from `+ - * /` and bit manipulation, which IEEE 754 defines exactly.
 *
 * These are accurate to a few units in the last place, not correctly rounded. The simulation needs
 * agreement, not the last digit.
 */

const bits = new DataView(new ArrayBuffer(8));

// ln 2 split in two so that `k * LN2_HI` is exact for every exponent k (the fdlibm constants).
const LN2_HI = 6.93147180369123816490e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.44269504088896338700;
const SQRT2 = 1.4142135623730951;
const TWO_54 = 18014398509481984;

/** 2^k for an integer k in [-1022, 1023], assembled from its bit pattern. */
function pow2(k: number): number {
  bits.setUint32(0, (k + 1023) << 20);
  bits.setUint32(4, 0);
  return bits.getFloat64(0);
}

/** Natural logarithm. */
export function ln(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;

  // Split x into m * 2^k with m in [1, 2).
  let k = 0;
  bits.setFloat64(0, x);
  let hi = bits.getUint32(0);
  if (hi >>> 20 === 0) {
    // Subnormal: scale into the normal range first.
    bits.setFloat64(0, x * TWO_54);
    hi = bits.getUint32(0);
    k = -54;
  }
  k += (hi >>> 20) - 1023;
  bits.setUint32(0, (hi & 0x000fffff) | 0x3ff00000);
  let m = bits.getFloat64(0);
  // Recentre on 1 so the series argument stays small: m in (sqrt(1/2), sqrt(2)].
  if (m > SQRT2) {
    m *= 0.5;
    k += 1;
  }

  // ln(m) = 2 * atanh(s) = 2s * (1 + z/3 + z^2/5 + ...), with s = (m-1)/(m+1) and z = s^2.
  // |s| <= 0.1716, so the first omitted term (z^11 / 23) is below 1e-18.
  const s = (m - 1) / (m + 1);
  const z = s * s;
  let p = 1 / 21;
  p = p * z + 1 / 19;
  p = p * z + 1 / 17;
  p = p * z + 1 / 15;
  p = p * z + 1 / 13;
  p = p * z + 1 / 11;
  p = p * z + 1 / 9;
  p = p * z + 1 / 7;
  p = p * z + 1 / 5;
  p = p * z + 1 / 3;
  p = p * z + 1;
  return k * LN2_HI + (2 * s * p + k * LN2_LO);
}

/** e^x. */
export function exp(x: number): number {
  if (x !== x) return NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019412) return 0;

  // x = k ln 2 + r with |r| <= ln(2)/2, so e^x = 2^k * e^r.
  const k = Math.round(x * INV_LN2);
  const r = x - k * LN2_HI - k * LN2_LO;

  // Taylor series for e^r to degree 13; the first omitted term (r^14 / 14!) is below 1e-17.
  let p = 1 / 6227020800;
  p = p * r + 1 / 479001600;
  p = p * r + 1 / 39916800;
  p = p * r + 1 / 3628800;
  p = p * r + 1 / 362880;
  p = p * r + 1 / 40320;
  p = p * r + 1 / 5040;
  p = p * r + 1 / 720;
  p = p * r + 1 / 120;
  p = p * r + 1 / 24;
  p = p * r + 1 / 6;
  p = p * r + 0.5;
  p = p * r + 1;
  p = p * r + 1;

  // Outside the normal exponent range, apply the scale in two exact steps.
  if (k > 1023) return p * pow2(1023) * pow2(k - 1023);
  if (k < -1022) return p * pow2(-1022) * pow2(k + 1022);
  return p * pow2(k);
}

/** x^y for x >= 0. */
export function pow(x: number, y: number): number {
  if (y === 0) return 1;
  if (x === 0) return y > 0 ? 0 : Infinity;
  return exp(y * ln(x));
}
