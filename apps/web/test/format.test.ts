import { describe, expect, it } from 'vitest';
import { dotSpacing, failureEvery } from '../src/canvas/traffic.ts';
import { formatClock, formatCount, formatDuration, formatPercent, formatShare } from '../src/metrics/format.ts';

describe('formatDuration', () => {
  it('uses the unit and precision that suit the size', () => {
    expect(formatDuration(0)).toBe('0 ms');
    expect(formatDuration(0.84)).toBe('0.8 ms');
    expect(formatDuration(9.96)).toBe('10 ms');
    expect(formatDuration(24.4)).toBe('24 ms');
    expect(formatDuration(999.4)).toBe('999 ms');
    expect(formatDuration(1240)).toBe('1.24 s');
    expect(formatDuration(12_340)).toBe('12.3 s');
    expect(formatDuration(NaN)).toBe('–');
  });
});

describe('formatCount', () => {
  it('shortens large numbers', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(4.25)).toBe('4.3');
    expect(formatCount(812.4)).toBe('812');
    expect(formatCount(1284)).toBe('1,284');
    expect(formatCount(12_940)).toBe('12.9k');
    expect(formatCount(4_200_000)).toBe('4.2M');
  });
});

describe('formatPercent', () => {
  it('keeps small shares visible', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.0004)).toBe('<0.1%');
    expect(formatPercent(0.004)).toBe('0.4%');
    expect(formatPercent(0.0816)).toBe('8.2%');
    expect(formatPercent(0.396)).toBe('40%');
    expect(formatPercent(1)).toBe('100%');
  });
});

describe('formatClock', () => {
  it('counts minutes and seconds, and hours once there are some', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(42_900)).toBe('0:42');
    expect(formatClock(725_000)).toBe('12:05');
    expect(formatClock(3_723_000)).toBe('1:02:03');
  });
});

describe('formatShare', () => {
  it('keeps enough digits to be read against a limit', () => {
    expect(formatShare(0)).toBe('0%');
    expect(formatShare(0.00003)).toBe('<0.01%');
    expect(formatShare(0.0003)).toBe('0.03%');
    expect(formatShare(0.0026)).toBe('0.26%');
    expect(formatShare(0.005)).toBe('0.5%');
    expect(formatShare(0.0187)).toBe('1.87%');
    expect(formatShare(0.1076)).toBe('10.8%');
    expect(formatShare(0.13)).toBe('13%');
    expect(formatShare(1)).toBe('100%');
    expect(formatShare(Infinity)).toBe('–');
  });
});

describe('the dots on a connection', () => {
  it('are closer together the more calls there are, within limits', () => {
    expect(dotSpacing(0)).toBe(44);
    expect(dotSpacing(9)).toBe(33);
    expect(dotSpacing(99)).toBe(22);
    expect(dotSpacing(999)).toBe(11);
    expect(dotSpacing(1_000_000)).toBe(7);
  });

  it('are red one in every so many, for the share that failed', () => {
    expect(failureEvery(0)).toBe(Infinity);
    expect(failureEvery(0.01)).toBe(100);
    expect(failureEvery(0.33)).toBe(3);
    expect(failureEvery(0.5)).toBe(2);
    expect(failureEvery(0.8)).toBe(1);
    expect(failureEvery(1)).toBe(1);
  });
});
