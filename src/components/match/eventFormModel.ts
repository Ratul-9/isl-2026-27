import { analyzeEvents } from '@/domain/events';
import type { MatchAnalysis } from '@/domain/events';
import { suggestEventTime, timeFromWhen, whenFromTime } from '@/domain/eventTime';
import type { SuggestedTime } from '@/domain/eventTime';
import { isPlayingPeriod, formatMatchMinute } from '@/domain/time';
import type { GoalType, Id, Match, MatchEvent, Period, PeriodMarker, Player, TeamSide } from '@/domain/types';

/**
 * Pure model of the event-entry forms: form state, conversion to/from a
 * MatchEvent, and which players to offer. No React; unit-tested.
 */

export type EventFormKind = 'goal' | 'substitution' | 'card' | 'note' | 'marker';

export interface EventFormState {
  kind: EventFormKind;
  /** Team: credited team for goals; required for goal/substitution/card; optional for notes. */
  side: TeamSide | '';
  period: Period;
  /** Inputs stay strings so partially typed values don't fight the user. */
  minute: string;
  added: string;
  /** Suggested time when the form opened, so an unchanged minute keeps its exact ms. */
  exact?: SuggestedTime;
  goalType: GoalType;
  scorerId: Id | '';
  assistId: Id | '';
  outId: Id | '';
  inId: Id | '';
  reason: string;
  card: 'yellow' | 'red';
  playerId: Id | '';
  text: string;
  notes: string;
  marker?: PeriodMarker;
}

const BLANK: Omit<EventFormState, 'kind' | 'side' | 'period' | 'minute' | 'added'> = {
  goalType: 'normal',
  scorerId: '',
  assistId: '',
  outId: '',
  inId: '',
  reason: '',
  card: 'yellow',
  playerId: '',
  text: '',
  notes: '',
};

export function otherSide(side: TeamSide): TeamSide {
  return side === 'home' ? 'away' : 'home';
}

/** A fresh form, defaulted to the live (or most sensible) time. */
export function initialFormState(kind: EventFormKind, match: Match, now: number, side: TeamSide = 'home'): EventFormState {
  const exact = suggestEventTime(match.clock, now, match.durationMinutes);
  const when = whenFromTime(exact.period, exact.matchTimeMs, match.durationMinutes);
  return {
    ...BLANK,
    kind,
    side: kind === 'note' ? '' : side,
    period: when.period,
    minute: String(when.minute),
    added: String(when.added),
    exact,
  };
}

function sideOfTeam(match: Match, teamId: Id | undefined): TeamSide | '' {
  return teamId === match.home.id ? 'home' : teamId === match.away.id ? 'away' : '';
}

/** Form state for editing an existing event. */
export function formStateFromEvent(match: Match, event: MatchEvent): EventFormState {
  const when = whenFromTime(event.period, event.matchTimeMs, match.durationMinutes);
  const base: EventFormState = {
    ...BLANK,
    kind: 'note',
    side: '',
    period: event.period,
    minute: String(when.minute),
    added: String(when.added),
    exact: isPlayingPeriod(event.period) ? { period: event.period, matchTimeMs: event.matchTimeMs } : undefined,
  };
  switch (event.type) {
    case 'goal':
      return {
        ...base,
        kind: 'goal',
        side: sideOfTeam(match, event.teamId) || 'home',
        goalType: event.goalType,
        scorerId: event.scorerId ?? '',
        assistId: event.assistId ?? '',
        notes: event.notes ?? '',
      };
    case 'substitution':
      return {
        ...base,
        kind: 'substitution',
        side: sideOfTeam(match, event.teamId) || 'home',
        outId: event.outPlayerId,
        inId: event.inPlayerId,
        reason: event.reason ?? '',
      };
    case 'yellowCard':
    case 'redCard':
      return {
        ...base,
        kind: 'card',
        side: sideOfTeam(match, event.teamId) || 'home',
        card: event.type === 'redCard' ? 'red' : 'yellow',
        playerId: event.playerId,
        notes: event.notes ?? '',
      };
    case 'note':
      return { ...base, kind: 'note', side: sideOfTeam(match, event.teamId), text: event.text };
    case 'periodMarker':
      return { ...base, kind: 'marker', marker: event.marker };
  }
}

export interface Candidate {
  /** The event to validate/save, or null while required fields are missing. */
  event: MatchEvent | null;
  /** What is still missing, in plain words. */
  problems: string[];
  matchTimeMs: number | null;
}

const clean = <T extends object>(o: T): T => {
  for (const key of Object.keys(o) as (keyof T)[]) if (o[key] === undefined) delete o[key];
  return o;
};

/** Builds the event described by the form (with `id`), or reports what's missing. */
export function buildCandidate(match: Match, s: EventFormState, id: Id): Candidate {
  const problems: string[] = [];
  const minute = Number(s.minute);
  const added = s.added.trim() === '' ? 0 : Number(s.added);
  const matchTimeMs = timeFromWhen({ period: s.period, minute, added }, match.durationMinutes, s.exact);
  if (matchTimeMs === null) problems.push('Enter a valid minute (and added time, if any).');

  const need = (cond: boolean, message: string) => {
    if (!cond) problems.push(message);
  };
  const team = s.side ? match[s.side].id : undefined;
  const base = { id, period: s.period, matchTimeMs: matchTimeMs ?? 0 };

  let event: MatchEvent | null = null;
  switch (s.kind) {
    case 'goal':
      need(!!team, 'Choose the team.');
      need(s.goalType !== 'ownGoal' || !!s.scorerId, 'Choose the player who scored the own goal.');
      if (team) {
        event = clean({
          ...base,
          type: 'goal' as const,
          teamId: team,
          scorerId: s.scorerId || undefined,
          assistId: s.goalType === 'ownGoal' ? undefined : s.assistId || undefined,
          goalType: s.goalType,
          notes: s.notes.trim() || undefined,
        });
      }
      break;
    case 'substitution':
      need(!!team, 'Choose the team.');
      need(!!s.outId, 'Choose the outgoing player.');
      need(!!s.inId, 'Choose the incoming player.');
      if (team && s.outId && s.inId) {
        event = clean({
          ...base,
          type: 'substitution' as const,
          teamId: team,
          outPlayerId: s.outId,
          inPlayerId: s.inId,
          reason: s.reason.trim() || undefined,
        });
      }
      break;
    case 'card':
      need(!!team, 'Choose the team.');
      need(!!s.playerId, 'Choose the player.');
      if (team && s.playerId) {
        event = clean({
          ...base,
          type: s.card === 'red' ? ('redCard' as const) : ('yellowCard' as const),
          teamId: team,
          playerId: s.playerId,
          notes: s.notes.trim() || undefined,
        });
      }
      break;
    case 'note':
      need(s.text.trim().length > 0, 'Write the note.');
      if (s.text.trim()) {
        event = clean({ ...base, type: 'note' as const, text: s.text.trim(), teamId: team });
      }
      break;
    case 'marker':
      if (s.marker) event = { ...base, type: 'periodMarker', marker: s.marker };
      break;
  }
  if (problems.length > 0 || matchTimeMs === null) event = null;
  return { event, problems, matchTimeMs };
}

// --- players ------------------------------------------------------------------

export interface PlayerGroup {
  label: string;
  players: Player[];
}

export function playerLabel(p: Player): string {
  return `#${p.shirtNumber} ${p.name}`;
}

export type PlayerPool = 'scorer' | 'outgoing' | 'incoming' | 'card';

/**
 * Players to offer for a team at a moment, grouped by their situation.
 * `lineup` must be the lineup *at that moment* (excluding the event being
 * edited), from `lineupAtMoment`.
 */
export function playerGroups(match: Match, side: TeamSide, lineup: MatchAnalysis['lineups'][TeamSide], pool: PlayerPool): PlayerGroup[] {
  const team = match[side];
  const byId = new Map(team.players.map((p) => [p.id, p]));
  const pick = (ids: readonly Id[]) => ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const onPitch = pick(lineup.onPitch);
  const bench = pick(lineup.bench);
  const used = new Set([...lineup.onPitch, ...lineup.bench]);
  const others = team.players.filter((p) => !used.has(p.id));
  const sentOff = new Set(lineup.sentOff);

  const groups: PlayerGroup[] = [];
  const add = (label: string, players: Player[]) => {
    if (players.length > 0) groups.push({ label, players });
  };
  switch (pool) {
    case 'outgoing':
      add('On the pitch', onPitch);
      break;
    case 'incoming':
      add('Available substitutes', bench);
      break;
    case 'card':
      add('On the pitch', onPitch);
      add('Substitutes', bench);
      add('Others', others.filter((p) => !sentOff.has(p.id)));
      break;
    case 'scorer':
      add('On the pitch', onPitch);
      add('Substitutes', bench);
      add('Others in the squad', others);
      break;
  }
  return groups;
}

/** The lineups at the form's moment, leaving out the event being edited. */
export function lineupAtMoment(match: Match, excludeId: Id | undefined, period: Period, matchTimeMs: number | null) {
  const events = excludeId ? match.events.filter((e) => e.id !== excludeId) : match.events;
  const until = matchTimeMs === null ? undefined : { period, matchTimeMs };
  return analyzeEvents(match, events, until).lineups;
}

/** "45+2'" style preview for the form's current time. */
export function whenPreview(match: Match, period: Period, matchTimeMs: number | null): string | null {
  if (matchTimeMs === null) return null;
  return formatMatchMinute(period, matchTimeMs, match.durationMinutes);
}
