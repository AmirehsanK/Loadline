/**
 * The pending events of a simulation, ordered by time.
 *
 * A binary heap kept as parallel typed arrays rather than as an array of objects: a run schedules
 * millions of events a second, and events with long delays (timeouts) would otherwise survive into
 * the old generation and turn into garbage-collection pauses.
 *
 * Events at the same instant come out in the order they were pushed. That tie-break is part of the
 * engine's determinism, not a convenience.
 */
export class EventQueue {
  private time: Float64Array;
  private seq: Float64Array;
  private kind: Int32Array;
  private a: Int32Array;
  private b: Int32Array;
  private c: Int32Array;
  private count = 0;
  private nextSeq = 0;

  // The event most recently removed by pop(). Fields instead of a returned object, to avoid an
  // allocation per event.
  poppedTime = 0;
  poppedKind = 0;
  poppedA = 0;
  poppedB = 0;
  poppedC = 0;

  constructor(capacity = 1024) {
    this.time = new Float64Array(capacity);
    this.seq = new Float64Array(capacity);
    this.kind = new Int32Array(capacity);
    this.a = new Int32Array(capacity);
    this.b = new Int32Array(capacity);
    this.c = new Int32Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  /** Time of the earliest event, or Infinity when there is none. */
  peekTime(): number {
    return this.count === 0 ? Infinity : this.time[0]!;
  }

  push(time: number, kind: number, a: number, b: number, c: number): void {
    if (this.count === this.time.length) this.grow();
    const seq = this.nextSeq++;
    const times = this.time;
    const seqs = this.seq;

    // Sift up, moving parents down into the hole instead of swapping.
    let i = this.count++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const pt = times[parent]!;
      if (pt < time || (pt === time && seqs[parent]! < seq)) break;
      this.move(parent, i);
      i = parent;
    }
    times[i] = time;
    seqs[i] = seq;
    this.kind[i] = kind;
    this.a[i] = a;
    this.b[i] = b;
    this.c[i] = c;
  }

  /** Removes the earliest event into the `popped*` fields. The queue must not be empty. */
  pop(): void {
    const times = this.time;
    const seqs = this.seq;
    this.poppedTime = times[0]!;
    this.poppedKind = this.kind[0]!;
    this.poppedA = this.a[0]!;
    this.poppedB = this.b[0]!;
    this.poppedC = this.c[0]!;

    const last = --this.count;
    if (last === 0) return;

    // Re-insert the last element from the root, moving the smaller child up into the hole.
    const time = times[last]!;
    const seq = seqs[last]!;
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= last) break;
      const right = child + 1;
      if (right < last) {
        const ct = times[child]!;
        const rt = times[right]!;
        if (rt < ct || (rt === ct && seqs[right]! < seqs[child]!)) child = right;
      }
      const ct = times[child]!;
      if (time < ct || (time === ct && seq < seqs[child]!)) break;
      this.move(child, i);
      i = child;
    }
    times[i] = time;
    seqs[i] = seq;
    this.kind[i] = this.kind[last]!;
    this.a[i] = this.a[last]!;
    this.b[i] = this.b[last]!;
    this.c[i] = this.c[last]!;
  }

  private move(from: number, to: number): void {
    this.time[to] = this.time[from]!;
    this.seq[to] = this.seq[from]!;
    this.kind[to] = this.kind[from]!;
    this.a[to] = this.a[from]!;
    this.b[to] = this.b[from]!;
    this.c[to] = this.c[from]!;
  }

  private grow(): void {
    const capacity = this.time.length * 2;
    const time = new Float64Array(capacity);
    const seq = new Float64Array(capacity);
    const kind = new Int32Array(capacity);
    const a = new Int32Array(capacity);
    const b = new Int32Array(capacity);
    const c = new Int32Array(capacity);
    time.set(this.time);
    seq.set(this.seq);
    kind.set(this.kind);
    a.set(this.a);
    b.set(this.b);
    c.set(this.c);
    this.time = time;
    this.seq = seq;
    this.kind = kind;
    this.a = a;
    this.b = b;
    this.c = c;
  }
}
