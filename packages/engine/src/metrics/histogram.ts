// Durations are recorded as whole microseconds. Below 64 µs each value has its own bucket; above
// that, every power of two is split into 64 buckets, so a bucket is never wider than 1/64 of the
// values in it and a reported quantile is within 0.8% of the true one.
const SUB_BITS = 6;
const SUB_COUNT = 1 << SUB_BITS;
const BUCKETS = (31 - SUB_BITS + 1) * SUB_COUNT;
const MAX_MICROS = 0x7fffffff;

/** The value a bucket stands for: its midpoint, in microseconds. */
function bucketValue(index: number): number {
  if (index < SUB_COUNT) return index;
  const shift = (index >> SUB_BITS) - 1;
  const low = (SUB_COUNT + (index & (SUB_COUNT - 1))) << shift;
  return shift === 0 ? low : low + (1 << (shift - 1));
}

/**
 * A latency histogram with a fixed relative precision.
 *
 * Bucketing uses integer operations only, so two engines agree on every bucket. The mean, minimum
 * and maximum are tracked exactly alongside it.
 */
export class Histogram {
  private readonly counts = new Float64Array(BUCKETS);
  private total = 0;
  private sum = 0;
  private low = Infinity;
  private high = 0;

  get count(): number {
    return this.total;
  }

  /**
   * Records one duration in milliseconds. A negative duration counts as zero, and anything above
   * about 35 minutes shares the last bucket.
   */
  record(duration: number): void {
    const ms = duration > 0 ? duration : 0;
    const micros = ms * 1000;
    const v = micros >= MAX_MICROS ? MAX_MICROS : (micros + 0.5) | 0;
    let index = v;
    if (v >= SUB_COUNT) {
      const top = 31 - Math.clz32(v);
      index = ((top - SUB_BITS + 1) << SUB_BITS) + ((v >>> (top - SUB_BITS)) & (SUB_COUNT - 1));
    }
    this.counts[index]!++;
    this.total++;
    this.sum += ms;
    if (ms < this.low) this.low = ms;
    if (ms > this.high) this.high = ms;
  }

  mean(): number {
    return this.total === 0 ? 0 : this.sum / this.total;
  }

  min(): number {
    return this.total === 0 ? 0 : this.low;
  }

  max(): number {
    return this.high;
  }

  /** The value below which a fraction `q` of the recorded durations fall, in milliseconds. */
  quantile(q: number): number {
    if (this.total === 0) return 0;
    if (q >= 1) return this.high;
    const target = Math.max(1, Math.ceil(q * this.total));
    let seen = 0;
    for (let i = 0; i < BUCKETS; i++) {
      seen += this.counts[i]!;
      if (seen >= target) {
        const ms = bucketValue(i) / 1000;
        return ms < this.low ? this.low : ms > this.high ? this.high : ms;
      }
    }
    return this.high;
  }

  reset(): void {
    this.counts.fill(0);
    this.total = 0;
    this.sum = 0;
    this.low = Infinity;
    this.high = 0;
  }
}
