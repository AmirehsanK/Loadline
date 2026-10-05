import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TagHeap } from '../src/kernel/tagHeap.ts';

describe('TagHeap', () => {
  it('gives back the smallest tag first, and equal tags in the order they went in', () => {
    // null takes the smallest out; a number puts an item in with that tag.
    const op = fc.option(fc.integer({ min: 0, max: 30 }), { nil: null });
    fc.assert(
      fc.property(fc.array(op, { maxLength: 1500 }), (ops) => {
        const heap = new TagHeap(2);
        const model: { tag: number; item: number }[] = [];
        let next = 0;
        for (const tag of ops) {
          if (tag === null) {
            if (model.length === 0) continue;
            // The model keeps insertion order, and a stable sort keeps it among equal tags.
            model.sort((a, b) => a.tag - b.tag);
            const want = model.shift()!;
            expect(heap.minTag()).toBe(want.tag);
            expect(heap.minItem()).toBe(want.item);
            heap.pop();
          } else {
            heap.push(tag, next);
            model.push({ tag, item: next });
            next++;
          }
          expect(heap.size).toBe(model.length);
        }
      }),
    );
  });

  it('is empty after clear', () => {
    const heap = new TagHeap();
    heap.push(3, 1);
    heap.push(1, 2);
    heap.clear();
    expect(heap.size).toBe(0);
    heap.push(9, 7);
    expect([heap.minTag(), heap.minItem()]).toEqual([9, 7]);
  });
});
