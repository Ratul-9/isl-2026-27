import { addPlayer } from './squad';
import type { PlayerDraft } from './squad';
import { emptyTeam } from './testing';
import type { PositionCode, Team, TeamSide } from './types';

/** A realistic 4-3-3 starting XI plus bench, for layout/pattern tests. */
const XI: [string, number, PositionCode][] = [
  ['Keeper', 1, 'GK'],
  ['Left Back', 3, 'LB'],
  ['Left CB', 4, 'CB'],
  ['Right CB', 5, 'CB'],
  ['Right Back', 2, 'RB'],
  ['Pivot', 6, 'CDM'],
  ['Left Mid', 8, 'CM'],
  ['Right Mid', 10, 'CM'],
  ['Left Wing', 11, 'LW'],
  ['Striker', 9, 'ST'],
  ['Right Wing', 7, 'RW'],
];

export function fullTeam(side: TeamSide = 'home', starters = 11, subs = 3): Team {
  let team = emptyTeam(`${side}-team`, side);
  const add = (draft: PlayerDraft, id: string) => {
    const r = addPlayer(team, draft, id);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    team = r.team;
  };
  XI.slice(0, starters).forEach(([name, shirtNumber, preferredPosition], i) =>
    add({ name, shirtNumber, preferredPosition, notes: '', role: 'starter' }, `${side}-p${i}`),
  );
  for (let i = 0; i < subs; i++) {
    add({ name: `Sub ${i}`, shirtNumber: 12 + i, preferredPosition: 'CM', notes: '', role: 'substitute' }, `${side}-s${i}`);
  }
  return team;
}
