import { createSimulation, hasErrors, lintDesign, totalMonthlyCost } from '@loadline/engine';
import type { Design, Simulation } from '@loadline/engine';
import type { Objective, ObjectiveResult, Outcome, Scenario } from './types.ts';

const EMPTY_SCORE = { fromMs: 0, ok: 0, failed: 0, meanMs: 0, p50: 0, p95: 0, p99: 0 };

/** The value at a dotted path such as `autoscale.min`. */
function getPath(source: unknown, path: string): unknown {
  let value = source;
  for (const key of path.split('.')) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The locked settings a design has changed and the rules it has broken, as ids: `locked:api` for a
 * locked part that is gone, `locked:api.serviceTime` for a changed setting, `added:worker.serviceTime`
 * for a new part with a setting it may not have, and whatever the level's own rules return.
 */
export function brokenRules(scenario: Scenario, design: Design): string[] {
  const broken: string[] = [];
  const find = (source: Design, id: string) =>
    source.nodes.find((node) => node.id === id) ?? source.edges.find((edge) => edge.id === id);

  for (const [id, paths] of Object.entries(scenario.locked)) {
    const original = find(scenario.starter, id);
    const current = find(design, id);
    if (!original) continue;
    if (!current) {
      if (!scenario.removable?.includes(id)) broken.push(`locked:${id}`);
      continue;
    }
    if (paths === '*') {
      if (!same(current.params, original.params)) broken.push(`locked:${id}`);
      continue;
    }
    for (const path of paths) {
      if (!same(getPath(current.params, path), getPath(original.params, path))) broken.push(`locked:${id}.${path}`);
    }
  }

  const starterIds = new Set(scenario.starter.nodes.map((node) => node.id));
  for (const node of design.nodes) {
    if (starterIds.has(node.id)) continue;
    if (!scenario.palette.includes(node.type)) {
      broken.push(`palette:${node.type}`);
      continue;
    }
    for (const [path, value] of Object.entries(scenario.added?.[node.type] ?? {})) {
      if (!same(getPath(node.params, path), value)) broken.push(`added:${node.type}.${path}`);
    }
  }

  return [...new Set([...broken, ...(scenario.rules?.(design) ?? [])])];
}

function judge(objective: Objective, design: Design, sim: Simulation): ObjectiveResult {
  const score = sim.score();
  switch (objective.kind) {
    case 'p99': {
      // With nothing succeeding there is no latency to judge, and that is not a pass.
      const value = score.ok > 0 ? score.p99 : Infinity;
      return { objective, value, met: value <= objective.maxMs };
    }
    case 'errors': {
      const finished = score.ok + score.failed;
      const value = finished > 0 ? score.failed / finished : 1;
      return { objective, value, met: value <= objective.maxRate };
    }
    case 'cost': {
      const value = totalMonthlyCost(sim);
      return { objective, value, met: value <= objective.maxMonthly };
    }
    case 'backlog': {
      let value = 0;
      design.nodes.forEach((node, index) => {
        if (node.type === 'queue') value += sim.gauges()[index]!.queued;
      });
      return { objective, value, met: value <= objective.maxDepth };
    }
    case 'lost': {
      let value = 0;
      design.nodes.forEach((node, index) => {
        if (node.type !== 'queue') return;
        const queue = sim.nodes[index]!;
        const detail = queue.detail();
        value += queue.failed + (detail.dropped ?? 0) + (detail.deadLettered ?? 0);
      });
      return { objective, value, met: value <= objective.max };
    }
    case 'wait': {
      // The longest wait of any message a worker has taken. One that is still waiting when the run
      // ends is not in it; that is what the backlog is for.
      let value = 0;
      design.nodes.forEach((node, index) => {
        if (node.type === 'queue') value = Math.max(value, sim.nodes[index]!.latency.max());
      });
      return { objective, value, met: value <= objective.maxMs };
    }
  }
}

/**
 * How a run stands against a level's objectives right now. Used while a level is being played and,
 * once the run has reached the level's duration, for its result.
 */
export function evaluate(scenario: Scenario, design: Design, sim: Simulation): Outcome {
  const broken = brokenRules(scenario, design);
  const results = scenario.objectives.map((objective) => judge(objective, design, sim));
  const bonus: Outcome['bonus'] = [
    scenario.bonus[0].map((objective) => judge(objective, design, sim)),
    scenario.bonus[1].map((objective) => judge(objective, design, sim)),
  ];
  const passed = broken.length === 0 && results.every((result) => result.met);
  const second = passed && bonus[0].every((result) => result.met);
  const third = second && bonus[1].every((result) => result.met);
  return {
    passed,
    stars: third ? 3 : second ? 2 : passed ? 1 : 0,
    results,
    bonus,
    broken,
    issues: [],
    score: sim.score(),
    monthlyCost: totalMonthlyCost(sim),
  };
}

/** Starts a run of a level with a design. Throws `DesignError` if the design has errors. */
export function startScenario(scenario: Scenario, design: Design, seed = scenario.seed): Simulation {
  return createSimulation(design, { seed, workload: scenario.workload, scoreFromMs: scenario.warmupMs });
}

/** Runs a design through a level from start to finish and scores it. */
export function runScenario(scenario: Scenario, design: Design, seed = scenario.seed): Outcome {
  const issues = lintDesign(design).filter((issue) => issue.level === 'error');
  if (hasErrors(issues)) {
    return {
      passed: false,
      stars: 0,
      results: [],
      bonus: [[], []],
      broken: brokenRules(scenario, design),
      issues,
      score: EMPTY_SCORE,
      monthlyCost: 0,
    };
  }
  const sim = startScenario(scenario, design, seed);
  sim.advance(scenario.durationMs);
  return evaluate(scenario, design, sim);
}
