import { create } from 'zustand';

// What the visitor has achieved, kept in this browser. There are no accounts.

const STORAGE_KEY = 'loadline:progress:v1';

export type Stars = 0 | 1 | 2 | 3;

interface ProgressState {
  /** The most stars earned on each level, by its id. A level that has not been passed is absent. */
  stars: Record<string, Stars>;
  /** Notes a result. Only a better one than before changes anything. */
  record: (levelId: string, stars: Stars) => void;
}

/** What was saved by an earlier visit, keeping only what still has the right shape. */
export function readProgress(stored: string | null): Record<string, Stars> {
  if (stored === null) return {};
  try {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const stars: Record<string, Stars> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === 1 || value === 2 || value === 3) stars[id] = value;
    }
    return stars;
  } catch {
    return {};
  }
}

function load(): Record<string, Stars> {
  try {
    return readProgress(localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

export const useProgress = create<ProgressState>((set, get) => ({
  stars: load(),
  record: (levelId, stars) => {
    if (stars <= (get().stars[levelId] ?? 0)) return;
    const next = { ...get().stars, [levelId]: stars };
    set({ stars: next });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // A full or disabled store costs the visitor their saved progress, not this session's.
    }
  },
}));
