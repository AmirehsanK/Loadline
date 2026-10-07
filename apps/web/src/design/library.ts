import { readDocument } from './store.ts';
import type { Document } from './store.ts';

// Designs a visitor has put aside under a name. Like everything else here they live in this
// browser and nowhere else, and like everything read back from storage they are treated as input:
// each is checked as a file would be before it is listed, and one that fails is left out.

export const LIBRARY_KEY = 'loadline:designs:v1';
/** As many as are kept. A design is a few kilobytes, and storage is not ours to fill. */
export const LIBRARY_LIMIT = 50;
const NAME_LIMIT = 80;

export interface SavedDesign {
  id: string;
  name: string;
  /** When it was saved, in milliseconds since the epoch. */
  savedAt: number;
  document: Document;
}

/** A name as it is kept: trimmed, single-spaced and no longer than fits a row. */
export const tidyName = (name: string): string => name.trim().replace(/\s+/g, ' ').slice(0, NAME_LIMIT);

function parse(text: string | null): SavedDesign[] {
  if (text === null) return [];
  let list: unknown;
  try {
    list = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const saved: SavedDesign[] = [];
  for (const entry of list.slice(0, LIBRARY_LIMIT) as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, name, savedAt, document } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string' || typeof savedAt !== 'number' || !Number.isFinite(savedAt)) continue;
    const read = readDocument(JSON.stringify(document));
    if (!read || tidyName(name) === '' || saved.some((other) => other.id === id)) continue;
    saved.push({ id, name: tidyName(name), savedAt, document: read });
  }
  return saved;
}

/** The saved designs, newest first. */
export function readLibrary(): SavedDesign[] {
  try {
    return parse(localStorage.getItem(LIBRARY_KEY)).sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    // Storage can be unavailable.
    return [];
  }
}

function write(list: SavedDesign[]): boolean {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/**
 * Keeps a design under a name, in place of any already kept under that name. Returns the list as
 * it then stands, or null when it could not be kept: the list is full, or storage refused.
 */
export function saveDesign(name: string, document: Document, now: number): SavedDesign[] | null {
  const kept = tidyName(name);
  if (kept === '') return null;
  const others = readLibrary().filter((saved) => saved.name !== kept);
  if (others.length >= LIBRARY_LIMIT) return null;
  const list = [{ id: `d${now.toString(36)}`, name: kept, savedAt: now, document }, ...others];
  return write(list) ? list : null;
}

export function removeDesign(id: string): SavedDesign[] {
  const list = readLibrary().filter((saved) => saved.id !== id);
  write(list);
  return list;
}
