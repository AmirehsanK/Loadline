import { parseArgs } from 'node:util';
import { DesignError } from '@loadline/engine';
import { LEVELS } from '@loadline/scenarios';
import { ShareError, encodeShare } from '@loadline/share';
import { AssertionSyntaxError, check, parseAssertion } from './assert.ts';
import { readText } from './document.ts';
import type { Document } from './document.ts';
import { describeIssues, describeRun, describeVerdicts } from './format.ts';
import { RunError, simulate } from './run.ts';
import type { Run } from './run.ts';

/** Where the playground is served from. A link made here opens there. */
export const PLAYGROUND_URL = 'https://amirehsank.github.io/Loadline/';

export const USAGE = `Usage: loadline <command> [options]

  validate <file>                  Check a design. Exits 1 if it cannot run.
  simulate <file> [options]        Run a design and print what happened.
  test <file> --assert <cond>...   Run a design and check conditions on the result.
                                   Exits 1 if any fails, so it can gate a build.
  share <file> [--base <url>]      Print a link that opens the design in the playground.
  levels                           List the levels.

A file is JSON or YAML: a design, or a document with a "design" and optionally a
"seed", a "workload" (traffic and faults over time) or the "level" it answers.

Options for simulate and test:
  --duration <time>   How long to simulate: 90s, 2m, or milliseconds. Default 60s.
                      A level has its own length.
  --seed <number>     The seed. The same seed gives the same numbers. Default 2026.
  --level <id>        Run the design against a level and score it.
  --json              Print the result as JSON.
  --assert <cond>     For test. May be repeated. A condition is a metric, a comparison
                      and a number: p99<200ms, errors<=1%, cost<300, stars>=2.
                      Metrics: p50 p95 p99 mean max (ms or s), errors (% or a fraction),
                      cost (dollars a month), sent ok failed (requests), stars (on a level).
                      With --level and no --assert, the condition is that the level is passed.
`;

/** What the command line talks to, so that a test can stand in for the terminal and the disk. */
export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
  readFile: (path: string) => string;
}

/** A mistake in how the command was called, as opposed to a design that failed a check. */
class UsageError extends Error {}

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

/** A length of time as typed: `90s`, `2m`, `1500ms`, or a bare number of milliseconds. */
export function parseDuration(text: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(text.trim());
  if (!match) throw new UsageError(`"${text}" is not a length of time. Use for example 90s, 2m or 30000.`);
  const scale = match[2] === 'm' ? 60_000 : match[2] === 's' ? 1000 : 1;
  return Number(match[1]) * scale;
}

function load(path: string | undefined, io: Io): Document {
  if (path === undefined) throw new UsageError('Which file? Give the path of a design.');
  let text: string;
  try {
    text = io.readFile(path);
  } catch (error) {
    throw new UsageError(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const read = readText(text);
  if (!read.ok) throw new UsageError(`${path} is not a design that can run:\n${read.problems.map((line) => `  ${line}`).join('\n')}`);
  return read.document;
}

interface RunFlags {
  duration?: string;
  seed?: string;
  level?: string;
}

function runWith(document: Document, flags: RunFlags): Run {
  const seed = flags.seed === undefined ? undefined : Number(flags.seed);
  if (seed !== undefined && (!Number.isInteger(seed) || seed < 0)) throw new UsageError(`"${flags.seed ?? ''}" is not a seed. Use a whole number.`);
  return simulate(document, {
    ...(flags.duration === undefined ? {} : { durationMs: parseDuration(flags.duration) }),
    ...(seed === undefined ? {} : { seed }),
    ...(flags.level === undefined ? {} : { level: flags.level }),
  });
}

/** Runs one command. Returns the exit code: 0, 1 for a check that failed, 2 for a command that made no sense. */
export async function cli(argv: string[], io: Io): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        duration: { type: 'string' },
        seed: { type: 'string' },
        level: { type: 'string' },
        base: { type: 'string' },
        assert: { type: 'string', multiple: true },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
    const [command, file] = positionals;
    if (values.help || command === undefined || command === 'help') {
      io.out(USAGE);
      return command === undefined && !values.help ? EXIT_USAGE : EXIT_OK;
    }

    switch (command) {
      case 'validate': {
        if (file === undefined) throw new UsageError('Which file? Give the path of a design.');
        const read = readText(io.readFile(file));
        for (const line of describeIssues(read.issues)) io.out(line);
        if (!read.ok) {
          // Problems with the shape of the file are not in the list of issues with the design.
          if (read.issues.every((issue) => issue.level !== 'error')) for (const line of read.problems) io.out(`error    ${line}`);
          io.out(`${file} cannot run.`);
          return EXIT_FAILED;
        }
        io.out(`${file} can run: ${String(read.document.design.nodes.length)} parts, ${String(read.document.design.edges.length)} connections.`);
        return EXIT_OK;
      }

      case 'simulate': {
        const document = load(file, io);
        const run = runWith(document, values);
        io.out(values.json ? JSON.stringify({ ...run, level: run.level?.outcome }, null, 2) : describeRun(document, run));
        return EXIT_OK;
      }

      case 'test': {
        const document = load(file, io);
        const assertions = (values.assert ?? []).map(parseAssertion);
        const levelId = values.level ?? document.level;
        if (assertions.length === 0 && levelId === undefined) {
          throw new UsageError('Nothing to check. Give at least one --assert, or a --level to pass.');
        }
        const run = runWith(document, values);
        const verdicts = assertions.map((assertion) => check(assertion, run));
        const passedLevel = run.level?.outcome.passed ?? true;
        // With a level and no conditions of its own, the test is the level.
        const levelCounts = assertions.length === 0;
        const ok = verdicts.every((verdict) => verdict.holds) && (!levelCounts || passedLevel);
        if (values.json) {
          io.out(JSON.stringify({ ok, verdicts, level: run.level?.outcome, report: run.report }, null, 2));
        } else {
          if (verdicts.length > 0) io.out(describeVerdicts(verdicts));
          if (run.level) {
            const { scenario, outcome } = run.level;
            io.out(`${levelCounts ? (outcome.passed ? 'pass' : 'FAIL') : 'note'}  level "${scenario.text.title}": ${outcome.passed ? `passed, ${String(outcome.stars)} of 3 stars` : 'not passed'}`);
          }
          if (!run.complete) io.out('note  the run was cut short by the limit on events');
        }
        return ok ? EXIT_OK : EXIT_FAILED;
      }

      case 'share': {
        const document = load(file, io);
        const base = values.base ?? PLAYGROUND_URL;
        io.out(`${base.endsWith('/') ? base : `${base}/`}#/d/${await encodeShare(document)}`);
        return EXIT_OK;
      }

      case 'levels': {
        const width = Math.max(...LEVELS.map((level) => level.id.length));
        LEVELS.forEach((level, index) => {
          io.out(`${String(index + 1).padStart(2)}  ${level.id.padEnd(width)}  ${level.text.title}: ${level.text.summary}`);
        });
        return EXIT_OK;
      }

      default:
        throw new UsageError(`There is no command "${command}".`);
    }
  } catch (error) {
    // What went wrong is the caller's to fix, and is said plainly; anything else is a bug, and is thrown.
    const known =
      error instanceof UsageError ||
      error instanceof RunError ||
      error instanceof AssertionSyntaxError ||
      error instanceof ShareError ||
      error instanceof DesignError ||
      (error instanceof TypeError && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS'));
    if (!known) throw error;
    io.err(error instanceof Error ? error.message : String(error));
    io.err('Run "loadline help" for how to use it.');
    return EXIT_USAGE;
  }
}
