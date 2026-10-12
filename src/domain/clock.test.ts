import { describe, expect, it } from 'vitest';
import {
  advancePeriod,
  canAdvance,
  clockReadout,
  correctClock,
  createClock,
  currentMatchTimeMs,
  elapsedForMatchTime,
  isRunning,
  liveEventTime,
  pauseClock,
  periodElapsedMs,
  startClock,
} from './clock';
import { MINUTE_MS } from './time';
import type { ClockState, Period } from './types';

const T0 = Date.UTC(2026, 9, 10, 19, 30);
const min = (n: number) => n * MINUTE_MS;
const sec = (n: number) => n * 1000;

function advance(clock: ClockState, to: Period, now: number) {
  const t = advancePeriod(clock, to, now, 90);
  if (!t) throw new Error(`cannot go ${clock.period} → ${to}`);
  return t;
}

describe('period transitions', () => {
  it('follows the match sequence and rejects skips', () => {
    let c = createClock();
    expect(canAdvance(c, 'secondHalf')).toBe(false);
    expect(advancePeriod(c, 'halfTime', T0, 90)).toBeNull();
    c = advance(c, 'firstHalf', T0).clock;
    c = advance(c, 'halfTime', T0 + min(47)).clock;
    c = advance(c, 'secondHalf', T0 + min(62)).clock;
    expect(canAdvance(c, 'fullTime')).toBe(true);
    expect(canAdvance(c, 'extraTimeFirstHalf')).toBe(true);
    c = advance(c, 'fullTime', T0 + min(110)).clock;
    expect(canAdvance(c, 'firstHalf')).toBe(false);
  });

  it('starts each half running from zero and freezes the ended half at a break', () => {
    const kick = advance(createClock(), 'firstHalf', T0);
    expect(kick.clock).toEqual({ period: 'firstHalf', elapsedMs: 0, runningSinceEpochMs: T0, endedPeriod: null });
    expect(kick.markers).toEqual([{ marker: 'kickoff', period: 'firstHalf', matchTimeMs: 0 }]);

    const ht = advance(kick.clock, 'halfTime', T0 + min(47) + sec(13));
    expect(ht.clock).toMatchObject({ period: 'halfTime', runningSinceEpochMs: null, endedPeriod: 'firstHalf', elapsedMs: min(47) + sec(13) });
    expect(ht.markers).toEqual([{ marker: 'halfTime', period: 'firstHalf', matchTimeMs: min(47) + sec(13) }]);

    const second = advance(ht.clock, 'secondHalf', T0 + min(65));
    expect(second.markers).toEqual([{ marker: 'secondHalfKickoff', period: 'secondHalf', matchTimeMs: min(45) }]);
    expect(currentMatchTimeMs(second.clock, T0 + min(65) + min(10), 90)).toBe(min(55));
  });

  it('records end-of-normal-time and extra-time kick-off when going to extra time', () => {
    let c = advance(createClock(), 'firstHalf', T0).clock;
    c = advance(c, 'halfTime', T0 + min(45)).clock;
    c = advance(c, 'secondHalf', T0 + min(60)).clock;
    const et = advance(c, 'extraTimeFirstHalf', T0 + min(108));
    expect(et.markers.map((x) => x.marker)).toEqual(['endOfNormalTime', 'extraTimeKickoff']);
    expect(et.markers[0]).toMatchObject({ period: 'secondHalf', matchTimeMs: min(93) });
    expect(et.markers[1]).toMatchObject({ period: 'extraTimeFirstHalf', matchTimeMs: min(90) });
    const et2 = advance(et.clock, 'extraTimeSecondHalf', T0 + min(124));
    const ft = advance(et2.clock, 'fullTime', T0 + min(140));
    expect(clockReadout(ft.clock, T0 + min(200), 90)).toMatchObject({ label: 'Full time', main: '120:00', added: '+1:00' });
  });
});

describe('start, pause, resume and correction', () => {
  it('derives elapsed time from timestamps across pauses (no tick counting)', () => {
    let c = advance(createClock(), 'firstHalf', T0).clock;
    expect(periodElapsedMs(c, T0 + min(10))).toBe(min(10));
    c = pauseClock(c, T0 + min(10));
    expect(isRunning(c)).toBe(false);
    // Time passes while paused: nothing accumulates.
    expect(periodElapsedMs(c, T0 + min(30))).toBe(min(10));
    c = startClock(c, T0 + min(30));
    expect(periodElapsedMs(c, T0 + min(35) + sec(20))).toBe(min(15) + sec(20));
  });

  it('ignores redundant start/pause calls and refuses to run outside a half', () => {
    const notStarted = createClock();
    expect(startClock(notStarted, T0)).toBe(notStarted);
    const running = advance(createClock(), 'firstHalf', T0).clock;
    expect(startClock(running, T0 + 5)).toBe(running);
    const paused = pauseClock(running, T0 + 5);
    expect(pauseClock(paused, T0 + 10)).toBe(paused);
  });

  it('corrects the elapsed time while running or paused', () => {
    const running = advance(createClock(), 'firstHalf', T0).clock;
    const fixed = correctClock(running, { elapsedMs: min(20) }, T0 + min(3));
    expect(periodElapsedMs(fixed, T0 + min(4))).toBe(min(21));
    const paused = correctClock(pauseClock(running, T0 + min(3)), { elapsedMs: min(5) }, T0 + min(9));
    expect(periodElapsedMs(paused, T0 + min(30))).toBe(min(5));
    expect(correctClock(paused, { elapsedMs: -50 }, T0).elapsedMs).toBe(0);
  });

  it('can correct a mistaken period change without adding markers', () => {
    const ht = advance(advance(createClock(), 'firstHalf', T0).clock, 'halfTime', T0 + min(30)).clock;
    const back = correctClock(ht, { period: 'firstHalf', elapsedMs: min(30) }, T0 + min(31));
    expect(back).toMatchObject({ period: 'firstHalf', elapsedMs: min(30), runningSinceEpochMs: null });
    expect(periodElapsedMs(startClock(back, T0 + min(32)), T0 + min(33))).toBe(min(31));
    expect(elapsedForMatchTime('secondHalf', min(67) + sec(30), 90)).toBe(min(22) + sec(30));
  });

  it('never runs backwards if the device clock jumps back', () => {
    const c = advance(createClock(), 'firstHalf', T0).clock;
    expect(periodElapsedMs(c, T0 - min(5))).toBe(0);
  });
});

describe('persistence', () => {
  it('restores a running clock correctly after a reload (JSON round trip)', () => {
    const c = advance(createClock(), 'firstHalf', T0).clock;
    const restored = JSON.parse(JSON.stringify(c)) as ClockState;
    // The page was closed for 20 minutes: the clock still shows the true time.
    expect(clockReadout(restored, T0 + min(20), 90)).toMatchObject({ main: '20:00', running: true });
  });

  it('restores a paused clock without drifting', () => {
    const paused = pauseClock(advance(createClock(), 'firstHalf', T0).clock, T0 + min(12));
    const restored = JSON.parse(JSON.stringify(paused)) as ClockState;
    expect(clockReadout(restored, T0 + min(500), 90)).toMatchObject({ main: '12:00', running: false });
  });
});

describe('read-out', () => {
  it('shows match time, stoppage and break labels', () => {
    expect(clockReadout(createClock(), T0, 90)).toMatchObject({ main: '00:00', added: null, label: 'Not started' });
    const first = advance(createClock(), 'firstHalf', T0).clock;
    expect(clockReadout(first, T0 + min(12) + sec(4), 90)).toMatchObject({ main: '12:04', added: null });
    expect(clockReadout(first, T0 + min(47) + sec(13), 90)).toMatchObject({ main: '45:00', added: '+2:13' });
    const ht = advance(first, 'halfTime', T0 + min(46)).clock;
    expect(clockReadout(ht, T0 + min(55), 90)).toMatchObject({ label: 'Half time', main: '45:00', added: '+1:00', running: false });
    const second = advance(ht, 'secondHalf', T0 + min(60)).clock;
    expect(clockReadout(second, T0 + min(60) + min(22), 90).main).toBe('67:00');
  });

  it('gives the live event time only during a half', () => {
    const first = advance(createClock(), 'firstHalf', T0).clock;
    expect(liveEventTime(first, T0 + min(3), 90)).toEqual({ period: 'firstHalf', matchTimeMs: min(3) });
    expect(liveEventTime(advance(first, 'halfTime', T0 + min(45)).clock, T0 + min(50), 90)).toBeNull();
  });
});
