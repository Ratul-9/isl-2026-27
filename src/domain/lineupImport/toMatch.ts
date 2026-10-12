import { getFormation } from '../formations';
import { createSlots, SLOT_COUNT } from '../layout';
import { createMatch } from '../match';
import { validateSquadIntegrity } from '../squad';
import type { Id, Match, Player, PositionCode, Team, TeamSide } from '../types';
import { positionAt, validateDraftTeam } from './draft';
import type { DraftPlayer, DraftTeam, MatchMetadata } from './types';

export const EMPTY_METADATA: MatchMetadata = {
  competition: '',
  date: '',
  kickoffTime: '',
  venue: '',
  referee: '',
  assistant1: '',
  assistant2: '',
  fourthOfficial: '',
};

function toTeam(draft: DraftTeam, side: TeamSide, base: Team, newId: (prefix: string) => Id): Team {
  const template = getFormation(draft.formation).slots;
  const players: Player[] = [];
  const idByKey = new Map<string, Id>();
  const make = (p: DraftPlayer, fallback: PositionCode): Player => {
    const id = newId('plr');
    idByKey.set(p.key, id);
    return {
      id,
      name: p.name.trim(),
      shirtNumber: p.shirtNumber as number,
      preferredPosition: p.position ?? fallback,
      notes: p.captain ? 'Captain' : '',
    };
  };
  for (const p of draft.starters) players.push(make(p, p.slot !== null ? positionAt(draft, p.slot) : 'CM'));
  for (const p of draft.substitutes) players.push(make(p, 'CM'));

  const slotIds = Array.from({ length: SLOT_COUNT }, () => newId('slot'));
  const slots = createSlots(template, side, slotIds).map((slot, index) => {
    const occupant = draft.starters.find((p) => p.slot === index);
    return occupant ? { ...slot, playerId: idByKey.get(occupant.key) ?? null } : slot;
  });

  return {
    ...base,
    name: draft.teamName.trim(),
    coach: draft.coach.trim(),
    players,
    slots,
    bench: draft.substitutes.map((p) => idByKey.get(p.key) as Id),
    formation: { kind: 'preset', id: draft.formation },
  };
}

export class LineupImportError extends Error {}

/**
 * Builds a normal DizPitch match from the confirmed review drafts. Throws if
 * a blocking issue remains, so an invalid match can never be created.
 */
export function buildMatchFromDrafts(
  home: DraftTeam,
  away: DraftTeam,
  metadata: MatchMetadata,
  newId: (prefix: string) => Id,
): Match {
  const blocking = [...validateDraftTeam(home, 'Home team'), ...validateDraftTeam(away, 'Away team')].filter((i) => i.severity === 'error');
  if (blocking.length > 0) throw new LineupImportError(blocking.map((i) => i.message).join(' '));

  const base = createMatch();
  const match: Match = {
    ...base,
    competition: metadata.competition.trim(),
    date: metadata.date,
    kickoffTime: metadata.kickoffTime,
    venue: metadata.venue.trim(),
    officials: {
      referee: metadata.referee.trim(),
      assistant1: metadata.assistant1.trim(),
      assistant2: metadata.assistant2.trim(),
      fourthOfficial: metadata.fourthOfficial.trim(),
    },
    home: toTeam(home, 'home', base.home, newId),
    away: toTeam(away, 'away', base.away, newId),
  };
  for (const [label, team] of [['Home team', match.home], ['Away team', match.away]] as const) {
    const problems = validateSquadIntegrity(team);
    if (problems.length > 0) throw new LineupImportError(`${label}: ${problems.map((p) => p.message).join(' ')}`);
  }
  return match;
}
