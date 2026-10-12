import { useMemo } from 'react';
import { teamDisplayName } from '@/domain/match';
import type { Player } from '@/domain/types';
import { useMatch } from '@/store/MatchContext';
import type { TrackNames } from './trackStyle';

/** Team names and squad players of the open match, for labelling tracks. */
export function useTrackNames(): { names: TrackNames; squads: { home: Player[]; away: Player[] } } {
  const match = useMatch();
  return useMemo(() => {
    const players = new Map<string, Player>([...match.home.players, ...match.away.players].map((p) => [p.id, p]));
    return {
      names: { teams: { home: teamDisplayName(match.home, 'home'), away: teamDisplayName(match.away, 'away') }, players },
      squads: { home: match.home.players, away: match.away.players },
    };
  }, [match.home, match.away]);
}
