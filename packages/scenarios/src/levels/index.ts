import type { Scenario } from '../types.ts';
import { blackFriday } from './black-friday.ts';
import { clockwork } from './clockwork.ts';
import { coldStart } from './cold-start.ts';
import { failover } from './failover.ts';
import { firstTraffic } from './first-traffic.ts';
import { fullHouse } from './full-house.ts';
import { heavyLifting } from './heavy-lifting.ts';
import { luckOfTheDraw } from './luck-of-the-draw.ts';
import { neverTwice } from './never-twice.ts';
import { nineTimes } from './nine-times.ts';
import { nodeDown } from './node-down.ts';
import { patience } from './patience.ts';
import { poolParty } from './pool-party.ts';
import { readHeavy } from './read-heavy.ts';
import { retryStorm } from './retry-storm.ts';
import { slowDependency } from './slow-dependency.ts';
import { stampede } from './stampede.ts';
import { theBill } from './the-bill.ts';
import { writeBurst } from './write-burst.ts';
import { wrongSuspect } from './wrong-suspect.ts';

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
  luckOfTheDraw,
  patience,
  fullHouse,
  neverTwice,
  clockwork,
  nineTimes,
  wrongSuspect,
  failover,
  heavyLifting,
  coldStart,
];

export function findLevel(id: string): Scenario | undefined {
  return LEVELS.find((level) => level.id === id);
}
