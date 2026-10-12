import { createClock } from './clock';
import { DEFAULT_FORMATION } from './formations';
import { createId } from './ids';
import { defaultSlots, SLOT_COUNT } from './layout';
import { getSquadCounts, MAX_STARTERS, validateSquadIntegrity } from './squad';
import type { Match, MatchInfo, MatchStatus, Officials, Team, TeamSide } from './types';

const DEFAULT_DURATION_MINUTES = 90;
export const MIN_DURATION_MINUTES = 10;
export const MAX_DURATION_MINUTES = 180;

export const MATCH_STATUSES: readonly { value: MatchStatus; label: string }[] = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'inProgress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'postponed', label: 'Postponed' },
  { value: 'abandoned', label: 'Abandoned' },
];

export function matchStatusLabel(status: MatchStatus): string {
  return MATCH_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export const OFFICIAL_FIELDS: readonly { key: keyof Officials; label: string }[] = [
  { key: 'referee', label: 'Referee' },
  { key: 'assistant1', label: 'Assistant Referee 1' },
  { key: 'assistant2', label: 'Assistant Referee 2' },
  { key: 'fourthOfficial', label: 'Fourth Official' },
];

function createTeam(side: TeamSide): Team {
  const slotIds = Array.from({ length: SLOT_COUNT }, () => createId('slot'));
  return {
    id: createId('team'),
    name: '',
    coach: '',
    players: [],
    slots: defaultSlots(side, slotIds),
    bench: [],
    formation: { kind: 'preset', id: DEFAULT_FORMATION },
  };
}

export function createMatch(): Match {
  return {
    id: createId('match'),
    name: '',
    competition: '',
    date: '',
    kickoffTime: '',
    venue: '',
    durationMinutes: DEFAULT_DURATION_MINUTES,
    notes: '',
    status: 'scheduled',
    officials: { referee: '', assistant1: '', assistant2: '', fourthOfficial: '' },
    home: createTeam('home'),
    away: createTeam('away'),
    drawings: [],
    savedLayouts: [],
    events: [],
    clock: createClock(),
    replays: [],
  };
}

export function getTeam(match: Match, side: TeamSide): Team {
  return side === 'home' ? match.home : match.away;
}

/** Display name for a team, with a neutral fallback while it is still blank. */
export function teamDisplayName(team: Team, side: TeamSide): string {
  return team.name.trim() || (side === 'home' ? 'Home team' : 'Away team');
}

/** The explicit match name, or "Home vs Away", or a neutral fallback. */
export function matchDisplayName(match: Match): string {
  const explicit = match.name.trim();
  if (explicit) return explicit;
  const home = match.home.name.trim();
  const away = match.away.name.trim();
  if (home && away) return `${home} vs ${away}`;
  if (home || away) return `${home || away} match`;
  return 'Untitled match';
}

function isValidDuration(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_DURATION_MINUTES && value <= MAX_DURATION_MINUTES;
}

export function durationError(value: number | null): string | null {
  if (value === null || !Number.isInteger(value)) return 'Enter the duration in whole minutes.';
  if (!isValidDuration(value)) {
    return `Duration must be between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES} minutes.`;
  }
  return null;
}

/** `YYYY-MM-DD` that is a real calendar date. Empty is handled by callers. */
export function isValidDateString(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** 24h `HH:mm`. Empty is handled by callers. */
export function isValidTimeString(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export type SetupScope = 'match' | 'officials' | 'home' | 'away';

export interface SetupIssue {
  id: string;
  scope: SetupScope;
  /** `error` = something entered is invalid; `incomplete` = optional-for-now to-do. */
  severity: 'error' | 'incomplete';
  message: string;
}

/** Setup checklist. Incomplete squads are allowed, so most items are `incomplete`, not `error`. */
export function getSetupIssues(match: Match): SetupIssue[] {
  const issues: SetupIssue[] = [];
  const push = (issue: SetupIssue) => issues.push(issue);

  const home = match.home.name.trim();
  const away = match.away.name.trim();
  if (!home) push({ id: 'home-name', scope: 'home', severity: 'incomplete', message: 'Home team name is not set.' });
  if (!away) push({ id: 'away-name', scope: 'away', severity: 'incomplete', message: 'Away team name is not set.' });
  if (home && away && home.toLowerCase() === away.toLowerCase()) {
    push({ id: 'same-names', scope: 'away', severity: 'error', message: 'Home and away teams have the same name.' });
  }

  if (!match.date) {
    push({ id: 'date', scope: 'match', severity: 'incomplete', message: 'Match date is not set.' });
  } else if (!isValidDateString(match.date)) {
    push({ id: 'date', scope: 'match', severity: 'error', message: 'Match date is not a valid date.' });
  }
  if (!match.kickoffTime) {
    push({ id: 'kickoff', scope: 'match', severity: 'incomplete', message: 'Kickoff time is not set.' });
  } else if (!isValidTimeString(match.kickoffTime)) {
    push({ id: 'kickoff', scope: 'match', severity: 'error', message: 'Kickoff time is not a valid time.' });
  }
  if (!isValidDuration(match.durationMinutes)) {
    push({
      id: 'duration',
      scope: 'match',
      severity: 'error',
      message: `Duration must be ${MIN_DURATION_MINUTES}–${MAX_DURATION_MINUTES} minutes.`,
    });
  }

  for (const side of ['home', 'away'] as const) {
    const team = getTeam(match, side);
    const label = teamDisplayName(team, side);
    const { starters } = getSquadCounts(team);
    if (starters < MAX_STARTERS) {
      push({
        id: `${side}-xi`,
        scope: side,
        severity: 'incomplete',
        message: `${label} starting XI has ${starters} of ${MAX_STARTERS} players.`,
      });
    }
    for (const problem of validateSquadIntegrity(team)) {
      push({ id: `${side}-${problem.code}`, scope: side, severity: 'error', message: `${label}: ${problem.message}` });
    }
  }

  return issues;
}

export type MatchInfoPatch = Partial<MatchInfo>;
