import type { Design } from './model/schema.ts';

/**
 * What each part costs to run, in dollars a month.
 *
 * These are made-up prices, not any provider's list. They only have to be consistent, so that a
 * budget means the same thing in every level and never goes out of date. Their shape is the
 * realistic part: an instance has a fixed cost before it does anything, so a few large ones are
 * cheaper than many small ones, and a spare for redundancy is never free.
 */
export const PRICES = {
  /** A service or worker instance, plus so much for each call it can handle at once. */
  instance: 15,
  slot: 3,
  /** A database server (the primary or a replica), plus so much for each query it runs at full speed. */
  databaseServer: 40,
  databaseCore: 12,
  /** A cache, plus so much per thousand items of capacity. */
  cache: 10,
  cachePerThousand: 2,
  loadBalancer: 20,
  rateLimiter: 10,
  queue: 15,
  cdn: 25,
  objectStore: 5,
  /**
   * A function has no fixed cost. It is charged for the time its environments spend on calls,
   * waiting on a dependency included: this much for one environment busy all month. That is several
   * times what a slot of an instance costs, which is the trade: nothing when idle, dear when busy.
   */
  functionBusy: 24,
  /** An environment kept ready, used or not. */
  functionProvisioned: 6,
} as const;

export const instancePrice = (concurrency: number): number => PRICES.instance + PRICES.slot * concurrency;

export const databaseServerPrice = (concurrency: number): number =>
  PRICES.databaseServer + PRICES.databaseCore * concurrency;

export const cachePrice = (capacity: number): number => PRICES.cache + (PRICES.cachePerThousand * capacity) / 1000;

/**
 * What a design costs as it stands, before it has run: the price of each part as it is set up.
 * A run starts at this figure. It can end at another, because a service that scales is charged
 * for the instances that were actually running.
 *
 * The page shows this until the run has something to say. Without it there is a moment, while the
 * worker loads, in which a design that costs money appears to cost nothing.
 */
export function designMonthlyCost(design: Design): number {
  let total = 0;
  for (const node of design.nodes) {
    switch (node.type) {
      case 'service':
      case 'worker':
        total += node.params.instances * instancePrice(node.params.concurrency);
        break;
      case 'database':
        total += (node.params.replicas + 1) * databaseServerPrice(node.params.concurrency);
        break;
      case 'cache':
        total += cachePrice(node.params.capacity);
        break;
      case 'load-balancer':
        total += PRICES.loadBalancer;
        break;
      case 'rate-limiter':
        total += PRICES.rateLimiter;
        break;
      case 'queue':
        total += PRICES.queue;
        break;
      case 'cdn':
        total += PRICES.cdn;
        break;
      case 'object-store':
        total += PRICES.objectStore;
        break;
      case 'function':
        total += node.params.provisioned * PRICES.functionProvisioned;
        break;
      case 'client':
        break;
    }
  }
  return total;
}
