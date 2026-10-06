import { at, design, workload } from '../build.ts';
import type { Link, NodeInput } from '../build.ts';
import type { Scenario } from '../types.ts';

const users = at(0, 1, { id: 'users', type: 'client', name: 'Users', params: { rps: 300 } } as const);

export interface Sizes {
  /** Instances of the web tier; more than one stands behind a balancer. */
  web?: number;
  webSlots?: number;
  api?: number;
  /** Queries the database runs at full speed at once. */
  cores?: number;
  replicas?: number;
  /** Connections each API instance may hold to the database. */
  pool?: number;
}

/**
 * Three tiers in a row. The database runs a query in 16 ms, so four cores do 250 a second: less
 * than the 300 that arrive, and it is the web tier at the front that shows it.
 */
export const tiers = ({ web = 1, webSlots = 40, api = 1, cores = 4, replicas = 0, pool = 5 }: Sizes) => {
  const nodes: NodeInput[] = [users];
  const links: Link[] = [];
  const service = (id: string, name: string, column: number, instances: number, concurrency: number, mean: number): NodeInput =>
    at(column, 1, { id, type: 'service', name, params: { instances, concurrency, queue: 64, serviceTime: { kind: 'const', mean } } });
  // A tier with more than one instance gets a balancer in front, as the lint asks.
  const tier = (id: string, name: string, column: number, instances: number, concurrency: number, mean: number, from: string, policy: NonNullable<Link[2]>) => {
    if (instances > 1) {
      nodes.push(at(column - 0.5, 0, { id: `${id}-lb`, type: 'load-balancer', name: `${name} balancer`, params: { healthCheckMs: 1000 } }));
      links.push([from, `${id}-lb`, policy], [`${id}-lb`, id]);
    } else {
      links.push([from, id, policy]);
    }
    nodes.push(service(id, name, column, instances, concurrency, mean));
  };
  tier('web', 'Web', 1, web, webSlots, 2, 'users', { timeoutMs: 2000 });
  tier('api', 'API', 2, api, 32, 3, 'web', { timeoutMs: 1500 });
  nodes.push(
    at(3, 1, {
      id: 'db',
      type: 'database',
      name: 'Database',
      params: { concurrency: cores, maxConnections: 500, replicas, readTime: { kind: 'const', mean: 16 }, writeTime: { kind: 'const', mean: 16 } },
    }),
  );
  links.push(['api', 'db', { timeoutMs: 1000, poolSize: pool }]);
  return design('Wrong suspect', nodes, links);
};

export const wrongSuspect: Scenario = {
  id: 'wrong-suspect',
  text: {
    title: 'Wrong suspect',
    summary: 'The part that turns requests away is not the part that is short.',
    brief:
      'A quarter of all requests are being turned away, and it is Web, at the front, that turns them away: its gauge is at the ' +
      'top and its waiting room is full. The obvious thing is to give Web more room. Before you do, find out what Web is waiting for. ' +
      'Keep 99% of requests under 200 ms and failures under 1%, for no more than $400 a month.',
    hints: [
      'Read "Where the time goes" under the canvas while it runs. Which part does it name?',
      'Web is full of requests waiting for the API, and the API is full of requests waiting for the database. The database can run 250 queries a second, and 300 arrive.',
      'Select the Database and give it six cores instead of four. Then let the API use them: raise its connections to the database from 5 to 7.',
    ],
    debrief:
      'Web was full, and Web was fine. Every one of its slots held a request waiting for the API, and every slot of the API ' +
      'held one waiting for the database, which had four cores for work that needed five. The shortage was at the back and the ' +
      'pain showed at the front, because a call holds its place all the way up the chain while it waits. More room at the ' +
      'front would only have let more requests in to wait, and more API instances would have opened more connections and ' +
      'slowed the database further. Follow the waiting to where the time is really spent. And when you make that part bigger, ' +
      'check what limits its callers: with the pool left at five, a core would have stood idle and the rest would not have been enough.',
  },
  starter: tiers({}),
  reference: tiers({ cores: 6, pool: 7 }),
  palette: ['load-balancer'],
  workload: workload({}),
  durationMs: 70_000,
  warmupMs: 10_000,
  seed: 1717,
  objectives: [
    { kind: 'p99', maxMs: 200 },
    { kind: 'errors', maxRate: 0.01 },
    { kind: 'cost', maxMonthly: 400 },
  ],
  bonus: [[{ kind: 'cost', maxMonthly: 365 }], [{ kind: 'p99', maxMs: 100 }]],
  locked: {
    users: '*',
    web: ['serviceTime', 'autoscale.enabled'],
    api: ['serviceTime', 'autoscale.enabled'],
    db: ['readTime', 'writeTime'],
  },
};
