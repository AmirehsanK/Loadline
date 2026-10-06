import { NODE_TYPES } from '@loadline/engine';
import { findLevel } from '@loadline/scenarios';
import type { Objective, Outcome, Scenario } from '@loadline/scenarios';
import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en.ts';
import { describeObjective, describeValue, isMeasured } from '../src/level/objectives.ts';
import { readProgress } from '../src/level/progress.ts';
import { allowedParts, canRemove, canRemoveEdge, forcedSettings, isLocked, lockedPaths } from '../src/level/rules.ts';
import { HOME, hrefOf, parseRoute, sameRoute } from '../src/route.ts';

function level(id: string): Scenario {
  const found = findLevel(id);
  if (!found) throw new Error(`no level "${id}"`);
  return found;
}

describe('routes', () => {
  it('are read from the fragment', () => {
    expect(parseRoute('')).toEqual(HOME);
    expect(parseRoute('#')).toEqual(HOME);
    expect(parseRoute('#/')).toEqual(HOME);
    expect(parseRoute('#/sandbox')).toEqual({ page: 'sandbox' });
    expect(parseRoute('#/level/pool-party')).toEqual({ page: 'level', id: 'pool-party' });
    expect(parseRoute('#level/pool-party/')).toEqual({ page: 'level', id: 'pool-party' });
    expect(parseRoute('#/guide')).toEqual({ page: 'guide', id: null });
    expect(parseRoute('#/guide/stampede')).toEqual({ page: 'guide', id: 'stampede' });
  });

  it('fall back to the home page for anything else', () => {
    for (const hash of ['#/nowhere', '#/level', '#/level/a/b', '#/sandbox/extra', '#/level/%E0%A4%A', '#/guide/a/b']) {
      expect(parseRoute(hash), hash).toEqual(HOME);
    }
  });

  it('survive the trip to a link and back', () => {
    const guides = [{ page: 'guide', id: null }, { page: 'guide', id: 'the-bill' }] as const;
    for (const route of [HOME, { page: 'sandbox' }, { page: 'level', id: 'the-bill' }, { page: 'level', id: 'a b/c' }, ...guides] as const) {
      expect(sameRoute(parseRoute(hrefOf(route)), route)).toBe(true);
    }
  });
});

describe('what a level lets the player change', () => {
  const firstTraffic = level('first-traffic');
  const writeBurst = level('write-burst');
  const stampede = level('stampede');

  it('is everything, in the sandbox', () => {
    expect(lockedPaths(null, 'api')).toEqual([]);
    expect(isLocked(null, 'api', 'concurrency')).toBe(false);
    expect(canRemove(null, 'api')).toBe(true);
    expect(allowedParts(null)).toEqual(NODE_TYPES);
    expect(forcedSettings(null, 'worker')).toEqual({});
  });

  it('leaves out the settings the level has locked, and everything on a part locked whole', () => {
    expect(isLocked(firstTraffic, 'api', 'concurrency', 'service')).toBe(true);
    expect(isLocked(firstTraffic, 'api', 'serviceTime', 'service')).toBe(true);
    expect(isLocked(firstTraffic, 'api', 'instances', 'service')).toBe(false);
    expect(isLocked(firstTraffic, 'api', 'queue', 'service')).toBe(false);
    expect(lockedPaths(firstTraffic, 'users', 'client')).toBe('*');
    expect(isLocked(firstTraffic, 'users', 'rps', 'client')).toBe(true);
  });

  it('treats a lock on a group and a lock inside a group as locks on both', () => {
    // `autoscale.enabled` is locked: the switch is, the group it belongs to is, its other settings are not.
    expect(isLocked(firstTraffic, 'api', 'autoscale.enabled', 'service')).toBe(true);
    expect(isLocked(firstTraffic, 'api', 'autoscale', 'service')).toBe(true);
    expect(isLocked(firstTraffic, 'api', 'autoscale.min', 'service')).toBe(false);
    // `serviceTime` is locked, so everything inside it is.
    expect(isLocked(firstTraffic, 'api', 'serviceTime.mean', 'service')).toBe(true);
  });

  it('keeps the parts the level names, and lets go of the ones it says may go', () => {
    expect(canRemove(firstTraffic, 'api')).toBe(false);
    expect(canRemove(firstTraffic, 'users')).toBe(false);
    // The connection is not named, so it can be redrawn through a balancer.
    expect(canRemove(firstTraffic, 'users--api')).toBe(true);
    expect(canRemove(writeBurst, 'ledger')).toBe(true);
    expect(canRemove(writeBurst, 'api')).toBe(false);
    expect(canRemove(stampede, 'api--db')).toBe(false);
    expect(canRemoveEdge(stampede, { id: 'api--db', source: 'api', target: 'db' })).toBe(false);
    expect(canRemoveEdge(writeBurst, { id: 'api--ledger', source: 'api', target: 'ledger' })).toBe(true);
  });

  it('lets the player do as they like with what they added, short of the settings its kind is given', () => {
    expect(canRemove(firstTraffic, 'load-balancer-1')).toBe(true);
    expect(lockedPaths(firstTraffic, 'load-balancer-1', 'load-balancer')).toEqual([]);
    expect(forcedSettings(writeBurst, 'worker')).toMatchObject({ concurrency: 4, failureRate: 0 });
    expect(isLocked(writeBurst, 'worker-1', 'serviceTime', 'worker')).toBe(true);
    expect(isLocked(writeBurst, 'worker-1', 'instances', 'worker')).toBe(false);
    expect(isLocked(writeBurst, 'queue-1', 'maxDepth', 'queue')).toBe(false);
  });

  it('offers only the kinds of part the level names, in the usual order', () => {
    expect(allowedParts(firstTraffic)).toEqual(['load-balancer']);
    expect(allowedParts(writeBurst)).toEqual(['queue', 'worker']);
    expect(allowedParts(stampede)).toEqual([]);
  });
});

describe('objectives in words', () => {
  const say = (objective: Objective) => describeObjective(objective, en);
  const got = (objective: Objective, value: number) => describeValue({ objective, value, met: true }, en);

  it('say what is asked', () => {
    expect(say({ kind: 'p99', maxMs: 500 })).toBe('99% of requests answered within 500 ms');
    expect(say({ kind: 'p99', maxMs: 1000 })).toBe('99% of requests answered within 1 s');
    expect(say({ kind: 'errors', maxRate: 0.01 })).toBe('No more than 1% of requests fail');
    expect(say({ kind: 'errors', maxRate: 0.0005 })).toBe('No more than 0.05% of requests fail');
    expect(say({ kind: 'errors', maxRate: 0 })).toBe('No request fails');
    expect(say({ kind: 'cost', maxMonthly: 1000 })).toBe('Costs no more than $1,000 a month');
    expect(say({ kind: 'backlog', maxDepth: 50 })).toBe('No more than 50 messages still waiting at the end');
    expect(say({ kind: 'lost', max: 0 })).toBe('No message lost');
  });

  it('say what was achieved, with enough digits to compare with the limit', () => {
    expect(got({ kind: 'p99', maxMs: 500 }, 191.2)).toBe('p99 191 ms');
    expect(got({ kind: 'errors', maxRate: 0.005 }, 0.0026)).toBe('0.26% fail');
    expect(got({ kind: 'errors', maxRate: 0.13 }, 0.1076)).toBe('10.8% fail');
    expect(got({ kind: 'errors', maxRate: 0 }, 0)).toBe('0% fail');
    expect(got({ kind: 'cost', maxMonthly: 140 }, 97.6)).toBe('$98 a month');
    expect(got({ kind: 'backlog', maxDepth: 50 }, 1773)).toBe('1,773 waiting');
    expect(got({ kind: 'lost', max: 0 }, 0)).toBe('0 lost');
  });

  it('have nothing to say before there is anything to measure', () => {
    const outcome = (ok: number, failed: number): Outcome => ({
      passed: false,
      stars: 0,
      results: [],
      bonus: [[], []],
      broken: [],
      issues: [],
      score: { fromMs: 30_000, ok, failed, meanMs: 0, p50: 0, p95: 0, p99: 0 },
      monthlyCost: 0,
    });
    const result = (objective: Objective) => ({ objective, value: 0, met: false });
    const p99 = result({ kind: 'p99', maxMs: 500 });
    const errors = result({ kind: 'errors', maxRate: 0.01 });
    const cost = result({ kind: 'cost', maxMonthly: 140 });

    // Before the run starts, nothing is measured.
    expect([p99, errors, cost].map((each) => isMeasured(each, outcome(0, 0), 0))).toEqual([false, false, false]);
    // During warm-up there is a cost, and no latency or failure rate yet.
    expect([p99, errors, cost].map((each) => isMeasured(each, outcome(0, 0), 20_000))).toEqual([false, false, true]);
    // With only failures there is a failure rate and still no latency.
    expect([p99, errors, cost].map((each) => isMeasured(each, outcome(0, 12), 40_000))).toEqual([false, true, true]);
    expect([p99, errors, cost].map((each) => isMeasured(each, outcome(5, 12), 40_000))).toEqual([true, true, true]);
  });
});

describe('saved progress', () => {
  it('is read back as it was written', () => {
    expect(readProgress('{"first-traffic":3,"read-heavy":1}')).toEqual({ 'first-traffic': 3, 'read-heavy': 1 });
  });

  it('keeps only what has the right shape', () => {
    expect(readProgress(null)).toEqual({});
    expect(readProgress('not json')).toEqual({});
    expect(readProgress('[1,2,3]')).toEqual({});
    expect(readProgress('"3"')).toEqual({});
    expect(readProgress('{"a":0,"b":4,"c":"3","d":2.5,"e":2,"f":null}')).toEqual({ e: 2 });
  });
});
