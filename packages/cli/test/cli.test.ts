import { readFileSync } from 'node:fs';
import { LEVELS } from '@loadline/scenarios';
import { decodeShare } from '@loadline/share';
import { describe, expect, it } from 'vitest';
import { AssertionSyntaxError, PLAYGROUND_URL, check, cli, parseAssertion, parseDuration, readText, simulate } from '../src/index.ts';

const storefront = readFileSync(new URL('../../../examples/storefront.yaml', import.meta.url), 'utf8');
const firstTraffic = LEVELS.find((level) => level.id === 'first-traffic')!;

/** Runs the command line against files held in memory, and collects what it printed. */
async function run(argv: string[], files: Record<string, string> = { 'shop.yaml': storefront }) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await cli(argv, {
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    readFile: (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`no such file: ${path}`);
      return text;
    },
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('reading a design', () => {
  it('takes YAML or JSON, a document or a bare design', () => {
    const fromYaml = readText(storefront);
    expect(fromYaml.ok).toBe(true);
    if (!fromYaml.ok) return;
    expect(fromYaml.document).toMatchObject({ seed: 7, design: { name: 'Storefront' } });
    expect(fromYaml.document.workload?.phases).toHaveLength(2);

    const fromJson = readText(JSON.stringify(firstTraffic.reference));
    expect(fromJson).toMatchObject({ ok: true, document: { design: firstTraffic.reference } });
  });

  it('says what is wrong with text that is not a design', () => {
    expect(readText('{ not yaml: [')).toMatchObject({ ok: false, problems: [expect.stringMatching(/^Not valid JSON or YAML/) as string] });
    expect(readText('just a sentence')).toMatchObject({ ok: false });
    const negative = readText('design: { nodes: [{ id: u, type: client, params: { rps: -5 } }] }');
    expect(negative.ok).toBe(false);
    expect(negative.ok ? '' : negative.problems.join(' ')).toContain('rps');
  });

  it('refuses a design the engine could not run, and passes warnings on with one it can', () => {
    const loop = 'nodes: [{ id: a, type: service }, { id: b, type: service }]\nedges: [{ id: x, from: a, to: b }, { id: y, from: b, to: a }]';
    const refused = readText(loop);
    expect(refused.ok).toBe(false);
    expect(refused.issues.some((issue) => issue.code === 'cycle')).toBe(true);

    const alone = readText('nodes: [{ id: users, type: client }]');
    expect(alone).toMatchObject({ ok: true, issues: [{ level: 'warning', code: 'client-unconnected' }] });
  });
});

describe('loadline validate', () => {
  it('exits 0 for a design that can run, and says how big it is', async () => {
    expect(await run(['validate', 'shop.yaml'])).toMatchObject({ code: 0, out: 'shop.yaml can run: 5 parts, 4 connections.' });
  });

  it('exits 1 for one that cannot, and says why', async () => {
    const result = await run(['validate', 'bad.json'], { 'bad.json': '{"nodes":[{"id":"u","type":"mainframe"}]}' });
    expect(result.code).toBe(1);
    expect(result.out).toContain('bad.json cannot run.');
    expect(result.out).toMatch(/^error /m);
  });
});

describe('loadline simulate', () => {
  it('prints a report a person can read', async () => {
    const { code, out } = await run(['simulate', 'shop.yaml', '--duration', '20s']);
    expect(code).toBe(0);
    expect(out).toContain('Storefront: 5 parts, 4 connections. Seed 7, 20 s simulated');
    expect(out).toMatch(/^Requests\s+[\d,]+ sent\s+[\d,]+ ok\s+\d+ failed/m);
    expect(out).toMatch(/^Latency\s+p50 \d+ ms, p95 \d+ ms, p99 \d+ ms/m);
    expect(out).toMatch(/^db\s+database\s+[\d.]+%/m);
    expect(out).toMatch(/^users\s+client\s+–/m);
    expect(out).toContain('Where the time goes:');
  });

  it('gives the same numbers every time, and different ones for another seed', async () => {
    const first = await run(['simulate', 'shop.yaml', '--duration', '10s']);
    expect(await run(['simulate', 'shop.yaml', '--duration', '10s'])).toEqual(first);
    expect((await run(['simulate', 'shop.yaml', '--duration', '10s', '--seed', '8'])).out).not.toBe(first.out);
  });

  it('prints the whole result as JSON when asked', async () => {
    const { out } = await run(['simulate', 'shop.yaml', '--duration', '5s', '--json']);
    const result = JSON.parse(out) as { report: { timeMs: number; seed: number; nodes: unknown[] }; complete: boolean };
    expect(result).toMatchObject({ complete: true, report: { timeMs: 5000, seed: 7 } });
    expect(result.report.nodes).toHaveLength(5);
  });

  it('follows the traffic the file came with', () => {
    // Twice the traffic from 30 s to 45 s: a third more requests over the minute.
    const read = readText(storefront);
    if (!read.ok) throw new Error('unreadable');
    const steady = { design: read.document.design, seed: 7 };
    const withSurge = simulate(read.document).report.requests.created;
    const without = simulate(steady).report.requests.created;
    expect(withSurge / without).toBeGreaterThan(1.2);
    expect(withSurge / without).toBeLessThan(1.3);
  });

  it('runs a design against a level and scores it', async () => {
    const files = { 'answer.json': JSON.stringify(firstTraffic.reference), 'start.json': JSON.stringify(firstTraffic.starter) };
    const solved = await run(['simulate', 'answer.json', '--level', 'first-traffic'], files);
    expect(solved.out).toContain('Level "First traffic": passed, 3 of 3 stars.');
    expect(solved.out).toMatch(/met\s+p99 within 500 ms: 191 ms/);
    const unsolved = await run(['simulate', 'start.json', '--level', 'first-traffic'], files);
    expect(unsolved.out).toContain('Level "First traffic": not passed.');
    expect(unsolved.out).toMatch(/missed\s+no more than 1% failing: 32\.9%/);
  });
});

describe('loadline test', () => {
  it('exits 0 when every condition holds and 1 when one does not', async () => {
    const passing = await run(['test', 'shop.yaml', '--assert', 'p99<250ms', '--assert', 'errors<=1%']);
    expect(passing).toMatchObject({ code: 0 });
    expect(passing.out).toMatch(/^pass\s+p99<250ms\s+got \d+ ms$/m);

    const failing = await run(['test', 'shop.yaml', '--assert', 'p99<250ms', '--assert', 'cost<200']);
    expect(failing.code).toBe(1);
    expect(failing.out).toMatch(/^FAIL\s+cost<200\s+got \$302$/m);
  });

  it('takes passing a level as the condition when it is given a level and nothing else', async () => {
    const files = { 'answer.json': JSON.stringify(firstTraffic.reference), 'start.json': JSON.stringify(firstTraffic.starter) };
    expect(await run(['test', 'answer.json', '--level', 'first-traffic'], files)).toMatchObject({
      code: 0,
      out: 'pass  level "First traffic": passed, 3 of 3 stars',
    });
    expect((await run(['test', 'start.json', '--level', 'first-traffic'], files)).code).toBe(1);
    expect((await run(['test', 'answer.json', '--level', 'first-traffic', '--assert', 'stars>=3'], files)).code).toBe(0);
    expect((await run(['test', 'answer.json', '--level', 'first-traffic', '--assert', 'cost<50'], files)).code).toBe(1);
  });

  it('exits 2, not 1, when the command itself makes no sense', async () => {
    expect((await run(['test', 'shop.yaml'])).code).toBe(2);
    expect((await run(['test', 'shop.yaml', '--assert', 'p99 is fast'])).code).toBe(2);
    expect((await run(['test', 'shop.yaml', '--assert', 'stars>=1'])).code).toBe(2);
    expect((await run(['test', 'missing.yaml', '--assert', 'p99<1s'])).code).toBe(2);
    expect((await run(['simulate', 'shop.yaml', '--level', 'no-such-level'])).code).toBe(2);
    expect((await run(['simulate', 'shop.yaml', '--duration', 'a while'])).code).toBe(2);
    expect((await run(['simulate', 'shop.yaml', '--no-such-flag'])).code).toBe(2);
    expect((await run(['frobnicate'])).err).toContain('There is no command "frobnicate".');
    expect((await run([])).code).toBe(2);
    expect(await run(['help'])).toMatchObject({ code: 0, out: expect.stringContaining('Usage: loadline') as string });
  });
});

describe('loadline share and levels', () => {
  it('prints a link that holds the design', async () => {
    const { code, out } = await run(['share', 'shop.yaml']);
    expect(code).toBe(0);
    expect(out.startsWith(`${PLAYGROUND_URL}#/d/v1.`)).toBe(true);
    const read = readText(storefront);
    if (!read.ok) throw new Error('unreadable');
    expect(await decodeShare(out.slice(out.indexOf('#/d/') + 4))).toEqual(read.document);
    expect((await run(['share', 'shop.yaml', '--base', 'http://localhost:5183'])).out).toMatch(/^http:\/\/localhost:5183\/#\/d\/v1\./);
  });

  it('lists the levels in order', async () => {
    const { out } = await run(['levels']);
    expect(out.split('\n')).toHaveLength(LEVELS.length);
    expect(out.split('\n')[0]).toBe(' 1  first-traffic    First traffic: Traffic is about to pass what one instance can do.');
  });
});

describe('loadline review', () => {
  it('prints a prompt for a language model: how to review, then this run', async () => {
    const { code, out } = await run(['review', 'shop.yaml', '--duration', '20s']);
    expect(code).toBe(0);
    expect(out).toMatch(/^You are reviewing a system design/);
    expect(out).toContain('Reply in English.');
    expect(out).toContain('## The design');
    expect(out).toContain('- db ("Database"): database, 8 cores');
    expect(out).toContain("- at 30 s: traffic becomes 2 times the clients' base rate");
    expect(out).toContain('## What the run measured');
  });

  it('asks for the review in Persian when told to, and for a level it includes the result', async () => {
    const files = { 'start.json': JSON.stringify(firstTraffic.starter) };
    const { out } = await run(['review', 'start.json', '--level', 'first-traffic', '--language', 'fa'], files);
    expect(out).toContain('Reply in Persian (Farsi).');
    expect(out).toContain('This was the level "First traffic".');
    expect(out).toContain('Not passed.');
    expect((await run(['review', 'start.json', '--language', 'tlh'], files)).code).toBe(2);
  });
});

describe('conditions', () => {
  it('are read with their units', () => {
    expect(parseAssertion('p99<200ms')).toMatchObject({ metric: 'p99', operator: '<', limit: 200 });
    expect(parseAssertion(' p95 <= 1.5s ')).toMatchObject({ metric: 'p95', operator: '<=', limit: 1500, text: 'p95 <= 1.5s' });
    expect(parseAssertion('mean<20')).toMatchObject({ metric: 'mean', limit: 20 });
    expect(parseAssertion('errors<=1%')).toMatchObject({ metric: 'errors', limit: 0.01 });
    expect(parseAssertion('errors<0.005')).toMatchObject({ metric: 'errors', limit: 0.005 });
    expect(parseAssertion('cost<=$300')).toMatchObject({ metric: 'cost', limit: 300 });
    expect(parseAssertion('stars>=2')).toMatchObject({ metric: 'stars', operator: '>=', limit: 2 });
    expect(parseAssertion('failed==0')).toMatchObject({ metric: 'failed', operator: '=', limit: 0 });
  });

  it('are refused when they do not make sense', () => {
    for (const text of ['', 'p99', 'p99<fast', 'speed<3', 'p99<5%', 'errors<5ms', 'cost<5%', 'stars>=2ms', 'p99<<5', 'cost<$']) {
      expect(() => parseAssertion(text), text).toThrow(AssertionSyntaxError);
    }
  });

  it('do not hold for a latency when nothing succeeded', () => {
    // A client connected to nothing sends no traffic: there is no p99, so it is not under any limit.
    const read = readText('nodes: [{ id: users, type: client }]');
    if (!read.ok) throw new Error('unreadable');
    const nothing = simulate(read.document, { durationMs: 5000 });
    expect(check(parseAssertion('p99<1s'), nothing).holds).toBe(false);
    expect(check(parseAssertion('errors<1%'), nothing).holds).toBe(false);
    expect(check(parseAssertion('failed=0'), nothing).holds).toBe(true);
  });
});

describe('lengths of time', () => {
  it('are in milliseconds unless they say otherwise', () => {
    expect(parseDuration('30000')).toBe(30_000);
    expect(parseDuration('1500ms')).toBe(1500);
    expect(parseDuration('90s')).toBe(90_000);
    expect(parseDuration('2m')).toBe(120_000);
    expect(parseDuration('0.5s')).toBe(500);
  });
});
