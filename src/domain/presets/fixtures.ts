/** TEST-ONLY synthetic presets. Never imported by production code. */
import type { PlayerPreset, SeasonPresets, SourcePosition, TeamPreset } from './types';

const SOURCE = { url: 'https://www.indiansuperleague.com/clubs/1-test-profile/squad', retrievedAt: '2026-10-10T10:00:00.000Z' };

export function presetPlayer(overrides: Partial<PlayerPreset> & Pick<PlayerPreset, 'id' | 'name'>): PlayerPreset {
  return {
    sourceId: overrides.id.replace(/\D+/g, '') || '1',
    displayName: null,
    shirtNumber: null,
    position: 'Midfielder',
    nationality: 'India',
    dateOfBirth: '1998-05-17',
    headshotUrl: `https://www.indiansuperleague.com/static-assets/images/players/${overrides.id.replace(/\D+/g, '')}.png`,
    profileUrl: `https://www.indiansuperleague.com/players/midfielder-${overrides.id.replace(/\D+/g, '')}-profile`,
    verification: 'official',
    notes: [],
    source: SOURCE,
    ...overrides,
  };
}

const LAYOUT: SourcePosition[] = [
  'Goalkeeper', 'Goalkeeper',
  'Defender', 'Defender', 'Defender', 'Defender', 'Defender', 'Defender',
  'Midfielder', 'Midfielder', 'Midfielder', 'Midfielder', 'Midfielder', 'Midfielder', 'Midfielder',
  'Forward', 'Forward', 'Forward', 'Forward', 'Forward',
];

/** A full-size squad (more than the 22-player matchday limit) with unique numbers 1..n. */
export function presetTeam(
  key: string,
  options: { name?: string; players?: PlayerPreset[]; coach?: string | null; size?: number } = {},
): TeamPreset {
  const name = options.name ?? `Test FC ${key.toUpperCase()}`;
  const size = options.size ?? 26;
  const players =
    options.players ??
    Array.from({ length: size }, (_, i) =>
      presetPlayer({
        id: `isl-player-${key}${i + 1}`.replace(/[^a-z0-9-]/g, '').toLowerCase(),
        name: `Player ${key.toUpperCase()}${i + 1}`,
        shirtNumber: i + 1,
        position: LAYOUT[i % LAYOUT.length],
      }),
    );
  const coach = options.coach === undefined ? `Coach ${key.toUpperCase()}` : options.coach;
  return {
    id: `isl-club-${key}`,
    sourceId: key,
    officialName: name,
    displayName: name,
    shortName: null,
    abbreviation: key.toUpperCase().slice(0, 3),
    city: `City ${key.toUpperCase()}`,
    venue: `Stadium ${key.toUpperCase()}, City ${key.toUpperCase()}`,
    logoUrl: `https://www.indiansuperleague.com/static-assets/images/club/${key}.png`,
    profileUrl: `https://www.indiansuperleague.com/clubs/${key}-profile`,
    coach:
      coach === null
        ? null
        : {
            sourceId: `c-${key}`,
            name: coach,
            role: 'Head Coach',
            nationality: 'Spain',
            photoUrl: `https://www.indiansuperleague.com/static-assets/images/support-staff/${key}.png`,
            verification: 'official',
            notes: [],
            source: SOURCE,
          },
    players,
    verification: 'official',
    notes: [],
    source: SOURCE,
  };
}

export function presetSeason(teams: TeamPreset[] = [presetTeam('a'), presetTeam('b'), presetTeam('c')], season = '2026-27'): SeasonPresets {
  return {
    format: 'dizpitch.teampresets',
    schemaVersion: 1,
    league: { id: 'isl', name: 'Indian Super League' },
    season,
    generatedAt: '2026-10-10T10:05:00.000Z',
    generator: 'test fixture',
    sources: [{ name: 'Test source', url: 'https://www.indiansuperleague.com/', retrievedAt: '2026-10-10T10:00:00.000Z' }],
    teams,
  };
}
