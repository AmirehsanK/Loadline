/**
 * A set of numbered items, each with a tag, from which the one with the smallest tag can be taken.
 * Items with equal tags come out in the order they went in, which keeps a run deterministic.
 *
 * A database uses one per server, to know which of the queries sharing its cores finishes next.
 */
export class TagHeap {
  private tags: Float64Array;
  private order: Float64Array;
  private items: Int32Array;
  private count = 0;
  private pushed = 0;

  constructor(capacity = 16) {
    this.tags = new Float64Array(capacity);
    this.order = new Float64Array(capacity);
    this.items = new Int32Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  /** The smallest tag. The heap must not be empty. */
  minTag(): number {
    return this.tags[0]!;
  }

  /** The item with the smallest tag. The heap must not be empty. */
  minItem(): number {
    return this.items[0]!;
  }

  push(tag: number, item: number): void {
    if (this.count === this.tags.length) this.grow();
    const order = this.pushed++;
    let i = this.count++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const parentTag = this.tags[parent]!;
      if (parentTag < tag || (parentTag === tag && this.order[parent]! < order)) break;
      this.move(parent, i);
      i = parent;
    }
    this.tags[i] = tag;
    this.order[i] = order;
    this.items[i] = item;
  }

  /** Removes the item with the smallest tag. The heap must not be empty. */
  pop(): void {
    const last = --this.count;
    if (last === 0) return;
    const tag = this.tags[last]!;
    const order = this.order[last]!;
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= last) break;
      const right = child + 1;
      if (right < last && this.before(right, child)) child = right;
      const childTag = this.tags[child]!;
      if (tag < childTag || (tag === childTag && order < this.order[child]!)) break;
      this.move(child, i);
      i = child;
    }
    this.tags[i] = tag;
    this.order[i] = order;
    this.items[i] = this.items[last]!;
  }

  clear(): void {
    this.count = 0;
  }

  private before(a: number, b: number): boolean {
    const ta = this.tags[a]!;
    const tb = this.tags[b]!;
    return ta < tb || (ta === tb && this.order[a]! < this.order[b]!);
  }

  private move(from: number, to: number): void {
    this.tags[to] = this.tags[from]!;
    this.order[to] = this.order[from]!;
    this.items[to] = this.items[from]!;
  }

  private grow(): void {
    const capacity = this.tags.length * 2;
    const tags = new Float64Array(capacity);
    const order = new Float64Array(capacity);
    const items = new Int32Array(capacity);
    tags.set(this.tags);
    order.set(this.order);
    items.set(this.items);
    this.tags = tags;
    this.order = order;
    this.items = items;
  }
}
