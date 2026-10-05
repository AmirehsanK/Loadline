import type { Scenario, ScenarioText } from '@loadline/scenarios';
import { en } from './en.ts';
import type { Messages } from './en.ts';

export type { Messages };

/** The catalog for the current language. English is the only one so far. */
export function useMessages(): Messages {
  return en;
}

/**
 * The words of a level in the current language. A level carries its own English, which the
 * command line and the MCP server use too; other languages will be looked up here by its id.
 */
export function useLevelText(level: Scenario): ScenarioText {
  return level.text;
}
