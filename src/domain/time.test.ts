import { describe, expect, it } from 'vitest';
import {
  formatClockTime,
  formatMatchMinute,
  isTimeInPeriod,
  matchTimeFromMinute,
  MINUTE_MS,
  minuteParts,
  periodAnchorMs,
  periodBounds,
} from './time';
import type { PlayingPeriod } from './types';

const m = (min: number, sec = 0) => min * MINUTE_MS + sec * 1000;

describe('period bounds', () => {
  it('derives halves from the match duration and adds 2 × 15 min of extra time', () => {
    expect(periodBounds('firstHalf', 90)).toEqual({ startMs: 0, endMs: m(45) });
    expect(periodBounds('secondHalf', 90)).toEqual({ startMs: m(45), endMs: m(90) });
    expect(periodBounds('extraTimeFirstHalf', 90)).toEqual({ startMs: m(90), endMs: m(105) });
    expect(periodBounds('extraTimeSecondHalf', 90)).toEqual({ startMs: m(105), endMs: m(120) });
    expect(periodBounds('secondHalf', 80)).toEqual({ startMs: m(40), endMs: m(80) });
  });

  it('anchors breaks at the end of the previous half', () => {
    expect(periodAnchorMs('notStarted', 90)).toBe(0);
    expect(periodAnchorMs('halfTime', 90)).toBe(m(45));
    expect(periodAnchorMs('fullTime', 90)).toBe(m(90));
  });
});

describe('football minute notation', () => {
  const cases: [PlayingPeriod, number, string][] = [
    ['firstHalf', m(0), "1'"],
    ['firstHalf', m(0, 59), "1'"],
    ['firstHalf', m(44, 59), "45'"],
    ['firstHalf', m(45), "45+1'"],
    ['firstHalf', m(46, 59), "45+2'"],
    ['secondHalf', m(45), "46'"],
    ['secondHalf', m(66, 30), "67'"],
    ['secondHalf', m(89, 59), "90'"],
    ['secondHalf', m(90), "90+1'"],
    ['secondHalf', m(93, 30), "90+4'"],
    ['extraTimeFirstHalf', m(105, 10), "105+1'"],
    ['extraTimeSecondHalf', m(110), "111'"],
    ['extraTimeSecondHalf', m(121, 5), "120+2'"],
  ];
  it.each(cases)('%s at %d ms is %s', (period, ms, expected) => {
    expect(formatMatchMinute(period, ms, 90)).toBe(expected);
  });

  it('respects shorter matches', () => {
    expect(formatMatchMinute('firstHalf', m(40, 20), 80)).toBe("40+1'");
    expect(formatMatchMinute('secondHalf', m(40), 80)).toBe("41'");
  });

  it('shows short labels outside playing periods', () => {
    expect(formatMatchMinute('halfTime', m(45), 90)).toBe('HT');
    expect(formatMatchMinute('fullTime', m(90), 90)).toBe('FT');
  });

  it('converts minute + added minute back to match time', () => {
    for (const [period, minute, added] of [
      ['firstHalf', 12, 0],
      ['firstHalf', 45, 3],
      ['secondHalf', 67, 0],
      ['secondHalf', 90, 4],
      ['extraTimeSecondHalf', 120, 1],
    ] as const) {
      const ms = matchTimeFromMinute(period, minute, added, 90);
      expect(minuteParts(period, ms, 90)).toEqual({ minute, added });
    }
  });
});

describe('formatting and validation', () => {
  it('formats clock times without capping minutes', () => {
    expect(formatClockTime(m(7, 5))).toBe('07:05');
    expect(formatClockTime(m(105))).toBe('105:00');
    expect(formatClockTime(-500)).toBe('00:00');
  });

  it('accepts times within a period plus stoppage, and only the anchor for breaks', () => {
    expect(isTimeInPeriod('secondHalf', m(45), 90)).toBe(true);
    expect(isTimeInPeriod('secondHalf', m(44), 90)).toBe(false);
    expect(isTimeInPeriod('firstHalf', m(50), 90)).toBe(true); // long stoppage still accepted
    expect(isTimeInPeriod('firstHalf', m(80), 90)).toBe(false);
    expect(isTimeInPeriod('halfTime', m(45), 90)).toBe(true);
    expect(isTimeInPeriod('halfTime', m(46), 90)).toBe(false);
    expect(isTimeInPeriod('firstHalf', Number.NaN, 90)).toBe(false);
  });
});
