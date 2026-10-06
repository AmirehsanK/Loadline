import { at, design, workload } from '../build.ts';
import type { Link } from '../build.ts';
import type { Scenario } from '../types.ts';

interface Shape {
  /** How long the CDN keeps a file. */
  ttlMs?: number;
  /** Whether the CDN fetches files from storage itself, instead of asking the site for them. */
  direct?: boolean;
  instances?: number;
}

// 600 a second, three in four for a picture. There are far more pictures than are asked for in any
// one minute, so however long the CDN keeps them there are always some it does not hold.
const users = at(0, 1, {
  id: 'users',
  type: 'client',
  name: 'Visitors',
  params: { rps: 600, fileRatio: 0.75, readRatio: 1, keys: 20_000, skew: 0.9 },
} as const);
const images = at(4, 0, {
  id: 'bucket',
  type: 'object-store',
  name: 'Images',
  params: { readTime: { kind: 'lognormal', mean: 40, cv: 1 } },
} as const);

/** The shop, with the CDN keeping files for `ttlMs` and fetching them through the site or directly. */
export const site = ({ ttlMs = 2000, direct = false, instances = 2 }: Shape = {}) => {
  const straight: Link[] = direct ? [['cdn', 'bucket', { appliesTo: 'file', timeoutMs: 1000 }]] : [];
  return design(
    'Heavy lifting',
    [
      users,
      at(1, 1, { id: 'cdn', type: 'cdn', name: 'CDN', params: { capacity: 20_000, ttlMs } }),
      at(2, 1, { id: 'lb', type: 'load-balancer', name: 'Balancer' }),
      at(3, 1, {
        id: 'api',
        type: 'service',
        name: 'Site',
        params: { instances, concurrency: 8, queue: 64, serviceTime: { kind: 'exp', mean: 12 } },
      }),
      images,
    ],
    [
      ['users', 'cdn', { timeoutMs: 2000 }],
      ['cdn', 'lb', { timeoutMs: 1500 }],
      ['lb', 'api'],
      ['api', 'bucket', { appliesTo: 'file', timeoutMs: 1000 }],
      ...straight,
    ],
  );
};

export const heavyLifting: Scenario = {
  id: 'heavy-lifting',
  text: {
    title: 'Heavy lifting',
    summary: 'Three requests in four are for a picture, and the site fetches every one.',
    brief:
      'A shop gets 600 requests a second, and three in four are for a picture. There is a CDN at the door, but it keeps a ' +
      'picture for two seconds, and what it does not hold it asks the site for, which fetches it from storage while the visitor ' +
      'waits. A minute in, a release empties the CDN. Keep 99% of requests under 200 ms and failures under 1%, for no more than ' +
      '$130 a month, which is what it costs now.',
    hints: [
      'Look at the gauge on Site. A picture is 12 ms of its own work and then a wait for Images, and it holds a slot the whole time.',
      'The CDN can fetch from Images itself. Draw a connection from CDN to Images and set "Used by" to "Files only". Pictures then never reach the site, whether the CDN holds them or not.',
      'With the pictures gone, Site has an instance it does not need. And a picture does not change every two seconds: set "Keep each file for" on the CDN to 300,000 ms, which is five minutes.',
    ],
    debrief:
      'A file is the same for everyone who asks, so nothing that thinks has to be involved in handing it over. The site was ' +
      'spending nearly all of its slots waiting for storage. Keeping files longer at the CDN helps, until the moment the CDN ' +
      'does not have them: after a release, after a restart, or just for the long tail of pictures nobody has asked for lately. ' +
      'Then everything it does not hold arrives at once at whatever it fetches from. Storage has no slots to run out of and ' +
      'does not notice. A service does. So the lasting fix is where the CDN fetches from, and how long it keeps things is the ' +
      'polish: the slowest requests left are the files it had to go and get, and the longer it keeps them the fewer of those ' +
      'there are. The instance you took away is what the pictures were costing.',
  },
  starter: site(),
  reference: site({ direct: true, ttlMs: 300_000, instances: 1 }),
  palette: [],
  // The release: every file the CDN holds has a new name, so it holds nothing.
  workload: workload({ chaos: [{ atMs: 60_000, command: { type: 'flush', nodeId: 'cdn' } }] }),
  durationMs: 100_000,
  warmupMs: 15_000,
  seed: 1919,
  objectives: [
    { kind: 'p99', maxMs: 200 },
    { kind: 'errors', maxRate: 0.01 },
    { kind: 'cost', maxMonthly: 130 },
  ],
  // Fetching from storage passes. The stars are for what that makes possible: an instance fewer,
  // and files kept long enough that few have to be fetched at all.
  bonus: [[{ kind: 'cost', maxMonthly: 95 }], [{ kind: 'p99', maxMs: 130 }]],
  locked: {
    users: '*',
    bucket: '*',
    api: ['concurrency', 'queue', 'serviceTime', 'autoscale'],
    // A picture that reaches the site has to be fetched; cutting this would hand it over from nowhere.
    'api--bucket': '*',
  },
};
