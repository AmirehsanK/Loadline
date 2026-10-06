import type { Scenario, ScenarioText } from '@loadline/scenarios';
import { en } from './en.ts';
import type { Messages } from './en.ts';
import { fa } from './fa.ts';
import { levelsFa } from './levels.fa.ts';
import { useLocale } from './locale.ts';
import type { Locale } from './locale.ts';

export type { Messages };

export const CATALOGS: Record<Locale, Messages> = { en, fa };

/** The catalog for the language the interface is in. */
export function useMessages(): Messages {
  return CATALOGS[useLocale((state) => state.locale)];
}

/**
 * The words of a level in the language the interface is in. A level carries its own English,
 * which the command line and the MCP server use too; other languages are looked up by its id, and
 * a level that has not been translated yet is shown in English.
 */
export function useLevelText(level: Scenario): ScenarioText {
  const locale = useLocale((state) => state.locale);
  return (locale === 'fa' ? levelsFa[level.id] : undefined) ?? level.text;
}
