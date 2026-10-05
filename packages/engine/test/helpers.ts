import { buildReport, createSimulation, designSchema, workloadSchema } from '../src/index.ts';
import type { Design, DesignInput, Dist, Report, Simulation, WorkloadInput } from '../src/index.ts';

export function design(input: DesignInput): Design {
  return designSchema.parse(input);
}

export interface StageInput {
  concurrency?: number;
  queue?: number;
  instances?: number;
  serviceTime: Dist;
  /** Policy of the edge leading to this stage. */
  latencyMs?: number;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  backoffFactor?: number;
  jitter?: number;
}

/**
 * A client calling a chain of services: users → s1 → s2 → ... Edges default to no latency and no
 * timeout, so that a test only gets the behaviour it asks for.
 */
export function chain(rps: number, stages: StageInput[]): Design {
  const nodes: DesignInput['nodes'] = [{ id: 'users', type: 'client', params: { rps } }];
  const edges: DesignInput['edges'] = [];
  stages.forEach((stage, i) => {
    const id = `s${i + 1}`;
    nodes.push({
      id,
      type: 'service',
      params: {
        concurrency: stage.concurrency ?? 1,
        queue: stage.queue ?? 1_000_000,
        instances: stage.instances ?? 1,
        serviceTime: stage.serviceTime,
      },
    });
    edges.push({
      id: `e${i + 1}`,
      from: i === 0 ? 'users' : `s${i}`,
      to: id,
      params: {
        latencyMs: stage.latencyMs ?? 0,
        timeoutMs: stage.timeoutMs ?? 0,
        retries: stage.retries ?? 0,
        backoffMs: stage.backoffMs ?? 0,
        backoffFactor: stage.backoffFactor ?? 1,
        jitter: stage.jitter ?? 0,
      },
    });
  });
  return design({ nodes, edges });
}

export interface RunInput {
  seed?: number;
  /** How long clients send for, in simulated milliseconds. */
  sendMs: number;
  /** Extra simulated time with no new traffic, to let everything in flight finish. */
  drainMs?: number;
  workload?: WorkloadInput;
}

/** Runs a design and returns the simulation together with its report. */
export function run(target: Design, input: RunInput): { sim: Simulation; report: Report } {
  const phases = [...(input.workload?.phases ?? [])];
  const drainMs = input.drainMs ?? 0;
  if (drainMs > 0) phases.push({ atMs: input.sendMs, multiplier: 0 });
  const sim = createSimulation(target, { seed: input.seed ?? 1, workload: workloadSchema.parse({ phases }) });
  sim.advance(input.sendMs + drainMs);
  return { sim, report: buildReport(sim) };
}

export const exp = (mean: number): Dist => ({ kind: 'exp', mean });
export const fixed = (mean: number): Dist => ({ kind: 'const', mean });

/** Asserts closeness as a fraction of the expected value. */
export function relativeError(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.abs(expected);
}
