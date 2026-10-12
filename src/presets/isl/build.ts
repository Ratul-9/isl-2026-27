import { SOURCE_POSITIONS } from '@/domain/presets/types';
import type { CoachPreset, PlayerPreset, PresetSourceRef, SeasonPresets, SourcePosition, TeamPreset } from '@/domain/presets/types';
import { PRESET_FORMAT, PRESET_SCHEMA_VERSION } from '../schema';
import { absoluteUrl, ISL_ORIGIN } from './parse';
import type { IslClubLink, IslFixturesInfo, IslPlayerProfile, IslSquadPage } from './parse';

export const ISL_LEAGUE = { id: 'isl', name: 'Indian Super League' } as const;

export interface IslSquadInput {
  club: IslClubLink;
  page: IslSquadPage;
  /** URL the squad page was read from. */
  url: string;
  retrievedAt: string;
}

export interface IslProfileInput {
  profile: IslPlayerProfile;
  url: string;
  retrievedAt: string;
}

export interface BuildInput {
  season: string;
  fixtures: IslFixturesInfo;
  squads: IslSquadInput[];
  /** Player source id → profile (only when profiles were fetched). */
  profiles: Map<string, IslProfileInput>;
  generatedAt: string;
  generator: string;
  sources: PresetSourceRef[];
}

export interface BuildResult {
  doc: SeasonPresets;
  /** Blocking problems with the source (wrong season, a club that did not belong). Applying must be refused. */
  problems: string[];
}

function sourcePosition(name: string | null, notes: string[]): SourcePosition | null {
  if (name === null) return null;
  const found = SOURCE_POSITIONS.find((p) => p.toLowerCase() === name.toLowerCase());
  if (!found) notes.push(`Position "${name}" is not one of ${SOURCE_POSITIONS.join(', ')} and was left blank.`);
  return found ?? null;
}

/** The text after the last comma of a venue line (`"Sree Kanteerava Stadium, Bengaluru"` → `Bengaluru`). */
export function cityFromVenue(venue: string | null): string | null {
  if (!venue || !venue.includes(',')) return null;
  const last = venue.slice(venue.lastIndexOf(',') + 1).trim();
  return last.length > 0 ? last : null;
}

function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );
}

/** True when one name is a shortened form of the other ("Menno Koch" / "Menno Robert Maria Koch"). */
export function isSamePerson(a: string, b: string): boolean {
  const [x, y] = [nameTokens(a), nameTokens(b)];
  if (x.size === 0 || y.size === 0) return true;
  const [small, large] = x.size <= y.size ? [x, y] : [y, x];
  return [...small].every((t) => large.has(t));
}

function buildPlayer(
  raw: IslSquadPage['players'][number],
  squad: IslSquadInput,
  profile: IslProfileInput | undefined,
): PlayerPreset {
  const notes: string[] = [];
  if (raw.shirtNumber === null && raw.shirtNumberText !== null && raw.shirtNumberText !== '') {
    notes.push(`Shirt number is published as "${raw.shirtNumberText}", which is not a usable number; left blank.`);
  } else if (raw.shirtNumber !== null && raw.shirtNumber > 99) {
    notes.push(`Shirt number ${raw.shirtNumber} is above 99, which DizPitch cannot use as-is.`);
  }
  if (profile) notes.push(...profile.profile.notes);
  if (profile?.profile.fullName && !isSamePerson(profile.profile.fullName, raw.fullName)) {
    notes.push(`Profile page names the player "${profile.profile.fullName}"; the squad page says "${raw.fullName}".`);
  }

  return {
    id: `isl-player-${raw.sourceId}`,
    sourceId: raw.sourceId,
    name: raw.fullName,
    displayName: raw.shortName,
    shirtNumber: raw.shirtNumber,
    position: sourcePosition(raw.positionName, notes),
    nationality: raw.nationality ?? profile?.profile.nationality ?? null,
    dateOfBirth: profile?.profile.dateOfBirth ?? null,
    headshotUrl: raw.headshotUrl,
    profileUrl: raw.profileUrl,
    verification: 'official',
    notes,
    source: { url: squad.url, retrievedAt: squad.retrievedAt },
  };
}

function buildCoach(squad: IslSquadInput, notes: string[]): CoachPreset | null {
  const heads = squad.page.staff.filter((s) => s.role.toLowerCase() === 'head coach');
  if (heads.length === 0) return null;
  if (heads.length > 1) notes.push(`The page lists ${heads.length} head coaches (${heads.map((h) => h.name).join(', ')}); the first was used.`);
  const head = heads[0];
  return {
    sourceId: head.sourceId,
    name: head.name,
    role: 'Head Coach',
    nationality: head.nationality,
    photoUrl: head.photoUrl,
    verification: 'official',
    notes: [],
    source: { url: squad.url, retrievedAt: squad.retrievedAt },
  };
}

export function buildIslSeason(input: BuildInput): BuildResult {
  const problems: string[] = [];

  const teams: TeamPreset[] = input.squads.map((squad): TeamPreset => {
    const { page, club } = squad;
    const notes: string[] = [...page.warnings];

    if (page.clubSourceId !== club.sourceId) {
      problems.push(`${club.name}: the squad page identifies club ${page.clubSourceId}, expected ${club.sourceId}.`);
    }
    const seasonOfSquad = page.seriesId ? input.fixtures.seasons.get(page.seriesId) : undefined;
    if (!page.seriesId) {
      problems.push(`${club.name}: the squad page does not say which competition series it belongs to, so its season cannot be confirmed.`);
    } else if (seasonOfSquad !== input.season) {
      problems.push(
        `${club.name}: the squad belongs to series ${page.seriesId} (${seasonOfSquad ?? 'unknown season'}), not ${input.season}.`,
      );
    }

    // The same club is named slightly differently on different pages of the site; say which one was used.
    const otherNames = [club.name, input.fixtures.abbreviations.get(page.clubSourceId)?.name]
      .filter((n): n is string => !!n && n !== page.clubName)
      .filter((n, i, all) => all.indexOf(n) === i);
    if (otherNames.length > 0) {
      notes.push(`Named "${page.clubName}" on its squad page; other pages of the site say ${otherNames.map((n) => `"${n}"`).join(' and ')}.`);
    }

    const city = cityFromVenue(page.venue);
    if (page.venue && city === null) notes.push(`Venue "${page.venue}" has no city part, so no home city was set.`);
    if (!page.venue) notes.push('The page gives no venue.');

    const players = page.players.map((p) => buildPlayer(p, squad, input.profiles.get(p.sourceId)));
    const abbreviation = input.fixtures.abbreviations.get(page.clubSourceId)?.abbreviation ?? null;

    return {
      id: `isl-club-${page.clubSourceId}`,
      sourceId: page.clubSourceId,
      officialName: page.clubName,
      displayName: page.clubName,
      shortName: null,
      abbreviation,
      city,
      venue: page.venue,
      logoUrl: page.logoUrl,
      profileUrl: absoluteUrl(club.path) ?? `${ISL_ORIGIN}${club.path}`,
      coach: buildCoach(squad, notes),
      players,
      verification: 'official',
      notes,
      source: { url: squad.url, retrievedAt: squad.retrievedAt },
    };
  });

  teams.sort((a, b) => a.displayName.localeCompare(b.displayName));

  return {
    doc: {
      format: PRESET_FORMAT,
      schemaVersion: PRESET_SCHEMA_VERSION,
      league: { ...ISL_LEAGUE },
      season: input.season,
      generatedAt: input.generatedAt,
      generator: input.generator,
      sources: input.sources,
      teams,
    },
    problems,
  };
}
