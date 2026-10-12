import type { Period, PlayingPeriod } from './types';

/**
 * Match-time arithmetic. Pure.
 *
 * Match time is a continuous scale in ms: the second half starts at the half
 * length, extra time after twice that. A period's stoppage time runs past its
 * nominal end, so the first half's 47:00 (45+2') and the second half's 47:00
 * (47') share a number — always pair match time with its period.
 *
 * Minutes follow football convention: 0:00–0:59 is the 1st minute ("1'"),
 * 44:00–44:59 the 45th, and 45:00–45:59 of the first half is "45+1'".
 */

export const MINUTE_MS = 60_000;
const EXTRA_TIME_HALF_MINUTES = 15;
/** Longest stoppage accepted when validating an event time. */
export const MAX_STOPPAGE_MINUTES = 30;

export const PERIOD_ORDER: readonly Period[] = [
  'notStarted',
  'firstHalf',
  'halfTime',
  'secondHalf',
  'extraTimeFirstHalf',
  'extraTimeSecondHalf',
  'fullTime',
];

export const PLAYING_PERIODS: readonly PlayingPeriod[] = [
  'firstHalf',
  'secondHalf',
  'extraTimeFirstHalf',
  'extraTimeSecondHalf',
];

export const PERIOD_LABELS: Record<Period, string> = {
  notStarted: 'Not started',
  firstHalf: 'First half',
  halfTime: 'Half time',
  secondHalf: 'Second half',
  extraTimeFirstHalf: 'Extra time – 1st half',
  extraTimeSecondHalf: 'Extra time – 2nd half',
  fullTime: 'Full time',
};

export const PERIOD_SHORT_LABELS: Record<Period, string> = {
  notStarted: 'Pre-match',
  firstHalf: '1H',
  halfTime: 'HT',
  secondHalf: '2H',
  extraTimeFirstHalf: 'ET1',
  extraTimeSecondHalf: 'ET2',
  fullTime: 'FT',
};

export function periodIndex(period: Period): number {
  return PERIOD_ORDER.indexOf(period);
}

export function isPeriod(value: unknown): value is Period {
  return typeof value === 'string' && (PERIOD_ORDER as readonly string[]).includes(value);
}

export function isPlayingPeriod(period: Period): period is PlayingPeriod {
  return (PLAYING_PERIODS as readonly string[]).includes(period);
}

export interface PeriodBounds {
  /** Match time (ms) at which the period starts. */
  startMs: number;
  /** Nominal end (ms); stoppage time runs past it. */
  endMs: number;
}

/** Nominal bounds of a playing period for a match of `durationMinutes` regulation time. */
export function periodBounds(period: PlayingPeriod, durationMinutes: number): PeriodBounds {
  const half = (durationMinutes / 2) * MINUTE_MS;
  const et = EXTRA_TIME_HALF_MINUTES * MINUTE_MS;
  switch (period) {
    case 'firstHalf':
      return { startMs: 0, endMs: half };
    case 'secondHalf':
      return { startMs: half, endMs: 2 * half };
    case 'extraTimeFirstHalf':
      return { startMs: 2 * half, endMs: 2 * half + et };
    case 'extraTimeSecondHalf':
      return { startMs: 2 * half + et, endMs: 2 * half + 2 * et };
  }
}

/**
 * The match-time "anchor" of any period: its start for playing periods; for
 * breaks, the nominal end of the period before them. Used to place notes made
 * during breaks and as the default time for a period.
 */
export function periodAnchorMs(period: Period, durationMinutes: number): number {
  switch (period) {
    case 'notStarted':
      return 0;
    case 'halfTime':
      return periodBounds('firstHalf', durationMinutes).endMs;
    case 'fullTime':
      return periodBounds('secondHalf', durationMinutes).endMs;
    default:
      return periodBounds(period, durationMinutes).startMs;
  }
}

export interface MinuteParts {
  /** Football minute, e.g. 67, or the period's last minute when in stoppage (45, 90…). */
  minute: number;
  /** Added-time minute (1 = "+1"), 0 when not in stoppage time. */
  added: number;
}

/** Splits a match time within a playing period into football minute + added minute. */
export function minuteParts(period: PlayingPeriod, matchTimeMs: number, durationMinutes: number): MinuteParts {
  const { startMs, endMs } = periodBounds(period, durationMinutes);
  const t = Math.max(matchTimeMs, startMs);
  if (t >= endMs) {
    return { minute: Math.round(endMs / MINUTE_MS), added: Math.floor((t - endMs) / MINUTE_MS) + 1 };
  }
  return { minute: Math.floor(t / MINUTE_MS) + 1, added: 0 };
}

/** Match time at the start of a football minute (inverse of `minuteParts`). */
export function matchTimeFromMinute(
  period: PlayingPeriod,
  minute: number,
  added: number,
  durationMinutes: number,
): number {
  const { endMs } = periodBounds(period, durationMinutes);
  if (added > 0) return endMs + (added - 1) * MINUTE_MS;
  return (minute - 1) * MINUTE_MS;
}

/** "67'", "45+2'", "90+4'", "105+1'". Breaks and pre-match show their short label. */
export function formatMatchMinute(period: Period, matchTimeMs: number, durationMinutes: number): string {
  if (!isPlayingPeriod(period)) return PERIOD_SHORT_LABELS[period];
  const { minute, added } = minuteParts(period, matchTimeMs, durationMinutes);
  return added > 0 ? `${minute}+${added}'` : `${minute}'`;
}

/** `mm:ss` for a non-negative duration; minutes are not capped (e.g. "105:00"). */
export function formatClockTime(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Whether a match time is plausible for a period: within a playing period's
 * start and nominal end + MAX_STOPPAGE; breaks accept only their anchor.
 */
export function isTimeInPeriod(period: Period, matchTimeMs: number, durationMinutes: number): boolean {
  if (!Number.isFinite(matchTimeMs) || matchTimeMs < 0) return false;
  if (!isPlayingPeriod(period)) return matchTimeMs === periodAnchorMs(period, durationMinutes);
  const { startMs, endMs } = periodBounds(period, durationMinutes);
  return matchTimeMs >= startMs && matchTimeMs <= endMs + MAX_STOPPAGE_MINUTES * MINUTE_MS;
}
