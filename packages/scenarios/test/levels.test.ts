import { NODE_TYPES, createSimulation, designMonthlyCost, lintDesign, totalMonthlyCost } from '@loadline/engine';
import { describe, expect, it } from 'vitest';
import { LEVELS, brokenRules, findLevel, runScenario } from '../src/index.ts';
import type { Objective } from '../src/index.ts';
import { ATTEMPTS } from './attempts.ts';

const SEEDS = [0, 1, 2, 3, 4];

/** The value at a dotted path such as `autoscale.min`. */
function getPath(source: unknown, path: string): unknown {
  let value = source;
  for (const key of path.split('.')) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

describe('the levels', () => {
  it('are eighteen, each with its own id and seed, and can be found by id', () => {
    expect(LEVELS).toHaveLength(18);
    expect(new Set(LEVELS.map((level) => level.id)).size).toBe(LEVELS.length);
    expect(new Set(LEVELS.map((level) => level.seed)).size).toBe(LEVELS.length);
    for (const level of LEVELS) expect(findLevel(level.id)).toBe(level);
    expect(findLevel('no-such-level')).toBeUndefined();
  });

  it('each have a table of what a player might try', () => {
    expect(Object.keys(ATTEMPTS).sort()).toEqual(LEVELS.map((level) => level.id).sort());
  });
});

describe.each(LEVELS.map((level) => [level.id, level] as const))('%s', (_id, level) => {
  it('starts from a design that runs, breaks no rule, and passes on none of five seeds', { timeout: 60_000 }, () => {
    expect(lintDesign(level.starter).filter((issue) => issue.level === 'error')).toEqual([]);
    expect(brokenRules(level, level.starter)).toEqual([]);
    for (const offset of SEEDS) {
      expect(runScenario(level, level.starter, level.seed + offset).passed, `seed +${offset}`).toBe(false);
    }
  });

  it('has a reference design that breaks no rule and earns three stars on each of five seeds', { timeout: 60_000 }, () => {
    expect(lintDesign(level.reference).filter((issue) => issue.level === 'error')).toEqual([]);
    for (const offset of SEEDS) {
      const outcome = runScenario(level, level.reference, level.seed + offset);
      expect(outcome.broken, `seed +${offset}`).toEqual([]);
      expect(outcome.stars, `seed +${offset}`).toBe(3);
    }
  });

  it('turns down and accepts what its lesson says it should', { timeout: 120_000 }, () => {
    for (const [what, design, stars] of ATTEMPTS[level.id]!) {
      const outcome = runScenario(level, design);
      expect(outcome.issues, what).toEqual([]);
      expect(outcome.broken, what).toEqual([]);
      expect(outcome.stars, what).toBe(stars);
    }
  });

  it('costs at rest what a run of it starts at', () => {
    // The page shows the first figure until the run has something to say, and the second after.
    for (const design of [level.starter, level.reference]) {
      const sim = createSimulation(design, { seed: level.seed, workload: level.workload });
      expect(designMonthlyCost(design)).toBe(totalMonthlyCost(sim));
    }
  });

  it('has an answer that passes without earning every star', () => {
    // The stars are meant to tell a good answer from a better one. A level where every answer that
    // passes earns all three has a pass mark and nothing else.
    const passingShort = ATTEMPTS[level.id]!.filter(([, , stars]) => stars === 1 || stars === 2);
    // Write burst is the one such level left: only two worker instances pass, and they earn three.
    if (level.id !== 'write-burst') expect(passingShort.length).toBeGreaterThan(0);
  });

  it('gives the same result every time', () => {
    expect(runScenario(level, level.reference)).toEqual(runScenario(level, level.reference));
  });

  it('locks only parts and settings that its starting design has', () => {
    for (const [id, paths] of Object.entries(level.locked)) {
      const part = level.starter.nodes.find((node) => node.id === id) ?? level.starter.edges.find((edge) => edge.id === id);
      expect(part, id).toBeDefined();
      if (paths === '*') continue;
      for (const path of paths) expect(getPath(part!.params, path), `${id}.${path}`).toBeDefined();
    }
    for (const id of level.removable ?? []) expect(level.locked[id], id).toBeDefined();
  });

  it('offers and constrains only kinds of part that exist', () => {
    for (const type of level.palette) expect(NODE_TYPES).toContain(type);
    for (const type of Object.keys(level.added ?? {})) expect(level.palette).toContain(type);
  });

  it('is scored on a period that lies inside the run, with bonuses harder than the objectives', () => {
    expect(level.warmupMs).toBeLessThan(level.durationMs);
    for (const phase of level.workload.phases) expect(phase.atMs).toBeLessThan(level.durationMs);
    for (const event of level.workload.chaos) expect(event.atMs).toBeLessThan(level.durationMs);

    // A bonus of a kind that is also an objective asks for more of the same.
    const limit = (objective: Objective) => Object.values(objective).find((value) => typeof value === 'number')!;
    let bar = new Map(level.objectives.map((objective) => [objective.kind, limit(objective)]));
    for (const tier of level.bonus) {
      expect(tier.length).toBeGreaterThan(0);
      for (const objective of tier) {
        const before = bar.get(objective.kind);
        if (before !== undefined) expect(limit(objective), objective.kind).toBeLessThan(before);
      }
      bar = new Map([...bar, ...tier.map((objective) => [objective.kind, limit(objective)] as const)]);
    }
  });

  it('has its words', () => {
    const { title, summary, brief, hints, debrief, rules } = level.text;
    expect(title.length).toBeGreaterThan(3);
    expect(summary.length).toBeGreaterThan(20);
    expect(summary.length).toBeLessThan(90);
    expect(brief.length).toBeGreaterThan(80);
    expect(debrief.length).toBeGreaterThan(200);
    expect(hints).toHaveLength(3);
    for (const text of [title, summary, brief, debrief, ...hints, ...Object.values(rules ?? {})]) {
      expect(text).toBe(text.trim());
      expect(text).not.toMatch(/ {2}/);
    }
  });
});
