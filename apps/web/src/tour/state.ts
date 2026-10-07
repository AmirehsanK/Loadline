import { create } from 'zustand';

// A short walk round the workbench for someone who has not seen it before. It is offered once, in
// a corner where it is in nobody's way, and never starts by itself.

export const TOUR_KEY = 'loadline:tour:v1';

/** The stops, in order. Each names the part of the screen it is about. */
export const TOUR_STOPS = ['panel', 'canvas', 'settings', 'run', 'numbers'] as const;
export type TourStop = (typeof TOUR_STOPS)[number];

function seenBefore(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) !== null;
  } catch {
    // With no storage the offer would come back on every visit, so it is not made at all.
    return true;
  }
}

interface TourState {
  /** Whether the offer is on show: nobody has taken it up or turned it down yet. */
  offered: boolean;
  /** Which stop the tour is at, or null when it is not running. */
  at: number | null;
  start: () => void;
  /** Moves on by `by` stops. Past the last one, or before the first, the tour is over. */
  move: (by: number) => void;
  /** Ends the tour, or turns the offer down. Either way it is not offered again. */
  end: () => void;
}

function remember(): void {
  try {
    localStorage.setItem(TOUR_KEY, 'seen');
  } catch {
    // Then it is offered again next time, which is the lesser harm.
  }
}

export const useTour = create<TourState>((set, get) => ({
  offered: !seenBefore(),
  at: null,
  start: () => {
    remember();
    set({ offered: false, at: 0 });
  },
  move: (by) => {
    const { at } = get();
    if (at === null) return;
    const next = at + by;
    set({ at: next < 0 || next >= TOUR_STOPS.length ? null : next });
  },
  end: () => {
    remember();
    set({ offered: false, at: null });
  },
}));
