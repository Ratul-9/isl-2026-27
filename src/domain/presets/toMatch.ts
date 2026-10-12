import { createMatch } from '../match';
import { validateSquadIntegrity } from '../squad';
import type { Id, Match } from '../types';
import { snapshotTeam } from './snapshot';
import type { SnapshotContext } from './snapshot';
import type { SeasonPresets, TeamPreset } from './types';

export class PresetSelectionError extends Error {}

/**
 * A normal, empty-lineup DizPitch match whose home and away teams are snapshots of two presets
 * (invariant 45). It is the same `Match` as one created by hand: no extra fields beyond the
 * optional preset provenance, no link back to the preset.
 *
 * The competition is filled in from the season (the user chose it); date, kick-off, venue and
 * officials stay blank because the preset does not know them.
 */
export function buildMatchFromPresets(
  season: Pick<SeasonPresets, 'league' | 'season'>,
  home: TeamPreset,
  away: TeamPreset,
  snapshotAt: string,
  newId: (prefix: string) => Id,
): Match {
  if (home.id === away.id) throw new PresetSelectionError('Choose two different teams.');

  const ctx: SnapshotContext = { league: season.league.id, season: season.season, snapshotAt };
  const base = createMatch();
  const match: Match = {
    ...base,
    competition: `${season.league.name} ${season.season}`.slice(0, 80),
    home: snapshotTeam(base.home, home, ctx, newId),
    away: snapshotTeam(base.away, away, ctx, newId),
  };

  for (const [label, team] of [['Home team', match.home], ['Away team', match.away]] as const) {
    const problems = validateSquadIntegrity(team);
    if (problems.length > 0) throw new PresetSelectionError(`${label}: ${problems.map((p) => p.message).join(' ')}`);
  }
  return match;
}
