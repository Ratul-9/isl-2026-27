import type { Id, Match } from '@/domain/types';
import { compactName } from '@/components/pitch/labels';

/** "#9 Surname" for a player id on either team, or null if unknown. */
export function playerLabel(match: Match, playerId: Id | undefined): string | null {
  if (!playerId) return null;
  const player = [...match.home.players, ...match.away.players].find((p) => p.id === playerId);
  return player ? `#${player.shirtNumber} ${compactName(player.name)}` : null;
}
