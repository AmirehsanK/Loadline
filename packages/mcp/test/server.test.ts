import { fileURLToPath } from 'node:url';
import { designSchema } from '@loadline/engine';
import { LEVELS, runScenario } from '@loadline/scenarios';
import { decodeShare } from '@loadline/share';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LIMITS, createServer } from '../src/index.ts';

// The server is driven the way an agent drives it: through a client, over a transport, by tool
// name and JSON arguments. Only the transport is in memory.

const client = new Client({ name: 'test', version: '0.0.0' });

beforeAll(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([createServer().connect(serverSide), client.connect(clientSide)]);
});
afterAll(async () => {
  await client.close();
});

interface Answer {
  isError: boolean;
  texts: string[];
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<Answer> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text?: string }[];
  return { isError: result.isError === true, texts: content.map((item) => item.text ?? '') };
}

const firstTraffic = LEVELS.find((level) => level.id === 'first-traffic')!;
const small = designSchema.parse({
  nodes: [
    { id: 'users', type: 'client', params: { rps: 100 } },
    { id: 'api', type: 'service', params: { concurrency: 8, serviceTime: { kind: 'exp', mean: 20 } } },
  ],
  edges: [{ id: 'users--api', from: 'users', to: 'api' }],
});

describe('the tools', () => {
  it('are the six the server says it has, each described and marked as changing nothing', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'list_components',
      'list_scenarios',
      'score_scenario',
      'share_link',
      'simulate',
      'validate_design',
    ]);
    for (const tool of tools) {
      expect(tool.description?.length, tool.name).toBeGreaterThan(40);
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
    }
  });
});

describe('list_components', () => {
  it('describes every kind of part with the defaults the engine uses', async () => {
    const answer = await call('list_components');
    const described = JSON.parse(answer.texts[0]!) as { parts: { type: string; what: string; defaults: Record<string, unknown> }[]; edges: { defaults: Record<string, unknown> } };
    expect(described.parts.map((part) => part.type)).toEqual(['client', 'load-balancer', 'rate-limiter', 'service', 'cache', 'database', 'queue', 'worker']);
    expect(described.parts.find((part) => part.type === 'client')!.defaults).toMatchObject({ rps: 100, readRatio: 0.9 });
    expect(described.edges.defaults).toMatchObject({ timeoutMs: 3000, retries: 0, mode: 'sync' });
    // A design written from this description alone is one the engine accepts.
    const written = { nodes: described.parts.slice(0, 1).map((part) => ({ id: 'a', type: part.type, params: part.defaults })), edges: [] };
    expect(JSON.parse((await call('validate_design', { design: written })).texts[0]!)).toMatchObject({ canRun: true });
  });
});

describe('validate_design', () => {
  it('says a sound design can run, and passes on its warnings', async () => {
    const answer = JSON.parse((await call('validate_design', { design: small })).texts[0]!) as Record<string, unknown>;
    expect(answer).toEqual({ canRun: true, parts: 2, connections: 1, issues: [] });
    const lonely = JSON.parse((await call('validate_design', { design: { nodes: [{ id: 'u', type: 'client' }] } })).texts[0]!) as { issues: string[] };
    expect(lonely.issues[0]).toMatch(/^warning/);
  });

  it('says what is wrong with one that cannot', async () => {
    const answer = JSON.parse((await call('validate_design', { design: { nodes: [{ id: 'u', type: 'client', params: { rps: -1 } }] } })).texts[0]!) as {
      canRun: boolean;
      problems: string[];
    };
    expect(answer.canRun).toBe(false);
    expect(answer.problems.join(' ')).toContain('rps');
  });
});

describe('simulate', () => {
  it('reports a run in words and in figures, the same every time', async () => {
    const answer = await call('simulate', { design: small, duration_ms: 20_000, seed: 3 });
    expect(answer.isError).toBe(false);
    expect(answer.texts[0]).toContain('2 parts, 1 connections. Seed 3, 20 s simulated');
    const figures = JSON.parse(answer.texts[1]!) as { complete: boolean; report: { requests: { created: number; failed: number }; samples?: unknown } };
    expect(figures.complete).toBe(true);
    expect(figures.report.requests.created).toBeGreaterThan(1800);
    expect(figures.report.requests.failed).toBe(0);
    // The second-by-second samples are left out: they are most of a report and no use to an agent.
    expect(figures.report.samples).toBeUndefined();
    expect(await call('simulate', { design: small, duration_ms: 20_000, seed: 3 })).toEqual(answer);
  });

  it('follows a workload: here the service is killed half way', async () => {
    const workload = { chaos: [{ atMs: 5000, command: { type: 'kill', nodeId: 'api' } }] };
    const answer = await call('simulate', { design: small, workload, duration_ms: 10_000 });
    const figures = JSON.parse(answer.texts[1]!) as { bottleneck: { kind: string; nodeId: string }; report: { rates: { errorRate: number } } };
    expect(figures.bottleneck).toMatchObject({ kind: 'down', nodeId: 'api' });
    expect(figures.report.rates.errorRate).toBeGreaterThan(0.4);
  });

  it('refuses what it would take too long to run, and says why', async () => {
    const flood = designSchema.parse({ ...small, nodes: [{ id: 'users', type: 'client', params: { rps: 100_000 } }, small.nodes[1]] });
    const refused = await call('simulate', { design: flood });
    expect(refused.isError).toBe(true);
    expect(refused.texts[0]).toContain(`the most allowed here is ${String(LIMITS.maxRate)}`);

    // Traffic that a workload multiplies past the limit is caught as well.
    const surge = { phases: [{ atMs: 1000, multiplier: 500 }] };
    expect((await call('simulate', { design: small, workload: surge })).isError).toBe(true);
    // And a run longer than the limit never starts.
    expect((await call('simulate', { design: small, duration_ms: LIMITS.maxDurationMs + 1 })).isError).toBe(true);
  });

  it('refuses a design that cannot run, and says what is wrong with it', async () => {
    const refused = await call('simulate', { design: { nodes: [{ id: 'u', type: 'mainframe' }] } });
    expect(refused.isError).toBe(true);
    expect(refused.texts[0]).toMatch(/^This is not a design that can run:/);
  });
});

describe('list_scenarios and score_scenario', () => {
  it('lists the levels, and gives one in full with the design it starts from', async () => {
    const list = JSON.parse((await call('list_scenarios')).texts[0]!) as { id: string }[];
    expect(list.map((level) => level.id)).toEqual(LEVELS.map((level) => level.id));

    const one = JSON.parse((await call('list_scenarios', { id: 'first-traffic' })).texts[0]!) as Record<string, unknown>;
    expect(one).toMatchObject({ id: 'first-traffic', partsThatMayBeAdded: ['load-balancer'], starter: firstTraffic.starter, objectives: firstTraffic.objectives });
    expect((await call('list_scenarios', { id: 'nope' })).isError).toBe(true);
  });

  it('scores a design exactly as the web app and the tests do', async () => {
    for (const [design, expected] of [
      [firstTraffic.starter, runScenario(firstTraffic, firstTraffic.starter)],
      [firstTraffic.reference, runScenario(firstTraffic, firstTraffic.reference)],
    ] as const) {
      const answer = await call('score_scenario', { scenario: 'first-traffic', design });
      const scored = JSON.parse(answer.texts[1]!) as { passed: boolean; stars: number; objectives: unknown };
      expect(scored).toMatchObject({ passed: expected.passed, stars: expected.stars, objectives: expected.results });
    }
    expect((await call('score_scenario', { scenario: 'first-traffic', design: firstTraffic.reference })).texts[0]).toContain('passed, 3 of 3 stars');
  });

  it('lets an agent solve a level with nothing but the tools', async () => {
    // What an agent would do: read the level, change the starting design, and score it.
    const level = JSON.parse((await call('list_scenarios', { id: 'first-traffic' })).texts[0]!) as { starter: { nodes: Record<string, unknown>[]; edges: unknown[] } };
    const api = level.starter.nodes.find((node) => node.id === 'api')!;
    const attempt = {
      nodes: [...level.starter.nodes.filter((node) => node.id !== 'api'), { ...api, params: { ...(api.params as object), instances: 2 } }, { id: 'lb', type: 'load-balancer' }],
      edges: [
        { id: 'users--lb', from: 'users', to: 'lb' },
        { id: 'lb--api', from: 'lb', to: 'api' },
      ],
    };
    const scored = JSON.parse((await call('score_scenario', { scenario: 'first-traffic', design: attempt })).texts[1]!) as { passed: boolean; stars: number };
    expect(scored).toMatchObject({ passed: true, stars: 3 });
  });

  it('says which rule a design broke', async () => {
    const cheat = structuredClone(firstTraffic.starter);
    const api = cheat.nodes.find((node) => node.id === 'api')!;
    if (api.type === 'service') api.params.concurrency = 64;
    const scored = JSON.parse((await call('score_scenario', { scenario: 'first-traffic', design: cheat })).texts[1]!) as { passed: boolean; brokenRules: string[] };
    expect(scored).toMatchObject({ passed: false, brokenRules: ['locked:api.concurrency'] });
  });
});

describe('share_link', () => {
  it('makes a link that opens the design, with the level it answers', async () => {
    const answer = await call('share_link', { design: firstTraffic.reference, scenario: 'first-traffic' });
    const link = answer.texts[0]!;
    expect(link).toMatch(/^https:\/\/amirehsank\.github\.io\/Loadline\/#\/d\/v1\./);
    expect(await decodeShare(link.slice(link.indexOf('#/d/') + 4))).toEqual({ design: firstTraffic.reference, level: 'first-traffic' });
    expect((await call('share_link', { design: small, scenario: 'nope' })).isError).toBe(true);
  });
});

describe('the server as a program', () => {
  it('speaks the protocol over standard input and output', { timeout: 60_000 }, async () => {
    // The real entry point, started the way an agent starts it.
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    const entry = fileURLToPath(new URL('../src/main.ts', import.meta.url));
    const outside = new Client({ name: 'test', version: '0.0.0' });
    await outside.connect(new StdioClientTransport({ command: process.execPath, args: [entry] }));
    try {
      expect((await outside.listTools()).tools).toHaveLength(6);
      const result = await outside.callTool({ name: 'list_scenarios', arguments: {} });
      const levels = JSON.parse((result.content as { text: string }[])[0]!.text) as unknown[];
      expect(levels).toHaveLength(LEVELS.length);
    } finally {
      await outside.close();
    }
  });
});
