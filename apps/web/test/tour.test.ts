import { beforeEach, describe, expect, it, vi } from 'vitest';

const stored = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
});

/** The tour as a visitor arriving now would find it. */
async function arrive() {
  vi.resetModules();
  const { TOUR_KEY, TOUR_STOPS, useTour } = await import('../src/tour/state.ts');
  return { TOUR_KEY, TOUR_STOPS, tour: () => useTour.getState() };
}

beforeEach(() => {
  stored.clear();
});

describe('the tour', () => {
  it('is offered to a first visit, and does not start by itself', async () => {
    const { tour } = await arrive();
    expect(tour().offered).toBe(true);
    expect(tour().at).toBeNull();
  });

  it('is not offered again once it has been turned down', async () => {
    const first = await arrive();
    first.tour().end();
    expect(first.tour().offered).toBe(false);
    expect(stored.has(first.TOUR_KEY)).toBe(true);
    expect((await arrive()).tour().offered).toBe(false);
  });

  it('goes from stop to stop, back as well as on, and is over after the last', async () => {
    const { TOUR_STOPS, tour } = await arrive();
    tour().start();
    expect(tour().offered).toBe(false);
    expect(tour().at).toBe(0);
    tour().move(1);
    tour().move(1);
    tour().move(-1);
    expect(tour().at).toBe(1);
    for (let stop = 1; stop < TOUR_STOPS.length; stop++) tour().move(1);
    expect(tour().at).toBeNull();
    // Taken once, it is not offered on the next visit either.
    expect((await arrive()).tour().offered).toBe(false);
  });

  it('can be started again by asking, after it has been seen', async () => {
    const { tour } = await arrive();
    tour().end();
    tour().start();
    expect(tour().at).toBe(0);
    tour().move(-1);
    expect(tour().at).toBeNull();
  });

  it('is not offered at all where nothing can be remembered', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('no storage');
      },
      setItem: () => {
        throw new Error('no storage');
      },
    });
    const { tour } = await arrive();
    expect(tour().offered).toBe(false);
    tour().start();
    expect(tour().at).toBe(0);
  });
});
