import { describe, expect, it } from 'vitest';
import { advancePeriod, correctClock, createClock } from './clock';
import { suggestEventTime, timeFromWhen, whenFromTime } from './eventTime';
import { MINUTE_MS } from './time';
import type { ClockState, Period } from './types';

const T0 = Date.UTC(2026, 9, 10, 19, 30);
const min = (n: number) => n * MINUTE_MS;
const go = (c: ClockState, to: Period, now: number) => advancePeriod(c, to, now, 90)!.clock;

describe('suggestEventTime', () => {
  it('uses the live time during play', () => {
    const c = go(createClock(), 'firstHalf', T0);
    expect(suggestEventTime(c, T0 + min(12) + 5000, 90)).toEqual({ period: 'firstHalf', matchTimeMs: min(12) + 5000 });
  });

  it('suggests minute 1 before kick-off and the start of the second half at half time', () => {
    expect(suggestEventTime(createClock(), T0, 90)).toEqual({ period: 'firstHalf', matchTimeMs: 0 });
    const ht = go(go(createClock(), 'firstHalf', T0), 'halfTime', T0 + min(46));
    expect(suggestEventTime(ht, T0 + min(55), 90)).toEqual({ period: 'secondHalf', matchTimeMs: min(45) });
  });

  it('suggests the end of the last half after full time', () => {
    let c = go(createClock(), 'firstHalf', T0);
    c = go(c, 'halfTime', T0 + min(45));
    c = go(c, 'secondHalf', T0 + min(60));
    c = go(c, 'fullTime', T0 + min(107));
    expect(suggestEventTime(c, T0 + min(300), 90)).toEqual({ period: 'secondHalf', matchTimeMs: min(92) });
  });
});

describe('minute fields <-> match time', () => {
  it('splits and rebuilds typical times', () => {
    expect(whenFromTime('secondHalf', min(66) + 30_000, 90)).toEqual({ period: 'secondHalf', minute: 67, added: 0 });
    expect(whenFromTime('firstHalf', min(46), 90)).toEqual({ period: 'firstHalf', minute: 45, added: 2 });
    expect(timeFromWhen({ period: 'secondHalf', minute: 67, added: 0 }, 90)).toBe(min(66));
    expect(timeFromWhen({ period: 'firstHalf', minute: 45, added: 2 }, 90)).toBe(min(46));
  });

  it('treats a first-half minute beyond 45 as stoppage time', () => {
    const t = timeFromWhen({ period: 'firstHalf', minute: 47, added: 0 }, 90)!;
    expect(whenFromTime('firstHalf', t, 90)).toEqual({ period: 'firstHalf', minute: 45, added: 2 });
  });

  it('keeps the exact millisecond time while the minute is unchanged', () => {
    const exact = { period: 'secondHalf' as const, matchTimeMs: min(66) + 41_250 };
    expect(timeFromWhen({ period: 'secondHalf', minute: 67, added: 0 }, 90, exact)).toBe(exact.matchTimeMs);
    expect(timeFromWhen({ period: 'secondHalf', minute: 68, added: 0 }, 90, exact)).toBe(min(67));
    expect(timeFromWhen({ period: 'firstHalf', minute: 67, added: 0 }, 90, exact)).toBe(min(66));
  });

  it('uses the break anchor for half time and rejects unusable minutes', () => {
    expect(timeFromWhen({ period: 'halfTime', minute: 0, added: 0 }, 90)).toBe(min(45));
    expect(timeFromWhen({ period: 'firstHalf', minute: 0, added: 0 }, 90)).toBeNull();
    expect(timeFromWhen({ period: 'firstHalf', minute: 3.5, added: 0 }, 90)).toBeNull();
    expect(timeFromWhen({ period: 'firstHalf', minute: 10, added: -1 }, 90)).toBeNull();
  });
});

describe('correctClock into breaks', () => {
  it('shows the end of the right half after correcting into half time and full time', () => {
    const playing = go(createClock(), 'firstHalf', T0);
    const ht = correctClock(playing, { period: 'halfTime', elapsedMs: min(45) }, T0);
    expect(ht).toMatchObject({ period: 'halfTime', endedPeriod: 'firstHalf', runningSinceEpochMs: null });
    const ft = correctClock(ht, { period: 'fullTime', elapsedMs: min(45) }, T0);
    expect(ft.endedPeriod).toBe('secondHalf');
  });
});
