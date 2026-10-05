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

/**
 * The same queue for numbers that are not small integers, such as times. Kept as a separate class
 * rather than a shared generic one so that each stays fast on its own kind of array.
 */
export class FloatRing {
  private buffer: Float64Array;
  private head = 0;
  private count = 0;

  constructor(capacity = 16) {
    this.buffer = new Float64Array(capacity);
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
    const next = new Float64Array(this.buffer.length * 2);
    for (let i = 0; i < this.count; i++) next[i] = this.buffer[(this.head + i) % this.buffer.length]!;
    this.buffer = next;
    this.head = 0;
  }
}
