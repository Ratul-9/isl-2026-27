import { analyzeEvents } from './events';
import type { Match, MatchEvent } from './types';

/**
 * The score is never stored (invariant 5): it is the count of VALID goal
 * events per credited team. An own goal is stored with `teamId` = the team
 * credited (the opponent of the player responsible), so it needs no special
 * case here.
 */
export function computeScore(match: Match, events: readonly MatchEvent[] = match.events): { home: number; away: number } {
  return analyzeEvents(match, events).score;
}
