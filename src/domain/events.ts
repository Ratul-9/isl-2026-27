import { applyCard, applySubstitution, cardError, initialLineup, isOnPitch, substitutionError, toDerivedLineup } from './lineup';
import type { DerivedLineup, LineupState } from './lineup';
import { teamDisplayName } from './match';
import { formatMatchMinute, isPeriod, isPlayingPeriod, isTimeInPeriod, periodIndex } from './time';
import type { GoalType, Id, Match, MatchEvent, MatchEventType, Period, PeriodMarker, TeamSide } from './types';

/**
 * Match events: ordering, validation, and the single analysis pass that
 * derives the score and the active lineups. Pure.
 *
 * Nothing derived is ever stored. `analyzeEvents` walks the events in match
 * order, keeping a working lineup per team; each event is checked against the
 * state *at that moment*. Events with errors are flagged and skipped, so the
 * derived score and lineups are always internally consistent — e.g. after a
 * historical substitution is corrected, a later substitution that no longer
 * makes sense is flagged instead of producing duplicate players.
 */

export const GOAL_TYPES: readonly { value: GoalType; label: string }[] = [
  { value: 'normal', label: 'Goal' },
  { value: 'penalty', label: 'Penalty' },
  { value: 'freeKick', label: 'Free kick' },
  { value: 'header', label: 'Header' },
  { value: 'ownGoal', label: 'Own goal' },
];

export const MARKER_LABELS: Record<PeriodMarker, string> = {
  kickoff: 'Kick-off',
  halfTime: 'Half-time',
  secondHalfKickoff: 'Second-half kick-off',
  endOfNormalTime: 'End of normal time',
  extraTimeKickoff: 'Extra time kick-off',
  extraTimeHalfTime: 'Extra time half-time',
  extraTimeSecondHalfKickoff: 'Extra time second-half kick-off',
  fullTime: 'Full-time',
};

export const EVENT_TYPE_LABELS: Record<MatchEventType, string> = {
  goal: 'Goal',
  substitution: 'Substitution',
  yellowCard: 'Yellow card',
  redCard: 'Red card',
  note: 'Note',
  periodMarker: 'Period',
};

export const MAX_EVENT_TEXT = 500;

const isGoalType = (v: unknown): v is GoalType => GOAL_TYPES.some((g) => g.value === v);
const isMarker = (v: unknown): v is PeriodMarker => typeof v === 'string' && v in MARKER_LABELS;

// --- ordering -----------------------------------------------------------------

/**
 * Chronological order: period, then match time, then insertion order (the
 * array index) as the stable tie-breaker for events at the same moment.
 */
function compareEventKeys(a: { period: Period; matchTimeMs: number }, b: { period: Period; matchTimeMs: number }): number {
  return periodIndex(a.period) - periodIndex(b.period) || a.matchTimeMs - b.matchTimeMs;
}

export function sortEvents(events: readonly MatchEvent[]): MatchEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => compareEventKeys(a.event, b.event) || a.index - b.index)
    .map((x) => x.event);
}

// --- analysis -----------------------------------------------------------------

export interface AnalyzedEvent {
  event: MatchEvent;
  /** "67'", "45+2'"… */
  minute: string;
  /** Problems that make the event invalid; invalid events don't affect score or lineups. */
  errors: string[];
  /** Suspicious but accepted (e.g. a scorer who has since been removed from the squad). */
  warnings: string[];
}

export interface MatchAnalysis {
  /** Events in chronological order. */
  ordered: AnalyzedEvent[];
  byId: Map<Id, AnalyzedEvent>;
  /** Derived from valid goal events only. */
  score: { home: number; away: number };
  lineups: { home: DerivedLineup; away: DerivedLineup };
}

const other = (side: TeamSide): TeamSide => (side === 'home' ? 'away' : 'home');

/**
 * Analyzes a match's events (or a candidate list). With `until`, stops before
 * the first event strictly later than that moment — events AT that moment are
 * included, matching where a new event would be inserted.
 */
export function analyzeEvents(
  match: Match,
  events: readonly MatchEvent[] = match.events,
  until?: { period: Period; matchTimeMs: number },
): MatchAnalysis {
  const sideOfTeam = (teamId: Id | undefined): TeamSide | null =>
    teamId === match.home.id ? 'home' : teamId === match.away.id ? 'away' : null;
  const squadOf = (playerId: Id): TeamSide | null =>
    match.home.players.some((p) => p.id === playerId)
      ? 'home'
      : match.away.players.some((p) => p.id === playerId)
        ? 'away'
        : null;

  const state: Record<TeamSide, LineupState> = { home: initialLineup(match.home), away: initialLineup(match.away) };
  const score = { home: 0, away: 0 };
  const ordered: AnalyzedEvent[] = [];

  for (const event of sortEvents(events)) {
    if (until && compareEventKeys(event, until) > 0) break;
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!isPeriod(event.period)) errors.push('Unknown match period.');
    else if (!isTimeInPeriod(event.period, event.matchTimeMs, match.durationMinutes)) {
      errors.push('The time is outside this period.');
    }
    const needsPlay = event.type === 'goal' || event.type === 'substitution' || event.type === 'yellowCard' || event.type === 'redCard';
    if (needsPlay && isPeriod(event.period) && !isPlayingPeriod(event.period)) {
      errors.push('This event must happen during a half.');
    }

    /** Checks a player reference against the expected squad and the pitch. */
    const checkPlayer = (playerId: Id, expected: TeamSide, role: string, mustBeOnPitch: boolean) => {
      const squad = squadOf(playerId);
      if (squad === null) warnings.push(`The ${role} is no longer in either squad.`);
      else if (squad !== expected) errors.push(`The ${role} is not in the ${expected === 'home' ? 'home' : 'away'} squad.`);
      else if (mustBeOnPitch && !isOnPitch(state[expected], playerId)) warnings.push(`The ${role} was not on the pitch at this time.`);
    };

    switch (event.type) {
      case 'goal': {
        const side = sideOfTeam(event.teamId);
        if (!side) errors.push('The credited team is not part of this match.');
        if (!isGoalType(event.goalType)) errors.push('Unknown goal type.');
        if (side) {
          if (event.goalType === 'ownGoal') {
            // Credited to `side`; the responsible player belongs to the other team.
            if (!event.scorerId) errors.push('An own goal needs the responsible player.');
            else checkPlayer(event.scorerId, other(side), 'own-goal player', true);
            if (event.assistId) errors.push('An own goal cannot have an assist.');
          } else {
            if (event.scorerId) checkPlayer(event.scorerId, side, 'scorer', true);
            if (event.assistId) {
              if (event.assistId === event.scorerId) errors.push('A player cannot assist their own goal.');
              else checkPlayer(event.assistId, side, 'assisting player', true);
            }
          }
        }
        if (errors.length === 0 && side) score[side] += 1;
        break;
      }
      case 'substitution': {
        const side = sideOfTeam(event.teamId);
        if (!side) {
          errors.push('The team is not part of this match.');
          break;
        }
        if (squadOf(event.outPlayerId) !== side) errors.push('The outgoing player is not in this squad.');
        if (squadOf(event.inPlayerId) !== side) errors.push('The incoming player is not in this squad.');
        if (errors.length === 0) {
          const problem = substitutionError(state[side], event.outPlayerId, event.inPlayerId);
          if (problem) errors.push(problem);
          else state[side] = applySubstitution(state[side], event.outPlayerId, event.inPlayerId);
        }
        break;
      }
      case 'yellowCard':
      case 'redCard': {
        const side = sideOfTeam(event.teamId);
        if (!side) {
          errors.push('The team is not part of this match.');
          break;
        }
        if (squadOf(event.playerId) !== side) errors.push('The player is not in this squad.');
        if (errors.length === 0) {
          const problem = cardError(state[side], event.playerId);
          if (problem) errors.push(problem);
          else {
            const result = applyCard(state[side], event.playerId, event.type === 'redCard' ? 'red' : 'yellow');
            state[side] = result.state;
            if (result.dismissed && event.type === 'yellowCard') warnings.push('Second yellow card: the player is sent off.');
          }
        }
        break;
      }
      case 'note':
        if (!event.text?.trim()) errors.push('A note needs some text.');
        else if (event.text.length > MAX_EVENT_TEXT) errors.push(`Notes are limited to ${MAX_EVENT_TEXT} characters.`);
        if (event.teamId !== undefined && !sideOfTeam(event.teamId)) errors.push('The team is not part of this match.');
        break;
      case 'periodMarker':
        if (!isMarker(event.marker)) errors.push('Unknown period marker.');
        break;
    }

    ordered.push({
      event,
      minute: isPeriod(event.period) ? formatMatchMinute(event.period, event.matchTimeMs, match.durationMinutes) : '?',
      errors,
      warnings,
    });
  }

  return {
    ordered,
    byId: new Map(ordered.map((a) => [a.event.id, a])),
    score,
    lineups: { home: toDerivedLineup(match.home, state.home), away: toDerivedLineup(match.away, state.away) },
  };
}

/** Lineups at a moment (events at exactly that moment included). */
export function lineupsAt(match: Match, period: Period, matchTimeMs: number) {
  return analyzeEvents(match, match.events, { period, matchTimeMs }).lineups;
}

// --- changes ------------------------------------------------------------------

export interface EventChangeCheck {
  /** Errors on the new/edited event itself: the change should be refused. */
  errors: string[];
  warnings: string[];
  /** Other events that are valid now but would become invalid after the change. */
  newlyInvalid: AnalyzedEvent[];
}

function invalidAfter(match: Match, nextEvents: readonly MatchEvent[], skipId?: Id): AnalyzedEvent[] {
  const before = analyzeEvents(match);
  const after = analyzeEvents(match, nextEvents);
  return after.ordered.filter(
    (a) => a.event.id !== skipId && a.errors.length > 0 && (before.byId.get(a.event.id)?.errors.length ?? 1) === 0,
  );
}

/**
 * Checks adding (no existing id) or replacing (existing id) an event. An
 * edited event keeps its array position, so its insertion-order tie-break is
 * stable.
 */
export function checkEventChange(match: Match, candidate: MatchEvent): EventChangeCheck {
  const exists = match.events.some((e) => e.id === candidate.id);
  const nextEvents = exists ? match.events.map((e) => (e.id === candidate.id ? candidate : e)) : [...match.events, candidate];
  const own = analyzeEvents(match, nextEvents).byId.get(candidate.id)!;
  return { errors: own.errors, warnings: own.warnings, newlyInvalid: invalidAfter(match, nextEvents, candidate.id) };
}

/** Events that would become invalid if this event were deleted (deleting is always allowed). */
export function checkEventDeletion(match: Match, eventId: Id): AnalyzedEvent[] {
  return invalidAfter(match, match.events.filter((e) => e.id !== eventId));
}

/** Events that mention a player (as scorer, assist, substitute or card recipient). */
export function eventsReferencingPlayer(events: readonly MatchEvent[], playerId: Id): MatchEvent[] {
  return events.filter((e) => {
    switch (e.type) {
      case 'goal':
        return e.scorerId === playerId || e.assistId === playerId;
      case 'substitution':
        return e.outPlayerId === playerId || e.inPlayerId === playerId;
      case 'yellowCard':
      case 'redCard':
        return e.playerId === playerId;
      default:
        return false;
    }
  });
}

// --- text -----------------------------------------------------------------------

function playerName(match: Match, playerId: Id | undefined): string {
  if (!playerId) return 'Unknown player';
  const p = [...match.home.players, ...match.away.players].find((x) => x.id === playerId);
  return p ? p.name : 'Unknown player';
}

function teamName(match: Match, teamId: Id | undefined): string | null {
  if (teamId === match.home.id) return teamDisplayName(match.home, 'home');
  if (teamId === match.away.id) return teamDisplayName(match.away, 'away');
  return null;
}

/** Short description, e.g. "Player A OFF, Player B ON" or "Goal: Chhetri (pen), assist Thapa". */
export function describeEvent(match: Match, event: MatchEvent): string {
  switch (event.type) {
    case 'goal': {
      if (event.goalType === 'ownGoal') return `Own goal: ${playerName(match, event.scorerId)}`;
      const kind = event.goalType === 'penalty' ? ' (pen)' : event.goalType === 'freeKick' ? ' (free kick)' : event.goalType === 'header' ? ' (header)' : '';
      const scorer = event.scorerId ? playerName(match, event.scorerId) : 'scorer not recorded';
      const assist = event.assistId ? `, assist ${playerName(match, event.assistId)}` : '';
      return `Goal: ${scorer}${kind}${assist}`;
    }
    case 'substitution':
      return `${playerName(match, event.outPlayerId)} OFF, ${playerName(match, event.inPlayerId)} ON`;
    case 'yellowCard':
      return `Yellow card: ${playerName(match, event.playerId)}`;
    case 'redCard':
      return `Red card: ${playerName(match, event.playerId)}`;
    case 'note':
      return event.text;
    case 'periodMarker':
      return MARKER_LABELS[event.marker] ?? 'Period change';
  }
}

/** One timeline line: "67' | Home Team | Player A OFF, Player B ON". */
export function timelineText(match: Match, analyzed: AnalyzedEvent): string {
  const e = analyzed.event;
  const team = 'teamId' in e ? teamName(match, e.teamId) : null;
  return [analyzed.minute, team, describeEvent(match, e)].filter(Boolean).join(' | ');
}
