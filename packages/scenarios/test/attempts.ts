import type { Design } from '@loadline/engine';
import { shop as blackFriday } from '../src/levels/black-friday.ts';
import { priced } from '../src/levels/clockwork.ts';
import { standby } from '../src/levels/failover.ts';
import { fleet } from '../src/levels/first-traffic.ts';
import { door } from '../src/levels/full-house.ts';
import { balanced } from '../src/levels/luck-of-the-draw.ts';
import { copies } from '../src/levels/never-twice.ts';
import { layered } from '../src/levels/nine-times.ts';
import { system as nodeDown } from '../src/levels/node-down.ts';
import { hasty, searching } from '../src/levels/patience.ts';
import { pooled } from '../src/levels/pool-party.ts';
import { cached } from '../src/levels/read-heavy.ts';
import { impatient, system as retryStorm } from '../src/levels/retry-storm.ts';
import { shop as slowDependency } from '../src/levels/slow-dependency.ts';
import { catalog } from '../src/levels/stampede.ts';
import { system as theBill } from '../src/levels/the-bill.ts';
import { queued } from '../src/levels/write-burst.ts';
import { tiers } from '../src/levels/wrong-suspect.ts';

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
    ['a queue and three', queued(3), 2],
    ['a queue and four', queued(4), 1],
    ['a queue and five', queued(5), 0],
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
  'luck-of-the-draw': [
    ['taking turns', balanced('round-robin'), 1],
    ['the less busy of two picked at random', balanced('two-choices'), 2],
    ['the least busy of all', balanced('least-connections'), 3],
  ],
  patience: [
    ['no retries, the timeout left at 100 ms', searching({ ...hasty, retries: 0 }), 0],
    ['a timeout of 150 ms', searching({ ...hasty, timeoutMs: 150 }), 0],
    ['a timeout of 250 ms', searching({ ...hasty, timeoutMs: 250 }), 3],
    ['a timeout of 300 ms', searching({ ...hasty, timeoutMs: 300 }), 3],
    ['a timeout of 400 ms', searching({ ...hasty, timeoutMs: 400 }), 2],
    ['a timeout of 500 ms', searching({ ...hasty, timeoutMs: 500 }), 1],
    ['a timeout of one second', searching({ ...hasty, timeoutMs: 1000 }), 1],
    ['a timeout of three seconds', searching({ ...hasty, timeoutMs: 3000 }), 1],
    // Cutting the slow answers off only helps if somebody asks again.
    ['300 ms and no retries', searching({ timeoutMs: 300, retries: 0 }), 0],
    ['300 ms and one retry', searching({ timeoutMs: 300, retries: 1, backoffMs: 0 }), 3],
    ['300 ms, waiting a tenth of a second before each retry', searching({ ...hasty, timeoutMs: 300, backoffMs: 100, backoffFactor: 1 }), 2],
  ],



  'full-house': [
    ['a door that lets 300 a second through', door(300), 0],
    ['250, exactly what the room holds', door(250), 0],
    ['230', door(230), 3],
    ['220', door(220), 2],
    ['210', door(210), 1],
    ['190', door(190), 0],
    ['150', door(150), 0],
    // A hundred rush in when the surge starts, and the room spends seconds clearing them.
    ['230 and a burst of 100', door(230, 100), 0],
    ['230 and a burst of 5', door(230, 5), 3],
  ],


  'never-twice': [
    ['a cache of 10,000 items', copies({ replicas: 0, cache: 10_000 }), 0],
    ['a pool of 5 and nothing else', copies({ replicas: 0, pool: 5 }), 0],
    ['one replica', copies({ replicas: 1 }), 0],
    ['one replica and a pool of 9', copies({ replicas: 1, pool: 9 }), 0],
    ['two replicas and no pool', copies({ replicas: 2 }), 0],
    ['two replicas and a pool of 5', copies({ replicas: 2, pool: 5 }), 0],
    ['two replicas and a pool of 6', copies({ replicas: 2, pool: 6 }), 1],
    ['two replicas and a pool of 10', copies({ replicas: 2, pool: 10 }), 3],
    ['two replicas and a pool of 16', copies({ replicas: 2, pool: 16 }), 3],
    ['two replicas and a pool of 32', copies({ replicas: 2, pool: 32 }), 0],
    ['three replicas and a pool of 10', copies({ replicas: 3, pool: 10 }), 0],
  ],


  clockwork: [
    ['lifetimes randomised by a hundredth', priced({ jitter: 0.01 }), 0],
    ['by a fiftieth', priced({ jitter: 0.02 }), 0],
    ['by a tenth', priced({ jitter: 0.1 }), 3],
    ['by a fifth', priced({ jitter: 0.2 }), 3],
    // Prices now live fifteen seconds on average instead of nineteen, and are fetched that much more often.
    ['by half', priced({ jitter: 0.5 }), 2],
    ['by seven tenths', priced({ jitter: 0.7 }), 1],
    ['altogether', priced({ jitter: 1 }), 1],
  ],




  'nine-times': [
    ['no retries anywhere', layered(0, 0), 0],
    ['none at the edge and two inside', layered(0, 2), 3],
    ['none at the edge and one inside', layered(0, 1), 3],
    ['two at the edge and none inside', layered(2, 0), 2],
    ['one at the edge and none inside', layered(1, 0), 2],
    ['two inside, a tenth of a second apart', layered(0, 2, {}, { backoffMs: 100, backoffFactor: 1 }), 1],
    ['one at each layer', layered(1, 1), 0],
    ['two at the edge and one inside', layered(2, 1), 0],
    ['two at each, waiting between them', layered(2, 2, { backoffMs: 200, jitter: 1 }, { backoffMs: 100, jitter: 1 }), 0],
    ['two at each, and a breaker inside', layered(2, 2, {}, { breaker: { enabled: true, window: 20, openMs: 2000 } }), 3],
  ],

  'wrong-suspect': [
    ['twice the slots on Web', tiers({ webSlots: 80 }), 0],
    ['two Web instances behind a balancer', tiers({ web: 2 }), 0],
    ['two API instances behind a balancer', tiers({ api: 2 }), 0],
    ['a pool of 10', tiers({ pool: 10 }), 0],
    ['no pool', tiers({ pool: 0 }), 0],
    ['five cores and a pool of 6', tiers({ cores: 5, pool: 6 }), 0],
    ['six cores, the pool left at 5', tiers({ cores: 6 }), 0],
    ['six cores and a pool of 7', tiers({ cores: 6, pool: 7 }), 3],
    ['eight cores and a pool of 9', tiers({ cores: 8, pool: 9 }), 1],
    ['a read replica', tiers({ replicas: 1 }), 0],
  ],
  failover: [
    ['a replica and nothing else', standby({ replicas: 1 }), 0],
    // Each purchase holds a slot of the shop while it waits, and its customer has long since given up.
    ['a replica, and the shop retrying its own writes for half a minute', standby({ replicas: 1, direct: { retries: 5, backoffMs: 1000 } }), 0],
    ['a queue and a patient worker, and no replica', standby({ queued: { retries: 10, backoffMs: 2000, backoffFactor: 1 } }), 0],
    ['a replica and a queue, the worker not retrying', standby({ replicas: 1, queued: {} }), 0],
    ['the worker retrying five times at once', standby({ replicas: 1, queued: { retries: 5, backoffMs: 0 } }), 0],
    // It loses nothing, and is asleep in a sixteen-second wait when the database comes back.
    ['waits that double from one second, five times', standby({ replicas: 1, queued: { retries: 5, backoffMs: 1000 } }), 1],
    ['waits half as long again each time, from two seconds', standby({ replicas: 1, queued: { retries: 6, backoffMs: 2000, backoffFactor: 1.5 } }), 2],
    ['every two seconds, ten times', standby({ replicas: 1, queued: { retries: 10, backoffMs: 2000, backoffFactor: 1 } }), 3],
    ['every five seconds, five times', standby({ replicas: 1, queued: { retries: 5, backoffMs: 5000, backoffFactor: 1 } }), 3],
    ['two replicas', standby({ replicas: 2, queued: { retries: 10, backoffMs: 2000, backoffFactor: 1 } }), 0],
  ],



};
