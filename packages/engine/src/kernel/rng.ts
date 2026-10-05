/** 32-bit FNV-1a hash of a string. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The murmur3 finalizer: spreads every input bit over the whole word. */
function scramble(value: number): number {
  let h = value | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

const TWO_NEG_32 = 2.3283064365386963e-10;

/**
 * One seeded random stream (sfc32).
 *
 * A stream is identified by the run's seed plus a key, and every node draws from its own streams
 * (`<node id>/arrivals`, `<node id>/service`, ...). That keeps the randomness of one node
 * independent of every other: adding a cache to a design does not change the arrival times of its
 * clients, so two designs can be compared on the same traffic.
 */
export class RandomStream {
  private a: number;
  private b: number;
  private c: number;
  private d = 1;

  constructor(seed: number, key: string) {
    const h = hashString(key);
    this.a = scramble(seed);
    this.b = scramble(h ^ 0x9e3779b9);
    this.c = scramble((seed + Math.imul(h, 0x85ebca6b)) | 0);
    // sfc32 needs a few rounds before its output is well mixed.
    for (let i = 0; i < 15; i++) this.nextU32();
  }

  /** A uniform integer in [0, 2^32). */
  nextU32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** A uniform number in [0, 1). */
  next(): number {
    return this.nextU32() * TWO_NEG_32;
  }

  /** A uniform integer in [0, n). */
  below(n: number): number {
    return Math.floor(this.next() * n);
  }
}
