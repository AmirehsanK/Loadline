import { buildReport, hashReport } from '@loadline/engine';
import { LEVELS, startScenario } from '@loadline/scenarios';
import { run } from '../../packages/engine/test/helpers.ts';
import { referenceRun, storefront } from '../../packages/engine/test/reference.ts';

// The runs that Node and each browser must agree on, to the last bit of the report. This file is
// loaded by both: by Node as it is, and by the page through the dev server.
//
// The reference system is the one golden.test.ts records. It has every kind of part and every edge
// policy, and its bad day has four kinds of fault. The levels add what it lacks: autoscaling, a
// stampede, and traffic that ramps.

/** Each run by name, with a function that makes it and returns the hash of its whole report. */
export const RUNS = [
  ['the reference system', () => hashReport(run(storefront, referenceRun).report)],
  ...LEVELS.map((level) => [
    `level ${level.id}`,
    () => {
      const sim = startScenario(level, level.reference);
      sim.advance(level.durationMs);
      return hashReport(buildReport(sim));
    },
  ]),
];
