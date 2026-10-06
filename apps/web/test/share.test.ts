import { designSchema, workloadSchema } from '@loadline/engine';
import { findLevel } from '@loadline/scenarios';
import { decodeShare } from '@loadline/share';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STARTER } from '../src/design/model.ts';
import { HOME, hrefOf, parseRoute } from '../src/route.ts';
import { exportName, exportText, shareLinks, shareOf } from '../src/share/links.ts';
import { DEFAULT_SEED } from '../src/sim/protocol.ts';
import { Runner } from '../src/sim/runner.ts';

// The store reads and writes the browser's storage, so it gets one made of a map, and is loaded
// after that is in place.
const saved = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => saved.get(key) ?? null,
  setItem: (key: string, value: string) => void saved.set(key, value),
  removeItem: (key: string) => void saved.delete(key),
});
const { SANDBOX_SLOT, currentDesign, levelSlot, readDocument, useDesign } = await import('../src/design/store.ts');

const starter = designSchema.parse(STARTER);
const surge = workloadSchema.parse({
  phases: [{ atMs: 2000, multiplier: 3 }],
  chaos: [{ atMs: 5000, command: { type: 'kill', nodeId: 'store', durationMs: 4000 } }],
});
const store = () => useDesign.getState();

beforeEach(() => {
  vi.useFakeTimers();
  store().open(SANDBOX_SLOT, starter, null);
  saved.clear();
  store().open(SANDBOX_SLOT, starter, null);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the address of a shared design', () => {
  it('is read from the fragment and written back the same', () => {
    expect(parseRoute('#/d/v1.abc-DEF_123')).toEqual({ page: 'shared', payload: 'v1.abc-DEF_123' });
    expect(hrefOf({ page: 'shared', payload: 'v1.abc-DEF_123' })).toBe('#/d/v1.abc-DEF_123');
    expect(parseRoute('#/d')).toEqual(HOME);
    expect(parseRoute('#/d/a/b')).toEqual(HOME);
  });
});

describe('what a design is shared as', () => {
  it('is the design and the seed it ran with, in the sandbox', () => {
    expect(shareOf({ design: starter }, null)).toEqual({ design: starter, seed: DEFAULT_SEED });
    expect(shareOf({ design: starter, seed: 7, workload: surge }, null)).toEqual({ design: starter, seed: 7, workload: surge });
  });

  it('is the design and the level, in a level: the traffic and the seed are the level’s own', () => {
    expect(shareOf({ design: starter, seed: 7, workload: surge }, 'stampede')).toEqual({ design: starter, level: 'stampede' });
  });
});

describe('the link and the embed snippet', () => {
  const at = (pathname: string) => ({ origin: 'https://example.github.io', pathname });

  it('point at the app wherever it is served from', async () => {
    for (const pathname of ['/Loadline/', '/Loadline/index.html']) {
      const { link, embed } = await shareLinks({ design: starter, seed: 1 }, at(pathname), 'A design');
      expect(link).toMatch(/^https:\/\/example\.github\.io\/Loadline\/#\/d\/v1\.[A-Za-z0-9_-]+$/);
      expect(embed).toMatch(/^<iframe src="https:\/\/example\.github\.io\/Loadline\/embed\.html#v1\.[A-Za-z0-9_-]+" title="A design" /);
    }
    expect((await shareLinks({ design: starter }, at('/'), 'x')).link).toMatch(/^https:\/\/example\.github\.io\/#\/d\/v1\./);
  });

  it('carry the design that was shared', async () => {
    const share = { design: starter, seed: 42, workload: surge };
    const { link, embed } = await shareLinks(share, at('/'), 'x');
    const route = parseRoute(link.slice(link.indexOf('#')));
    expect(route.page).toBe('shared');
    expect(await decodeShare(route.page === 'shared' ? route.payload : '')).toEqual(share);
    expect(await decodeShare(/#(v1\.[^"]+)"/.exec(embed)![1]!)).toEqual(share);
  });

  it('keep a title from breaking out of the snippet', async () => {
    const { embed } = await shareLinks({ design: starter }, at('/'), 'A "quoted" <b>title</b> & more');
    expect(embed).toContain('title="A &quot;quoted&quot; &lt;b>title&lt;/b> &amp; more"');
  });
});

describe('a design as a file', () => {
  it('is named after the design', () => {
    expect(exportName('Black Friday')).toBe('black-friday.loadline.json');
    expect(exportName('  Über-cache / v2!  ')).toBe('ber-cache-v2.loadline.json');
    expect(exportName('')).toBe('design.loadline.json');
    expect(exportName('../../etc/passwd')).toBe('etc-passwd.loadline.json');
  });

  it('reads back as what was exported', () => {
    const document = { design: starter, seed: 9, workload: surge };
    expect(readDocument(exportText(document))).toEqual(document);
  });

  it('may be a bare design, as earlier versions saved', () => {
    expect(readDocument(JSON.stringify(starter))).toEqual({ design: starter });
    expect(readDocument(JSON.stringify(STARTER))).toEqual({ design: starter });
  });

  it('is refused when it is not a design that can run', () => {
    expect(readDocument('not json')).toBeNull();
    expect(readDocument('null')).toBeNull();
    expect(readDocument('[]')).toBeNull();
    expect(readDocument('{"design":{"nodes":[{"id":"u","type":"client","params":{"rps":-5}}]}}')).toBeNull();
    // A connection to a part that is not there.
    expect(readDocument('{"nodes":[{"id":"a","type":"service"}],"edges":[{"id":"e","from":"a","to":"b"}]}')).toBeNull();
  });
});

describe('taking on a document', () => {
  it('replaces the design in the sandbox, with its traffic and seed, and can be undone', () => {
    const other = findLevel('the-bill')!.reference;
    expect(store().adopt({ design: other, seed: 5, workload: surge })).toBe(true);
    expect(currentDesign(store())!.nodes).toEqual(other.nodes);
    expect(store()).toMatchObject({ seed: 5, workload: surge });
    store().undo();
    expect(currentDesign(store())!.nodes).toEqual(starter.nodes);
  });

  it('takes only the design in a level, and only one that keeps the level’s rules', () => {
    const level = findLevel('first-traffic')!;
    store().open(levelSlot(level.id), level.starter, level);
    expect(store().adopt({ design: level.reference, seed: 5, workload: surge })).toBe(true);
    expect(currentDesign(store())!.nodes).toEqual(level.reference.nodes);
    expect(store()).toMatchObject({ seed: null, workload: null });

    // A design from another level changes what this one has fixed.
    expect(store().adopt({ design: findLevel('the-bill')!.reference })).toBe(false);
    expect(currentDesign(store())!.nodes).toEqual(level.reference.nodes);
  });
});

describe('a design that is only being looked at', () => {
  it('is not read from storage and is never saved', () => {
    saved.set('loadline:shared', JSON.stringify(findLevel('the-bill')!.reference));
    store().open('loadline:shared', starter, null, { seed: 3, workload: surge, transient: true });
    expect(currentDesign(store())!.nodes).toEqual(starter.nodes);
    expect(store()).toMatchObject({ seed: 3, workload: surge, transient: true });

    saved.clear();
    store().renameNode('api', 'Edited');
    vi.advanceTimersByTime(5000);
    store().open(SANDBOX_SLOT, starter, null);
    expect(saved.size).toBe(0);
  });

  it('becomes the visitor’s own when it is saved under their key', () => {
    store().open('loadline:shared', findLevel('the-bill')!.reference, null, { seed: 3, transient: true });
    store().saveAs(SANDBOX_SLOT);
    store().open(SANDBOX_SLOT, starter, null);
    expect(currentDesign(store())!.nodes).toEqual(findLevel('the-bill')!.reference.nodes);
    expect(store()).toMatchObject({ seed: 3, transient: false });
  });

  it('keeps the traffic it came with across a reload, and can let go of it', () => {
    store().adopt({ design: starter, workload: surge });
    vi.advanceTimersByTime(1000);
    store().open(SANDBOX_SLOT, starter, null);
    expect(store().workload).toEqual(surge);
    store().dropWorkload();
    vi.advanceTimersByTime(1000);
    store().open(SANDBOX_SLOT, starter, null);
    expect(store().workload).toBeNull();
  });
});

describe('a run of a design that came with traffic of its own', () => {
  it('follows that traffic, and ignores the traffic control', () => {
    vi.useRealTimers();
    const runner = new Runner();
    let now = 1000;
    const clock = () => now;
    runner.load(1, starter, 7, 0.5, null, surge);
    runner.play(now);
    runner.setSpeed(10);
    const stepTo = (seconds: number) => {
      while (runner.frame(now).now < seconds * 1000) {
        now += 100;
        runner.step(now, 1000, clock);
      }
      return runner.frame(now);
    };
    expect(stepTo(1).traffic).toBe(1);
    expect(stepTo(3).traffic).toBe(3);
    expect(stepTo(6).gauges[2]).toMatchObject({ instances: 0 });
    expect(stepTo(10).gauges[2]).toMatchObject({ instances: 1 });
    expect(runner.frame(now)).toMatchObject({ level: null, playing: true });
  });
});
