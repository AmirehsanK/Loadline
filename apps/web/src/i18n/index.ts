import { en } from './en.ts';
import type { Messages } from './en.ts';

export type { Messages };

/** The catalog for the current language. English is the only one so far. */
export function useMessages(): Messages {
  return en;
}
