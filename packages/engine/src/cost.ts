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
} as const;

export const instancePrice = (concurrency: number): number => PRICES.instance + PRICES.slot * concurrency;

export const databaseServerPrice = (concurrency: number): number =>
  PRICES.databaseServer + PRICES.databaseCore * concurrency;

export const cachePrice = (capacity: number): number => PRICES.cache + (PRICES.cachePerThousand * capacity) / 1000;
