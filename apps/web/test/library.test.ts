import { designSchema } from '@loadline/engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STARTER } from '../src/design/model.ts';

const stored = new Map<string, string>();
let full = false;
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (full) throw new Error('quota');
    stored.set(key, value);
  },
  removeItem: (key: string) => void stored.delete(key),
});
const { LIBRARY_KEY, LIBRARY_LIMIT, readLibrary, removeDesign, saveDesign } = await import('../src/design/library.ts');

const design = designSchema.parse(STARTER);
const document = { design, seed: 7 };

beforeEach(() => {
  stored.clear();
  full = false;
});

describe('the saved designs', () => {
  it('are kept under a name with what they came with, newest first', () => {
    saveDesign('first', document, 1000);
    saveDesign('  second   one ', { design }, 2000);
    const list = readLibrary();
    expect(list.map((saved) => saved.name)).toEqual(['second one', 'first']);
    expect(list[1]!.document).toEqual(document);
    expect(list[0]!.document).toEqual({ design });
  });

  it('keep one design to a name: saving under it again replaces what was there', () => {
    saveDesign('mine', { design, seed: 1 }, 1000);
    saveDesign('mine', { design, seed: 2 }, 2000);
    expect(readLibrary().map((saved) => [saved.name, saved.document.seed, saved.savedAt])).toEqual([['mine', 2, 2000]]);
  });

  it('refuse a name with nothing in it, one more than they have room for, and say so when storage will not take it', () => {
    expect(saveDesign('   ', document, 1)).toBeNull();
    for (let n = 0; n < LIBRARY_LIMIT; n++) expect(saveDesign(`design ${n}`, document, n + 1)).not.toBeNull();
    expect(saveDesign('one too many', document, 999)).toBeNull();
    // A name that is already there can still be saved over.
    expect(saveDesign('design 3', document, 1000)).toHaveLength(LIBRARY_LIMIT);

    stored.clear();
    full = true;
    expect(saveDesign('no room', document, 1)).toBeNull();
  });

  it('can be let go one at a time', () => {
    saveDesign('a', document, 1000);
    saveDesign('b', document, 2000);
    const [b] = readLibrary();
    expect(removeDesign(b!.id).map((saved) => saved.name)).toEqual(['a']);
    expect(readLibrary().map((saved) => saved.name)).toEqual(['a']);
  });

  it('are read back as input: what is not a design that can be opened is left out', () => {
    const good = { id: 'ok', name: 'good', savedAt: 5, document };
    const looping = { ...design, edges: [...design.edges, { id: 'back', from: 'store', to: 'api' }] };
    stored.set(
      LIBRARY_KEY,
      JSON.stringify([
        good,
        { ...good, id: 'ok' },
        { id: 'a', name: 'no document', savedAt: 1 },
        { id: 'b', name: 'not a design', savedAt: 1, document: { design: { nodes: 'no' } } },
        { id: 'c', name: 'a loop the engine refuses', savedAt: 1, document: { design: looping } },
        { id: 'd', name: '', savedAt: 1, document },
        { id: 'e', name: 'no time', savedAt: 'yesterday', document },
        'text',
        null,
      ]),
    );
    expect(readLibrary().map((saved) => saved.id)).toEqual(['ok']);

    stored.set(LIBRARY_KEY, '{not json');
    expect(readLibrary()).toEqual([]);
    stored.set(LIBRARY_KEY, '{"a":1}');
    expect(readLibrary()).toEqual([]);
  });
});
