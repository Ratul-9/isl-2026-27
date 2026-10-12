import { defaultSlots, SLOT_COUNT } from './layout';
import type { Id, Team, TeamSide } from './types';

/** A team in the default 4-3-3 with 11 empty slots and no players. */
export function emptyTeam(id: Id = 'team', side: TeamSide = 'home'): Team {
  const slotIds = Array.from({ length: SLOT_COUNT }, (_, i) => `${id}-slot${i}`);
  return {
    id,
    name: '',
    coach: '',
    players: [],
    slots: defaultSlots(side, slotIds),
    bench: [],
    formation: { kind: 'preset', id: '4-3-3' },
  };
}
