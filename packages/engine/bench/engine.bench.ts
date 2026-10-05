// Measures how fast the engine processes events. Run with: npm run bench -w @loadline/engine
//
// The budget (docs/SPEC.md §4.4) is one million events per second. "Speed" is how much faster than
// real time the scenario runs; a level can only be played at 1x if its speed here is above 1.

import { performance } from 'node:perf_hooks';
import { buildReport, createSimulation, designSchema } from '../src/index.ts';
import type { DesignInput } from '../src/index.ts';

interface Scenario {
  name: string;
  simulatedMs: number;
  design: DesignInput;
}

const scenarios: Scenario[] = [
  {
    name: 'one service, 20k rps',
    simulatedMs: 30_000,
    design: {
      nodes: [
        { id: 'users', type: 'client', params: { rps: 20_000 } },
        { id: 'api', type: 'service', params: { concurrency: 64, queue: 1000, serviceTime: { kind: 'exp', mean: 2 } } },
      ],
      edges: [{ id: 'users-api', from: 'users', to: 'api', params: { timeoutMs: 1000 } }],
    },
  },
  {
    name: 'three services in a chain, 10k rps',
    simulatedMs: 30_000,
    design: {
      nodes: [
        { id: 'users', type: 'client', params: { rps: 10_000 } },
        { id: 'web', type: 'service', params: { concurrency: 512, serviceTime: { kind: 'lognormal', mean: 3, cv: 1 } } },
        { id: 'api', type: 'service', params: { concurrency: 256, serviceTime: { kind: 'exp', mean: 4 } } },
        { id: 'store', type: 'service', params: { concurrency: 64, serviceTime: { kind: 'exp', mean: 5 } } },
      ],
      edges: [
        { id: 'users-web', from: 'users', to: 'web', params: { timeoutMs: 2000, retries: 1 } },
        { id: 'web-api', from: 'web', to: 'api', params: { timeoutMs: 1000 } },
        { id: 'api-store', from: 'api', to: 'store', params: { timeoutMs: 500, retries: 1, jitter: 1 } },
      ],
    },
  },
  {
    name: 'overloaded, with a retry storm, 5k rps',
    simulatedMs: 30_000,
    design: {
      nodes: [
        { id: 'users', type: 'client', params: { rps: 5000 } },
        { id: 'api', type: 'service', params: { concurrency: 256, queue: 2000, serviceTime: { kind: 'exp', mean: 2 } } },
        { id: 'store', type: 'service', params: { concurrency: 16, queue: 5000, serviceTime: { kind: 'exp', mean: 4 } } },
      ],
      edges: [
        { id: 'users-api', from: 'users', to: 'api', params: { timeoutMs: 400, retries: 3, backoffMs: 50 } },
        { id: 'api-store', from: 'api', to: 'store', params: { timeoutMs: 300, retries: 2, backoffMs: 20 } },
      ],
    },
  },
];

const pad = (text: string | number, width: number) => String(text).padStart(width);

console.log(`${'scenario'.padEnd(42)}${pad('events', 12)}${pad('ms', 8)}${pad('events/s', 12)}${pad('speed', 8)}`);
for (const scenario of scenarios) {
  const design = designSchema.parse(scenario.design);
  // One short run first, so the measured one is not paying for compilation.
  createSimulation(design, { seed: 1 }).advance(2000);

  const sim = createSimulation(design, { seed: 1 });
  const started = performance.now();
  sim.advance(scenario.simulatedMs);
  const elapsed = performance.now() - started;
  const report = buildReport(sim);

  console.log(
    scenario.name.padEnd(42) +
      pad(report.events, 12) +
      pad(elapsed.toFixed(0), 8) +
      pad(Math.round((report.events / elapsed) * 1000).toLocaleString('en-US'), 12) +
      pad(`${(scenario.simulatedMs / elapsed).toFixed(1)}x`, 8),
  );
}
