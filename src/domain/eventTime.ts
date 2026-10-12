import { currentMatchTimeMs } from './clock';
import { isPlayingPeriod, matchTimeFromMinute, minuteParts, periodAnchorMs, periodBounds } from './time';
import type { ClockState, Period, PlayingPeriod } from './types';

/**
 * Event-entry time helpers: what time to suggest for a new event, and how a
 * (period, minute, added) form value maps to the stored match time. Pure.
 */

export interface EventWhen {
  period: Period;
  /** Football minute as typed (e.g. 67, or 47 meaning 45+2' in the first half). */
  minute: number;
  /** Added minutes ("+N") past the period's nominal end; 0 when none. */
  added: number;
}

export interface SuggestedTime {
  period: PlayingPeriod;
  matchTimeMs: number;
}

/**
 * Where a new event most likely belongs at `now`:
 * - during a half: the live time;
 * - before kick-off: the first minute;
 * - at half time: the start of the second half (substitutions made at the
 *   break are recorded as second-half events);
 * - after full time: the end of the last half played.
 */
export function suggestEventTime(clock: ClockState, now: number, durationMinutes: number): SuggestedTime {
  if (isPlayingPeriod(clock.period)) {
    return { period: clock.period, matchTimeMs: currentMatchTimeMs(clock, now, durationMinutes) };
  }
  switch (clock.period) {
    case 'notStarted':
      return { period: 'firstHalf', matchTimeMs: 0 };
    case 'halfTime':
      return { period: 'secondHalf', matchTimeMs: periodBounds('secondHalf', durationMinutes).startMs };
    case 'fullTime': {
      const last = clock.endedPeriod ?? 'secondHalf';
      return { period: last, matchTimeMs: currentMatchTimeMs(clock, now, durationMinutes) };
    }
    default:
      return { period: 'firstHalf', matchTimeMs: 0 };
  }
}

/** Minute fields for a stored time. Breaks have no minute fields (0/0). */
export function whenFromTime(period: Period, matchTimeMs: number, durationMinutes: number): EventWhen {
  if (!isPlayingPeriod(period)) return { period, minute: 0, added: 0 };
  const { minute, added } = minuteParts(period, matchTimeMs, durationMinutes);
  return { period, minute, added };
}

/**
 * Stored match time for form values. If the values still describe the same
 * minute as `exact` (the time suggested when the form opened), the exact
 * millisecond value is kept, preserving real ordering between events recorded
 * in the same minute. Returns null for unusable minute values.
 */
export function timeFromWhen(when: EventWhen, durationMinutes: number, exact?: SuggestedTime): number | null {
  if (!isPlayingPeriod(when.period)) return periodAnchorMs(when.period, durationMinutes);
  if (!Number.isInteger(when.minute) || !Number.isInteger(when.added) || when.added < 0) return null;
  if (when.added === 0 && when.minute < 1) return null;
  if (exact && exact.period === when.period) {
    const same = whenFromTime(exact.period, exact.matchTimeMs, durationMinutes);
    if (same.minute === when.minute && same.added === when.added) return exact.matchTimeMs;
  }
  return matchTimeFromMinute(when.period, when.minute, when.added, durationMinutes);
}
