import {
  formatClockTime,
  isPlayingPeriod,
  PERIOD_LABELS,
  periodAnchorMs,
  periodBounds,
} from './time';
import type { ClockState, Period, PeriodMarker, PlayingPeriod } from './types';

/**
 * Match clock state machine. Pure: every function takes `now` (epoch ms) from
 * the caller. Elapsed time is always derived from a reference timestamp, never
 * from counting ticks, so a running clock survives reloads, sleeps and
 * throttled timers.
 */

export function createClock(): ClockState {
  return { period: 'notStarted', elapsedMs: 0, runningSinceEpochMs: null, endedPeriod: null };
}

export function isRunning(clock: ClockState): boolean {
  return clock.runningSinceEpochMs !== null;
}

/** Elapsed ms within the current (or just-ended) playing period at `now`. */
export function periodElapsedMs(clock: ClockState, now: number): number {
  if (clock.runningSinceEpochMs === null) return clock.elapsedMs;
  // A clock change on the device could put `now` before the reference; never go backwards.
  return clock.elapsedMs + Math.max(0, now - clock.runningSinceEpochMs);
}

/** Allowed forward transitions. Manual corrections use `correctClock`. */
export const NEXT_PERIODS: Record<Period, readonly Period[]> = {
  notStarted: ['firstHalf'],
  firstHalf: ['halfTime'],
  halfTime: ['secondHalf'],
  secondHalf: ['fullTime', 'extraTimeFirstHalf'],
  extraTimeFirstHalf: ['extraTimeSecondHalf'],
  extraTimeSecondHalf: ['fullTime'],
  fullTime: [],
};

export function canAdvance(clock: ClockState, to: Period): boolean {
  return NEXT_PERIODS[clock.period].includes(to);
}

/** Timeline markers recorded when moving from one period to the next. */
function transitionMarkers(from: Period, to: Period): PeriodMarker[] {
  const key = `${from}>${to}`;
  const markers: Record<string, PeriodMarker[]> = {
    'notStarted>firstHalf': ['kickoff'],
    'firstHalf>halfTime': ['halfTime'],
    'halfTime>secondHalf': ['secondHalfKickoff'],
    'secondHalf>fullTime': ['fullTime'],
    'secondHalf>extraTimeFirstHalf': ['endOfNormalTime', 'extraTimeKickoff'],
    'extraTimeFirstHalf>extraTimeSecondHalf': ['extraTimeHalfTime', 'extraTimeSecondHalfKickoff'],
    'extraTimeSecondHalf>fullTime': ['fullTime'],
  };
  return markers[key] ?? [];
}

export interface ClockTransition {
  clock: ClockState;
  /** Markers to record, each with the period and match time it belongs to. */
  markers: { marker: PeriodMarker; period: PlayingPeriod; matchTimeMs: number }[];
}

/**
 * Moves to the next period. Entering a playing period starts its clock at 0
 * and running; entering a break or full time stops the clock and keeps the
 * ended period's final elapsed time for the read-out. Returns null for an
 * invalid transition.
 */
export function advancePeriod(clock: ClockState, to: Period, now: number, durationMinutes: number): ClockTransition | null {
  if (!canAdvance(clock, to)) return null;
  const from = clock.period;
  const markers: ClockTransition['markers'] = [];

  for (const marker of transitionMarkers(from, to)) {
    const isEnd = marker === 'halfTime' || marker === 'endOfNormalTime' || marker === 'extraTimeHalfTime' || marker === 'fullTime';
    if (isEnd && isPlayingPeriod(from)) {
      const { startMs } = periodBounds(from, durationMinutes);
      markers.push({ marker, period: from, matchTimeMs: startMs + periodElapsedMs(clock, now) });
    } else if (isPlayingPeriod(to)) {
      markers.push({ marker, period: to, matchTimeMs: periodBounds(to, durationMinutes).startMs });
    }
  }

  const next: ClockState = isPlayingPeriod(to)
    ? { period: to, elapsedMs: 0, runningSinceEpochMs: now, endedPeriod: isPlayingPeriod(from) ? from : clock.endedPeriod }
    : {
        period: to,
        elapsedMs: periodElapsedMs(clock, now),
        runningSinceEpochMs: null,
        endedPeriod: isPlayingPeriod(from) ? from : clock.endedPeriod,
      };
  return { clock: next, markers };
}

/** Starts or resumes the clock. Only meaningful in a playing period. */
export function startClock(clock: ClockState, now: number): ClockState {
  if (!isPlayingPeriod(clock.period) || isRunning(clock)) return clock;
  return { ...clock, runningSinceEpochMs: now };
}

export function pauseClock(clock: ClockState, now: number): ClockState {
  if (!isRunning(clock)) return clock;
  return { ...clock, elapsedMs: periodElapsedMs(clock, now), runningSinceEpochMs: null };
}

/**
 * Manual correction: optionally change the period (any period, no markers)
 * and set the elapsed time within it. A running clock keeps running from the
 * corrected value.
 */
export function correctClock(
  clock: ClockState,
  correction: { period?: Period; elapsedMs: number },
  now: number,
): ClockState {
  const period = correction.period ?? clock.period;
  const elapsedMs = Math.max(0, Math.round(Number.isFinite(correction.elapsedMs) ? correction.elapsedMs : 0));
  const running = isPlayingPeriod(period) && isRunning(clock);
  return {
    period,
    elapsedMs: isPlayingPeriod(period) || period === 'halfTime' || period === 'fullTime' ? elapsedMs : 0,
    runningSinceEpochMs: running ? now : null,
    endedPeriod: endedPeriodFor(period, clock.endedPeriod),
  };
}

/** Which playing period a corrected break refers to (so the read-out shows its end time). */
function endedPeriodFor(period: Period, current: PlayingPeriod | null): PlayingPeriod | null {
  if (period === 'halfTime') return 'firstHalf';
  if (period === 'notStarted') return null;
  if (period === 'fullTime') {
    return current === 'secondHalf' || current === 'extraTimeSecondHalf' ? current : 'secondHalf';
  }
  return current;
}

/** Continuous match time (ms) at `now`: period start + elapsed for playing periods. */
export function currentMatchTimeMs(clock: ClockState, now: number, durationMinutes: number): number {
  if (isPlayingPeriod(clock.period)) {
    return periodBounds(clock.period, durationMinutes).startMs + periodElapsedMs(clock, now);
  }
  if (clock.endedPeriod && clock.period !== 'notStarted') {
    return periodBounds(clock.endedPeriod, durationMinutes).startMs + clock.elapsedMs;
  }
  return periodAnchorMs(clock.period, durationMinutes);
}

export interface ClockReadout {
  period: Period;
  label: string;
  running: boolean;
  /** Main display, `mm:ss` on the match scale, capped at the period's nominal end. */
  main: string;
  /** Added time beyond the nominal end, e.g. "+2:13", or null. */
  added: string | null;
  matchTimeMs: number;
}

/** What a scoreboard shows at `now`. */
export function clockReadout(clock: ClockState, now: number, durationMinutes: number): ClockReadout {
  const matchTimeMs = currentMatchTimeMs(clock, now, durationMinutes);
  const reference: PlayingPeriod | null = isPlayingPeriod(clock.period)
    ? clock.period
    : clock.period === 'notStarted'
      ? null
      : clock.endedPeriod;
  let main = formatClockTime(matchTimeMs);
  let added: string | null = null;
  if (reference) {
    const { endMs } = periodBounds(reference, durationMinutes);
    if (matchTimeMs > endMs) {
      main = formatClockTime(endMs);
      added = `+${formatClockTime(matchTimeMs - endMs).replace(/^0/, '')}`;
    }
  }
  return { period: clock.period, label: PERIOD_LABELS[clock.period], running: isRunning(clock), main, added, matchTimeMs };
}

/**
 * Default time for an event being recorded now: the live period and match
 * time. Null outside playing periods (the UI must ask which period).
 */
export function liveEventTime(
  clock: ClockState,
  now: number,
  durationMinutes: number,
): { period: PlayingPeriod; matchTimeMs: number } | null {
  if (!isPlayingPeriod(clock.period)) return null;
  return { period: clock.period, matchTimeMs: currentMatchTimeMs(clock, now, durationMinutes) };
}

/** Elapsed-in-period value for a correction expressed as match time (e.g. "set to 67:30"). */
export function elapsedForMatchTime(period: PlayingPeriod, matchTimeMs: number, durationMinutes: number): number {
  return Math.max(0, matchTimeMs - periodBounds(period, durationMinutes).startMs);
}
