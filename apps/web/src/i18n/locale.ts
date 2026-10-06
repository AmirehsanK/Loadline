import { create } from 'zustand';

// Which language the interface is in. The choice is kept in this browser.

export const LOCALES = ['en', 'fa'] as const;
export type Locale = (typeof LOCALES)[number];

/** The way text runs in each language. The page mirrors with it; the canvas and charts do not. */
export const DIRECTION: Record<Locale, 'ltr' | 'rtl'> = { en: 'ltr', fa: 'rtl' };

const STORAGE_KEY = 'loadline:locale:v1';

/**
 * The language to start in: the one chosen on an earlier visit, or Persian for a browser that
 * asks for Persian first, or English.
 */
export function pickLocale(stored: string | null, preferred: readonly string[]): Locale {
  if (stored === 'en' || stored === 'fa') return stored;
  return preferred[0]?.toLowerCase().startsWith('fa') ? 'fa' : 'en';
}

function initial(): Locale {
  try {
    return pickLocale(localStorage.getItem(STORAGE_KEY), navigator.languages);
  } catch {
    // No storage or no navigator: a test, or a browser that has locked both away.
    return 'en';
  }
}

/** Tells the browser what language the page is in, so it lays it out and reads it aloud as that. */
function mark(locale: Locale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.documentElement.dir = DIRECTION[locale];
}

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocale = create<LocaleState>((set) => ({
  locale: initial(),
  setLocale: (locale) => {
    set({ locale });
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // The choice then lasts for this visit only.
    }
  },
}));

mark(useLocale.getState().locale);
useLocale.subscribe((state) => {
  mark(state.locale);
});
