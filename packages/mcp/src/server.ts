import { PLAYGROUND_URL, RunError, describeIssues, describeRun, readDocument, simulate, summarizeReport } from '@loadline/cli';
import type { Document, Limits } from '@loadline/cli';
import { DesignError } from '@loadline/engine';
import { LEVELS, findLevel } from '@loadline/scenarios';
import { ShareError, encodeShare } from '@loadline/share';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { describeComponents } from './components.ts';

// Loadline as tools for an agent. Each tool is one call into the same engine and the same scoring
// the web app uses, so a design an agent says passes a level passes it in the browser too.
//
// An agent can ask for anything, so every call is bounded: how long a run may be, how much
// traffic, and how many events, whichever comes first. A call always comes back in seconds.

export const LIMITS: Limits = { maxDurationMs: 600_000, maxEvents: 30_000_000, maxRate: 20_000 };

const DESIGN = z
  .record(z.string(), z.unknown())
  .describe('A design: { nodes: [...], edges: [...] }. Call list_components for the kinds of part and their settings.');
const WORKLOAD = z
  .record(z.string(), z.unknown())
  .optional()
  .describe(
    'Traffic and faults over time: { phases: [{ atMs, multiplier }], chaos: [{ atMs, command }] }. A command is ' +
      '{ type: "kill" | "slow" | "errors" | "flush" | "failover", nodeId, ... }, { type: "sever" | "delay", edgeId, ... } or { type: "traffic", multiplier }, ' +
      'most with an optional durationMs.',
  );

const text = (value: string): CallToolResult => ({ content: [{ type: 'text', text: value }] });
const json = (value: unknown): CallToolResult => text(JSON.stringify(value, null, 2));
const refusal = (message: string): CallToolResult => ({ content: [{ type: 'text', text: message }], isError: true });

/** Reads what an agent sent as a design, or says what is wrong with it in a way the agent can act on. */
function read(design: unknown, extra: { workload?: unknown; seed?: number | undefined; level?: string | undefined } = {}): Document | CallToolResult {
  const result = readDocument({
    design,
    ...(extra.workload === undefined ? {} : { workload: extra.workload }),
    ...(extra.seed === undefined ? {} : { seed: extra.seed }),
    ...(extra.level === undefined ? {} : { level: extra.level }),
  });
  if (result.ok) return result.document;
  return refusal(['This is not a design that can run:', ...result.problems.map((line) => `- ${line}`)].join('\n'));
}

const isRefusal = (value: Document | CallToolResult): value is CallToolResult => 'content' in value;

/** Runs a tool body, turning the mistakes a caller can make into an answer it can read. */
async function answer(body: () => CallToolResult | Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof RunError || error instanceof DesignError || error instanceof ShareError) return refusal(error.message);
    throw error;
  }
}

export function createServer(): McpServer {
  const server = new McpServer({ name: 'loadline', version: '0.1.0' });

  server.registerTool(
    'list_components',
    {
      title: 'List the kinds of part',
      description:
        'The kinds of part a design is made of, what each does, and every setting with its default. Read this before writing a design.',
      annotations: { readOnlyHint: true },
    },
    () => json(describeComponents()),
  );

  server.registerTool(
    'validate_design',
    {
      title: 'Check a design',
      description: 'Checks a design without running it. Says whether it can run, and lists errors and warnings (for example a cache that fronts nothing).',
      inputSchema: { design: DESIGN },
      annotations: { readOnlyHint: true },
    },
    ({ design }) => {
      const result = readDocument(design);
      const issues = describeIssues(result.issues);
      if (!result.ok) return json({ canRun: false, problems: result.problems, issues });
      return json({ canRun: true, parts: result.document.design.nodes.length, connections: result.document.design.edges.length, issues });
    },
  );

  server.registerTool(
    'simulate',
    {
      title: 'Run a design',
      description:
        'Simulates traffic through a design, request by request, and reports what clients saw: requests sent and failed, latency percentiles, ' +
        'cost, how busy each part was, where the time went, and why requests failed. Deterministic: the same design, workload and seed give the same numbers. ' +
        `Limits: ${String(LIMITS.maxDurationMs / 1000)} s of simulated time, ${String(LIMITS.maxRate)} requests a second.`,
      inputSchema: {
        design: DESIGN,
        workload: WORKLOAD,
        duration_ms: z.number().int().positive().max(LIMITS.maxDurationMs).optional().describe('Simulated time to run for. Default 60000.'),
        seed: z.number().int().min(0).max(0xffff_ffff).optional().describe('Default 2026.'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ design, workload, duration_ms: durationMs, seed }) =>
      answer(() => {
        const document = read(design, { workload, seed });
        if (isRefusal(document)) return document;
        const run = simulate(document, { ...(durationMs === undefined ? {} : { durationMs }), limits: LIMITS });
        return {
          content: [
            { type: 'text', text: describeRun(document, run) },
            { type: 'text', text: JSON.stringify({ complete: run.complete, bottleneck: run.bottleneck, report: summarizeReport(run.report) }) },
          ],
        };
      }),
  );

  server.registerTool(
    'list_scenarios',
    {
      title: 'List the levels',
      description:
        'The levels: each is a system with a problem. Returns for each its brief, its objectives, the design it starts from, ' +
        'which settings are fixed and which kinds of part may be added. Solve one by changing the starting design and calling score_scenario.',
      inputSchema: { id: z.string().optional().describe('Only this level, with its starting design. Without it, a short list of all of them.') },
      annotations: { readOnlyHint: true },
    },
    ({ id }) => {
      if (id === undefined) {
        return json(LEVELS.map((level, index) => ({ number: index + 1, id: level.id, title: level.text.title, summary: level.text.summary })));
      }
      const level = findLevel(id);
      if (!level) return refusal(`There is no level "${id}". The levels are: ${LEVELS.map((each) => each.id).join(', ')}.`);
      return json({
        id: level.id,
        title: level.text.title,
        brief: level.text.brief,
        objectives: level.objectives,
        bonusForSecondStar: level.bonus[0],
        bonusForThirdStar: level.bonus[1],
        durationMs: level.durationMs,
        scoredFromMs: level.warmupMs,
        workload: level.workload,
        // What may not be changed: by part id, a list of setting paths, or "*" for all of them.
        // A part listed here may not be removed either, unless it is in `removable`.
        locked: level.locked,
        removable: level.removable ?? [],
        partsThatMayBeAdded: level.palette,
        settingsAddedPartsMustHave: level.added ?? {},
        rules: level.text.rules ?? {},
        starter: level.starter,
      });
    },
  );

  server.registerTool(
    'score_scenario',
    {
      title: 'Score a design against a level',
      description:
        'Runs a design through a level (the level sets the traffic, faults, seed and length) and scores it: whether it passed, how many stars of 3, ' +
        'each objective with what was achieved, and any rule it broke. A design that changes a fixed setting cannot pass, however well it does.',
      inputSchema: { scenario: z.string().describe('The id of a level, from list_scenarios.'), design: DESIGN },
      annotations: { readOnlyHint: true },
    },
    ({ scenario, design }) =>
      answer(() => {
        const level = findLevel(scenario);
        if (!level) return refusal(`There is no level "${scenario}". The levels are: ${LEVELS.map((each) => each.id).join(', ')}.`);
        const document = read(design);
        if (isRefusal(document)) return document;
        const run = simulate(document, { level: level.id, limits: LIMITS });
        const outcome = run.level!.outcome;
        return {
          content: [
            { type: 'text', text: describeRun(document, run) },
            {
              type: 'text',
              text: JSON.stringify({
                passed: outcome.passed,
                stars: outcome.stars,
                objectives: outcome.results,
                bonus: outcome.bonus,
                brokenRules: outcome.broken.map((rule) => level.text.rules?.[rule] ?? rule),
                monthlyCost: outcome.monthlyCost,
                bottleneck: run.bottleneck,
              }),
            },
          ],
        };
      }),
  );

  server.registerTool(
    'share_link',
    {
      title: 'Make a link to a design',
      description:
        'A link that opens a design in the Loadline playground in a browser, where a person can see it run. The design is in the link itself; nothing is uploaded. ' +
        'Give the level it answers, if it answers one.',
      inputSchema: {
        design: DESIGN,
        scenario: z.string().optional().describe('The id of the level the design answers.'),
        workload: WORKLOAD,
        seed: z.number().int().min(0).max(0xffff_ffff).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ design, scenario, workload, seed }) =>
      answer(async () => {
        if (scenario !== undefined && !findLevel(scenario)) return refusal(`There is no level "${scenario}".`);
        const document = read(design, { workload, seed, level: scenario });
        if (isRefusal(document)) return document;
        return text(`${PLAYGROUND_URL}#/d/${await encodeShare(document)}`);
      }),
  );

  return server;
}
