import { fullTeam } from './fixtures';
import { createMatch } from './match';
import { matchTimeFromMinute } from './time';
import type { GoalType, Id, Match, MatchEvent, PlayingPeriod } from './types';

/**
 * Test builders for match events. Home players: `home-p0` (GK) … `home-p10`
 * starters (p9 = striker), `home-s0..s2` substitutes; same for away.
 */
export function squadMatch(): Match {
  return { ...createMatch(), home: { ...fullTeam('home'), name: 'Home FC' }, away: { ...fullTeam('away'), name: 'Away FC' } };
}

let seq = 0;
const nextId = () => `e${++seq}`;

/** Time helper: minute (+added) → { period, matchTimeMs } for a 90-minute match. */
export function at(minute: number, added = 0): { period: PlayingPeriod; matchTimeMs: number } {
  const period: PlayingPeriod =
    minute <= 45 ? 'firstHalf' : minute <= 90 ? 'secondHalf' : minute <= 105 ? 'extraTimeFirstHalf' : 'extraTimeSecondHalf';
  return { period, matchTimeMs: matchTimeFromMinute(period, minute, added, 90) };
}

export function goal(
  m: Match,
  side: 'home' | 'away',
  when: ReturnType<typeof at>,
  opts: { scorer?: Id; assist?: Id; type?: GoalType; id?: Id } = {},
): MatchEvent {
  return {
    id: opts.id ?? nextId(),
    type: 'goal',
    teamId: m[side].id,
    scorerId: opts.scorer,
    assistId: opts.assist,
    goalType: opts.type ?? 'normal',
    ...when,
  };
}

export function sub(m: Match, side: 'home' | 'away', when: ReturnType<typeof at>, out: Id, inn: Id, id?: Id): MatchEvent {
  return { id: id ?? nextId(), type: 'substitution', teamId: m[side].id, outPlayerId: out, inPlayerId: inn, ...when };
}

export function card(
  m: Match,
  side: 'home' | 'away',
  when: ReturnType<typeof at>,
  playerId: Id,
  colour: 'yellow' | 'red',
  id?: Id,
): MatchEvent {
  return { id: id ?? nextId(), type: colour === 'yellow' ? 'yellowCard' : 'redCard', teamId: m[side].id, playerId, ...when };
}

export const withEvents = (m: Match, ...events: MatchEvent[]): Match => ({ ...m, events });
