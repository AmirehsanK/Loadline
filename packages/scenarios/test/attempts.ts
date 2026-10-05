import type { Design } from '@loadline/engine';
import { shop as blackFriday } from '../src/levels/black-friday.ts';
import { fleet } from '../src/levels/first-traffic.ts';
import { system as nodeDown } from '../src/levels/node-down.ts';
import { pooled } from '../src/levels/pool-party.ts';
import { cached } from '../src/levels/read-heavy.ts';
import { impatient, system as retryStorm } from '../src/levels/retry-storm.ts';
import { shop as slowDependency } from '../src/levels/slow-dependency.ts';
import { catalog } from '../src/levels/stampede.ts';
import { system as theBill } from '../src/levels/the-bill.ts';
import { queued } from '../src/levels/write-burst.ts';

/** Something a player might try on a level, and the stars it should earn; none means it fails. */
export type Attempt = [what: string, design: Design, stars: 0 | 1 | 2 | 3];

const breaker = { enabled: true, window: 20, openMs: 5000 };
const bill = { api: 2, cache: 5000, cores: 8, replicas: 0, workers: 2 };

/**
 * For each level, the answers it is meant to turn down and the ones it is meant to accept. This is
 * what a level teaches, written as a table: a change to the engine that moves a row has changed a
 * lesson, and the level's words have to be read again.
 */
export const ATTEMPTS: Record<string, Attempt[]> = {
  'first-traffic': [
    ['a second instance and nothing to share the calls', fleet(2, false), 0],
    ['a balancer in front of one instance', fleet(1, true), 0],
    ['a balancer and two instances', fleet(2, true), 3],
    ['a balancer and three instances', fleet(3, true), 1],
    ['a balancer and four instances', fleet(4, true), 0],
  ],
  'read-heavy': [
    ['a cache of 100 items', cached(100), 0],
    ['a cache of 500 items', cached(500), 3],
    ['a cache of 2,000 items', cached(2000), 3],
    // It works as well, and costs more than the second star allows.
    ['a cache of 5,000 items', cached(5000), 1],
  ],
  'pool-party': [
    ['a pool of 2', pooled(2), 0],
    ['a pool of 3', pooled(3), 0],
    ['a pool of 4', pooled(4), 2],
    ['a pool of 5', pooled(5), 3],
    ['a pool of 6', pooled(6), 3],
    ['a pool of 8', pooled(8), 2],
    ['a pool of 32', pooled(32), 0],
  ],
  'slow-dependency': [
    ['a timeout of one second', slowDependency({ timeoutMs: 1000 }), 0],
    ['a timeout of 800 ms', slowDependency({ timeoutMs: 800 }), 1],
    ['a timeout of 700 ms', slowDependency({ timeoutMs: 700 }), 2],
    ['a timeout of 300 ms', slowDependency({ timeoutMs: 300 }), 3],
    ['a timeout of 100 ms', slowDependency({ timeoutMs: 100 }), 3],
    // Payments answers in two seconds, so nothing fails and the breaker never opens.
    ['a breaker, with the timeout left at three seconds', slowDependency({ timeoutMs: 3000, breaker }), 0],
    ['a timeout of one second and a breaker', slowDependency({ timeoutMs: 1000, breaker }), 3],
    ['a timeout of 300 ms and a breaker', slowDependency({ timeoutMs: 300, breaker }), 3],
    // Each retry holds the slot for another 300 ms.
    ['a timeout of 300 ms and three retries', slowDependency({ timeoutMs: 300, retries: 3 }), 0],
  ],
  'retry-storm': [
    ['no retries', retryStorm(512, { timeoutMs: 150, retries: 0 }), 1],
    // Twice the traffic is still more than the API can do.
    ['one retry', retryStorm(512, { timeoutMs: 150, retries: 1 }), 0],
    ['waiting between retries, and nothing else', retryStorm(512, { ...impatient, backoffMs: 200, backoffFactor: 2, jitter: 1 }), 0],
    ['a waiting room of 8, still three retries', retryStorm(8, impatient), 3],
    ['a waiting room of 32', retryStorm(32, impatient), 3],
    ['a timeout of three seconds', retryStorm(512, { ...impatient, timeoutMs: 3000 }), 3],
    ['a breaker', retryStorm(512, { ...impatient, breaker: { ...breaker, openMs: 2000 } }), 3],
  ],
  'write-burst': [
    ['a queue and one worker instance', queued(1), 0],
    ['a queue and two', queued(2), 3],
    ['a queue and three', queued(3), 0],
    ['two, and a queue that holds only 500', queued(2, 500), 0],
  ],
  stampede: [
    ['a pool of 4 on the database, no single flight', catalog(false, 4), 0],
    ['a pool of 8, no single flight', catalog(false, 8), 1],
    ['a pool of 16, no single flight', catalog(false, 16), 0],
    ['single flight', catalog(true), 2],
    ['single flight and a pool of 8', catalog(true, 8), 3],
  ],
  'black-friday': [
    ['three instances all day', blackFriday({ instances: 3 }), 0],
    ['four instances all day', blackFriday({ instances: 4 }), 0],
    ['scaling as it comes, aiming for 80% busy', blackFriday({ scale: {} }), 0],
    ['scaling, aiming for 70%', blackFriday({ scale: { target: 0.7 } }), 0],
    ['scaling, aiming for 50%', blackFriday({ scale: { target: 0.5 } }), 1],
    ['scaling, aiming for 30%', blackFriday({ scale: { target: 0.3 } }), 2],
    ['scaling, aiming for 25%', blackFriday({ scale: { target: 0.25 } }), 0],
    ['scaling, aiming for 30%, at most 5 instances', blackFriday({ scale: { target: 0.3, max: 5 } }), 3],
    ['scaling, aiming for 50%, at most 5 instances', blackFriday({ scale: { target: 0.5, max: 5 } }), 1],
    ['scaling from three instances, aiming for 60%', blackFriday({ instances: 3, scale: { min: 3, target: 0.6 } }), 2],
  ],
  'node-down': [
    ['a third instance and nothing else', nodeDown({ instances: 3, healthCheckMs: 10_000, retries: 0 }), 0],
    ['three, checked every 5 s', nodeDown({ instances: 3, healthCheckMs: 5000, retries: 0 }), 0],
    ['three, checked every second', nodeDown({ instances: 3, healthCheckMs: 1000, retries: 0 }), 1],
    ['three, checked every 250 ms', nodeDown({ instances: 3, healthCheckMs: 250, retries: 0 }), 2],
    ['three, and a retry', nodeDown({ instances: 3, healthCheckMs: 10_000, retries: 1 }), 3],
    ['two, with fast checks and retries', nodeDown({ instances: 2, healthCheckMs: 1000, retries: 3 }), 0],
    ['four instances', nodeDown({ instances: 4, healthCheckMs: 1000, retries: 1 }), 0],
  ],
  'the-bill': [
    ['half of everything', theBill({ api: 4, cache: 25_000, cores: 16, replicas: 1, workers: 3 }), 1],
    ['a quarter of everything', theBill({ api: 2, cache: 12_500, cores: 8, replicas: 1, workers: 2 }), 2],
    ['each part at its size', theBill(bill), 3],
    ['one API instance', theBill({ ...bill, api: 1 }), 0],
    ['a database of four cores', theBill({ ...bill, cores: 4 }), 0],
    ['a database of six cores', theBill({ ...bill, cores: 6 }), 0],
    ['four cores and a replica', theBill({ ...bill, cores: 4, replicas: 1 }), 0],
    ['one mailer instance', theBill({ ...bill, workers: 1 }), 0],
    ['a cache of 500 items', theBill({ ...bill, cache: 500 }), 0],
    ['a cache of 2,000 items', theBill({ ...bill, cache: 2000 }), 3],
  ],
};
