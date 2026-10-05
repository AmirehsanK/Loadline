import { describe, expect, it } from 'vitest';
import { formatClock, formatCount, formatDuration, formatPercent } from '../src/metrics/format.ts';

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
