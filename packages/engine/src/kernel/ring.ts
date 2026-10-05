/** A growable first-in-first-out queue of integers. The caller enforces any limit on its length. */
export class IntRing {
  private buffer: Int32Array;
  private head = 0;
  private count = 0;

  constructor(capacity = 16) {
    this.buffer = new Int32Array(capacity);
  }

  get length(): number {
    return this.count;
  }

  push(value: number): void {
    if (this.count === this.buffer.length) this.grow();
    this.buffer[(this.head + this.count) % this.buffer.length] = value;
    this.count++;
  }

  /** Removes and returns the oldest value. The ring must not be empty. */
  shift(): number {
    const value = this.buffer[this.head]!;
    this.head = (this.head + 1) % this.buffer.length;
    this.count--;
    return value;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  private grow(): void {
    const next = new Int32Array(this.buffer.length * 2);
    for (let i = 0; i < this.count; i++) next[i] = this.buffer[(this.head + i) % this.buffer.length]!;
    this.buffer = next;
    this.head = 0;
  }
}
