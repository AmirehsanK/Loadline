import { pow } from './detmath.ts';

/**
 * Picks keys so that a few are asked for constantly and most hardly ever: key `i` (counting from
 * 1) is chosen in proportion to `1 / i^skew`. Real traffic is shaped like this, and it is why a
 * small cache can answer most requests. A skew of 0 makes every key equally likely.
 */
export class ZipfTable {
  // cumulative[i] is the probability of picking key i or lower.
  private readonly cumulative: Float64Array;

  constructor(keys: number, skew: number) {
    const cumulative = new Float64Array(keys);
    let total = 0;
    for (let i = 0; i < keys; i++) {
      total += pow(i + 1, -skew);
      cumulative[i] = total;
    }
    for (let i = 0; i < keys; i++) cumulative[i] = cumulative[i]! / total;
    this.cumulative = cumulative;
  }

  /** The key for a uniform number `u` in [0, 1). Keys are numbered from 0, most popular first. */
  pick(u: number): number {
    const cumulative = this.cumulative;
    let low = 0;
    let high = cumulative.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (cumulative[middle]! > u) high = middle;
      else low = middle + 1;
    }
    return low;
  }
}
