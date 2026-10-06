import { lintDesign } from '@loadline/engine';
import type { Design, Issue, Workload } from '@loadline/engine';
import { shareSchema } from '@loadline/share';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

// Reading a design from a file or from an agent. Either is input: it is checked against the
// schema and the engine's own rules before anything is run, and what is wrong is said in words.

/** A design and what goes with it. The same document the web app exports and a link carries. */
export interface Document {
  design: Design;
  seed?: number;
  /** The id of the level the design is an answer to. */
  level?: string;
  workload?: Workload;
}

export type Read =
  | { ok: true; document: Document; issues: Issue[] }
  /** `problems` says what is wrong with the text itself; `issues` what is wrong with the design. */
  | { ok: false; problems: string[]; issues: Issue[] };

/**
 * Checks something that claims to be a design: a document with a `design` in it, or a bare design.
 * It is `ok` when the design can run. Warnings come back with it either way.
 */
export function readDocument(value: unknown): Read {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, problems: ['Expected a design: an object with "nodes" and "edges", or a document with a "design".'], issues: [] };
  }
  const parsed = shareSchema.safeParse('nodes' in value || 'edges' in value ? { design: value } : value);
  if (!parsed.success) {
    return { ok: false, problems: z.prettifyError(parsed.error).split('\n').filter((line) => line.trim() !== ''), issues: [] };
  }
  const { design, seed, level, workload } = parsed.data;
  const issues = lintDesign(design);
  const errors = issues.filter((issue) => issue.level === 'error');
  if (errors.length > 0) return { ok: false, problems: errors.map((issue) => issue.message), issues };
  return {
    ok: true,
    document: { design, ...(seed === undefined ? {} : { seed }), ...(level === undefined ? {} : { level }), ...(workload === undefined ? {} : { workload }) },
    issues,
  };
}

/** Reads a design from the text of a file. YAML is a superset of JSON, so one parser reads both. */
export function readText(text: string): Read {
  let value: unknown;
  try {
    value = parseYaml(text);
  } catch (error) {
    return { ok: false, problems: [`Not valid JSON or YAML: ${error instanceof Error ? error.message.split('\n')[0]! : String(error)}`], issues: [] };
  }
  return readDocument(value);
}
