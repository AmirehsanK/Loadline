import { designSchema } from '@loadline/engine';
import type { Design } from '@loadline/engine';
import { describe, expect, it } from 'vitest';
import { brokenRules, evaluate, findLevel, runScenario, startScenario } from '../src/index.ts';
import type { Scenario } from '../src/index.ts';
import { fleet } from '../src/levels/first-traffic.ts';
import { queued } from '../src/levels/write-burst.ts';

function level(id: string): Scenario {
  const found = findLevel(id);
  if (!found) throw new Error(`no level "${id}"`);
  return found;
}

/** A copy of a design with a change made to it. */
function changed(design: Design, change: (draft: Design) => void): Design {
  const draft = structuredClone(design);
  change(draft);
  return designSchema.parse(draft);
}

const firstTraffic = level('first-traffic');
const writeBurst = level('write-burst');

describe('the rules of a level', () => {
  it('are kept by a design that only changes what it may', () => {
    const more = changed(firstTraffic.starter, (draft) => {
      const api = draft.nodes.find((node) => node.id === 'api')!;
      if (api.type === 'service') api.params.queue = 8;
    });
    expect(brokenRules(firstTraffic, more)).toEqual([]);
  });

  it('are broken by changing a locked setting, however well the design then does', () => {
    // Sixteen slots where there were eight: one instance is now enough, and that is not the level.
    const bigger = changed(firstTraffic.starter, (draft) => {
      const api = draft.nodes.find((node) => node.id === 'api')!;
      if (api.type === 'service') api.params.concurrency = 16;
    });
    const outcome = runScenario(firstTraffic, bigger);
    expect(outcome.broken).toEqual(['locked:api.concurrency']);
    expect(outcome.results.every((result) => result.met)).toBe(true);
    expect(outcome.passed).toBe(false);
    expect(outcome.stars).toBe(0);
  });

  it('are broken by changing anything on a part that is locked whole', () => {
    const quieter = changed(firstTraffic.starter, (draft) => {
      const users = draft.nodes.find((node) => node.id === 'users')!;
      if (users.type === 'client') users.params.rps = 10;
    });
    expect(brokenRules(firstTraffic, quieter)).toEqual(['locked:users']);
  });

  it('are broken by removing a locked part, unless the level lets it go', () => {
    const readHeavy = level('read-heavy');
    const noDatabase = changed(readHeavy.starter, (draft) => {
      draft.nodes = draft.nodes.filter((node) => node.id !== 'db');
      draft.edges = draft.edges.filter((edge) => edge.to !== 'db');
    });
    expect(brokenRules(readHeavy, noDatabase)).toEqual(['locked:db', 'locked:api--db']);

    // The ledger is locked while it is there, and the reference takes it out.
    expect(writeBurst.reference.nodes.some((node) => node.id === 'ledger')).toBe(false);
    expect(brokenRules(writeBurst, writeBurst.reference)).toEqual([]);
  });

  it('are broken by adding a kind of part the level does not offer', () => {
    const withCache = changed(fleet(2, true), (draft) => {
      draft.nodes.push({ id: 'cache', type: 'cache', name: 'Cache', x: 0, y: 0, params: {} } as never);
      draft.edges.push({ id: 'api--cache', from: 'api', to: 'cache', params: {} } as never);
    });
    expect(brokenRules(firstTraffic, withCache)).toEqual(['palette:cache']);
  });

  it('are broken by a new part that does not have the settings the level gives its kind', () => {
    const fasterWorker = changed(queued(1), (draft) => {
      const worker = draft.nodes.find((node) => node.id === 'recorder')!;
      if (worker.type === 'worker') worker.params.serviceTime = { kind: 'const', mean: 1 };
    });
    const outcome = runScenario(writeBurst, fasterWorker);
    expect(outcome.broken).toEqual(['added:worker.serviceTime']);
    expect(outcome.passed).toBe(false);
  });

  it('include what the level itself asks of the structure', () => {
    // Orders are taken and then go nowhere.
    const forgotten = changed(writeBurst.starter, (draft) => {
      draft.edges = draft.edges.filter((edge) => edge.to !== 'ledger');
    });
    expect(brokenRules(writeBurst, forgotten)).toEqual(['orders-recorded']);
    expect(writeBurst.text.rules?.['orders-recorded']).toBeDefined();
  });
});

describe('scoring', () => {
  it('does not run a design that has errors', () => {
    const twoWays = changed(fleet(2, true), (draft) => {
      draft.edges.push({ id: 'users--api', from: 'users', to: 'api', params: {} } as never);
    });
    const outcome = runScenario(firstTraffic, twoWays);
    expect(outcome.passed).toBe(false);
    expect(outcome.issues.map((issue) => issue.code)).toContain('client-fan-out');
    expect(outcome.results).toEqual([]);
    expect(() => startScenario(firstTraffic, twoWays)).toThrow(/errors/);
  });

  it('does not pass a design that carries no traffic', () => {
    const unplugged = changed(firstTraffic.starter, (draft) => {
      draft.edges = [];
    });
    const outcome = runScenario(firstTraffic, unplugged);
    expect(outcome.passed).toBe(false);
    expect(outcome.results.find((result) => result.objective.kind === 'errors')?.met).toBe(false);
    expect(outcome.results.find((result) => result.objective.kind === 'p99')?.met).toBe(false);
  });

  it('leaves the warm-up out, and can be asked while the run is in progress', () => {
    const sim = startScenario(firstTraffic, firstTraffic.reference);
    sim.advance(firstTraffic.warmupMs - 1000);
    expect(evaluate(firstTraffic, firstTraffic.reference, sim).score.ok).toBe(0);

    sim.advance(firstTraffic.warmupMs + 10_000);
    const midway = evaluate(firstTraffic, firstTraffic.reference, sim);
    // Ten seconds at 300 a second, give or take.
    expect(midway.score.fromMs).toBe(firstTraffic.warmupMs);
    expect(midway.score.ok).toBeGreaterThan(2700);
    expect(midway.score.ok).toBeLessThan(3300);
    expect(midway.results.map((result) => result.objective)).toEqual(firstTraffic.objectives);

    sim.advance(firstTraffic.durationMs);
    expect(evaluate(firstTraffic, firstTraffic.reference, sim)).toEqual(runScenario(firstTraffic, firstTraffic.reference));
  });

  it('gives a third star only on top of the second', () => {
    // Three instances are fast enough for the third star and cost too much for the second.
    const outcome = runScenario(firstTraffic, fleet(3, true));
    expect(outcome.passed).toBe(true);
    expect(outcome.bonus[0].every((result) => result.met)).toBe(false);
    expect(outcome.bonus[1].every((result) => result.met)).toBe(true);
    expect(outcome.stars).toBe(1);
  });

  it('depends on the seed only a little', () => {
    const one = runScenario(firstTraffic, firstTraffic.reference, 1);
    const two = runScenario(firstTraffic, firstTraffic.reference, 2);
    expect(one.score.ok).not.toBe(two.score.ok);
    expect(one.stars).toBe(two.stars);
  });
});
