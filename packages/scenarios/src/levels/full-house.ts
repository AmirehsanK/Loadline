import { at, design, workload } from '../build.ts';
import type { Scenario } from '../types.ts';

const users = at(0, 1, { id: 'users', type: 'client', name: 'Fans', params: { rps: 150 } } as const);
// Ten at a time, 40 ms each: 250 a second, and that is all there is.
const api = (column: number) =>
  at(column, 1, {
    id: 'api',
    type: 'service',
    name: 'Tickets',
    params: { concurrency: 10, queue: 256, serviceTime: { kind: 'exp', mean: 40 } },
  } as const);

/** The system with a limiter at the door that lets `rate` calls through a second. */
export const door = (rate: number, burst = 20) =>
  design(
    'Full house',
    [users, at(1, 1, { id: 'door', type: 'rate-limiter', name: 'Door', params: { rate, burst } }), api(2)],
    [
      ['users', 'door', { timeoutMs: 3000 }],
      ['door', 'api'],
    ],
  );

export const fullHouse: Scenario = {
  id: 'full-house',
  text: {
    title: 'Full house',
    summary: 'Three times the crowd the room can hold.',
    brief:
      'Tickets go on sale and 450 people a second arrive, for forty seconds. The ticket service can serve 250 a second, and ' +
      'today it cannot be made bigger. Many will be turned away whatever you do. As it is, those who do get in wait over a second. ' +
      'Keep 99% of the requests you answer under 300 ms, and turn away no more than 45% of all requests.',
    hints: [
      'Watch the waiting on Tickets during the sale. Everyone who gets in joins the back of a full waiting room.',
      'If some must be turned away, it is kinder to do it at the door, at once, than after a second in the queue. A rate limiter is a door.',
      'Put a Rate limiter between Fans and Tickets and let through a little less than Tickets can serve. Lower its burst too: that is how many it lets rush in at once after a quiet spell.',
    ],
    debrief:
      'The service was never going to serve 450 a second. Left alone it still turned 200 a second away, but only once they had ' +
      'filled its waiting room, so everyone it did serve had first stood in a queue of 256. A limiter at the door turns the ' +
      'same people away at once, and the room stays clear. How strict to make it is the whole question. At exactly what the ' +
      'room holds, 250, it is full all the time and the queue comes back. A little under, and those inside are served as they ' +
      'arrive. Much under, and you turn people away for nothing. The burst matters for the same reason: a hundred let in ' +
      'together at the start of the sale is a queue the room spends seconds clearing.',
  },
  starter: design('Full house', [users, api(1)], [['users', 'api', { timeoutMs: 3000 }]]),
  reference: door(230),
  palette: ['rate-limiter'],
  workload: workload({ phases: [{ atMs: 20_000, multiplier: 3 }, { atMs: 60_000, multiplier: 1 }] }),
  durationMs: 80_000,
  warmupMs: 10_000,
  seed: 1313,
  objectives: [
    { kind: 'p99', maxMs: 300 },
    { kind: 'errors', maxRate: 0.45 },
  ],
  // The answers are as fast as they will get well before the door is strict. The stars are for
  // turning away no more people than that takes.
  bonus: [[{ kind: 'errors', maxRate: 0.425 }], [{ kind: 'errors', maxRate: 0.405 }]],
  locked: {
    users: '*',
    api: '*',
  },
};
