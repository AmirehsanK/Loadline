import type { Scenario } from '../types.ts';
import { blackFriday } from './black-friday.ts';
import { firstTraffic } from './first-traffic.ts';
import { nodeDown } from './node-down.ts';
import { poolParty } from './pool-party.ts';
import { readHeavy } from './read-heavy.ts';
import { retryStorm } from './retry-storm.ts';
import { slowDependency } from './slow-dependency.ts';
import { stampede } from './stampede.ts';
import { theBill } from './the-bill.ts';
import { writeBurst } from './write-burst.ts';

/** The levels, in the order they are played. Each builds on what the ones before it taught. */
export const LEVELS: readonly Scenario[] = [
  firstTraffic,
  readHeavy,
  poolParty,
  slowDependency,
  retryStorm,
  writeBurst,
  stampede,
  blackFriday,
  nodeDown,
  theBill,
];

export function findLevel(id: string): Scenario | undefined {
  return LEVELS.find((level) => level.id === id);
}
