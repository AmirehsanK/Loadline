import type { Design } from '@loadline/engine';
import { at, design, workload } from '../build.ts';
import type { Link, NodeInput } from '../build.ts';
import type { Scenario } from '../types.ts';

// 300 requests a second; one in ten is a purchase, which writes.
const users = at(0, 1, { id: 'users', type: 'client', name: 'Customers', params: { rps: 300, readRatio: 0.9 } } as const);
const api = at(1, 1, {
  id: 'api',
  type: 'service',
  name: 'Shop',
  params: { concurrency: 64, queue: 128, serviceTime: { kind: 'const', mean: 2 } },
} as const);
// Eight cores: far more than this load needs. What it lacks is a second server.
// With a queue and a worker in the design, the database sits to their right, so that every call
// is drawn going the same way.
const db = (replicas: number, column = 3, row = 1) =>
  at(column, row, {
    id: 'db',
    type: 'database',
    name: 'Database',
    params: {
      concurrency: 8,
      maxConnections: 500,
      replicas,
      readTime: { kind: 'exp', mean: 10 },
      writeTime: { kind: 'exp', mean: 15 },
      failoverMs: 15_000,
    },
  } as const);
/** What a worker that writes purchases down does for each one, apart from the write itself. */
const WRITING = { kind: 'const', mean: 5 } as const;

export interface Standby {
  replicas?: number;
  /**
   * Purchases go to a queue and a worker writes them down, instead of the shop writing them itself.
   * The policy is the worker's on its calls to the database.
   */
  queued?: NonNullable<Link[2]>;
  workers?: number;
  /** The shop's own policy on its calls to the database. */
  direct?: NonNullable<Link[2]>;
}

/** The shop with a number of replicas, and with purchases written directly or through a queue. */
export const standby = ({ replicas = 0, queued, workers = 1, direct = {} }: Standby) => {
  const nodes: NodeInput[] = [users, api, queued ? db(replicas, 4, 1.5) : db(replicas)];
  const links: Link[] = [
    ['users', 'api', { timeoutMs: 2000 }],
    ['api', 'db', { timeoutMs: 1000, poolSize: 9, ...(queued ? { appliesTo: 'read' } : {}), ...direct }],
  ];
  if (queued) {
    nodes.push(
      at(2, 2, { id: 'jobs', type: 'queue', name: 'Purchases' }),
      at(3, 2, { id: 'writer', type: 'worker', name: 'Writer', params: { instances: workers, concurrency: 4, serviceTime: WRITING } }),
    );
    links.push(['api', 'jobs', { appliesTo: 'write', mode: 'async' }], ['jobs', 'writer'], ['writer', 'db', { timeoutMs: 1000, ...queued }]);
  }
  return design('Failover', nodes, links);
};

/** Every purchase must reach the database: written by the shop, or by a worker reading a queue. */
function purchasesAreStored(target: Design): string[] {
  const writes = (id: string) => target.edges.filter((edge) => edge.from === id && edge.params.appliesTo !== 'read');
  const typeOf = (id: string) => target.nodes.find((node) => node.id === id)?.type;
  const stored = writes('api').some((edge) => {
    if (edge.to === 'db') return true;
    if (typeOf(edge.to) !== 'queue') return false;
    return writes(edge.to).some((next) => typeOf(next.to) === 'worker' && writes(next.to).some((last) => last.to === 'db'));
  });
  return stored ? [] : ['purchases-stored'];
}

export const failover: Scenario = {
  id: 'failover',
  text: {
    title: 'Failover',
    summary: 'The only database server dies, and takes fifteen seconds to come back.',
    brief:
      'The shop has one database server. Twenty seconds in it fails, and the database takes fifteen seconds to be usable again: ' +
      'fifteen seconds in which nobody can browse and nobody can buy. Make the shop ride through it. ' +
      'Keep failures under 0.5% and 99% of requests under 200 ms, lose no purchase, have every purchase written down by the ' +
      'end, and spend no more than $500 a month.',
    hints: [
      'Two things stop when the server fails: reading and writing. A read replica is a second server. What can it do while the first is gone, and what can it not?',
      'With a replica, browsing survives and purchases still fail for fifteen seconds. Does the customer need the purchase written down before being answered, or only to know that it will be? Think of Write burst.',
      'Give the Database a read replica. Send purchases to a Queue and have a Worker write them to the database, and use the shop\'s own connection to the database for reads only. Then make the worker patient: on its connection to the database, several retries with a second or more between them.',
    ],
    debrief:
      'One server is a single point of failure, however large. A replica is a second copy that can answer reads at once and ' +
      'take over as primary, so browsing never noticed. Writing is different: while a new primary is being chosen there is ' +
      'nowhere to write, replica or not. What saved the purchases was not having to write them at that moment. The queue took ' +
      'each one and answered the customer, and the worker wrote them down when it could. The worker had to be patient. One ' +
      'that fails and tries again at once goes through every chance a purchase has in a few milliseconds, and then drops it. ' +
      'Waiting between tries, longer each time, is what carried each purchase across the fifteen seconds. In Retry storm ' +
      'waiting between retries did not help, because users were waiting and the work only grew. Here nobody is waiting, so waiting is free.',
    rules: {
      'purchases-stored': 'Every purchase has to reach the database: the shop must write it there itself, or hand it to a queue whose worker writes it there.',
    },
  },
  starter: standby({}),
  reference: standby({ replicas: 1, queued: { retries: 5, backoffMs: 1000, backoffFactor: 2 } }),
  palette: ['queue', 'worker'],
  workload: workload({ chaos: [{ atMs: 20_000, command: { type: 'failover', nodeId: 'db' } }] }),
  durationMs: 90_000,
  warmupMs: 10_000,
  seed: 1818,
  objectives: [
    { kind: 'errors', maxRate: 0.005 },
    { kind: 'lost', max: 0 },
    { kind: 'backlog', maxDepth: 50 },
    { kind: 'p99', maxMs: 200 },
    { kind: 'cost', maxMonthly: 500 },
  ],
  bonus: [[{ kind: 'cost', maxMonthly: 450 }], [{ kind: 'p99', maxMs: 100 }]],
  locked: {
    users: '*',
    api: ['instances', 'concurrency', 'serviceTime', 'autoscale.enabled'],
    db: ['concurrency', 'maxConnections', 'readTime', 'writeTime', 'failoverMs'],
    'api--db': [],
  },
  added: { worker: { serviceTime: WRITING, concurrency: 4, failureRate: 0 } },
  rules: purchasesAreStored,
};
