import { safeImageUrl } from '@/domain/presets/images';
import type { SeasonPresets } from '@/domain/presets/types';

/**
 * Cross-record checks and the data-quality report. The schema (`schema.ts`) says whether a file is
 * structurally valid; this says whether it is trustworthy and complete. Errors block applying an
 * import; warnings are gaps or oddities in the source that are reported, never papered over.
 */

type IssueSeverity = 'error' | 'warning';

export interface PresetIssue {
  severity: IssueSeverity;
  code:
    | 'duplicate-team-id'
    | 'duplicate-team-source'
    | 'duplicate-player-id'
    | 'player-in-multiple-teams'
    | 'possible-duplicate-person'
    | 'duplicate-shirt-number'
    | 'shirt-number-out-of-range'
    | 'unexpected-team-count'
    | 'no-coach'
    | 'small-squad'
    | 'missing-shirt-number'
    | 'missing-position'
    | 'missing-nationality'
    | 'missing-date-of-birth'
    | 'missing-headshot'
    | 'missing-logo'
    | 'missing-city'
    | 'missing-abbreviation'
    | 'image-url-not-allowed'
    | 'unverified-record'
    | 'source-note'
    | 'source-problem';
  message: string;
  teamId?: string;
  playerId?: string;
}

export interface QualityOptions {
  /** How many teams the season is expected to have (the league's published number), if known. */
  expectedTeams?: number;
  /** Smallest squad that is plausible for a club. */
  minSquad?: number;
}

export function checkSeasonPresets(doc: SeasonPresets, options: QualityOptions = {}): PresetIssue[] {
  const issues: PresetIssue[] = [];
  const add = (issue: PresetIssue) => issues.push(issue);
  const minSquad = options.minSquad ?? 11;

  if (options.expectedTeams !== undefined && doc.teams.length !== options.expectedTeams) {
    add({
      severity: 'warning',
      code: 'unexpected-team-count',
      message: `${doc.teams.length} teams imported, ${options.expectedTeams} expected for ${doc.league.name} ${doc.season}.`,
    });
  }

  const teamIds = new Set<string>();
  const teamSources = new Set<string>();
  const playerOwner = new Map<string, string>();
  const people = new Map<string, string>();

  for (const team of doc.teams) {
    const where = { teamId: team.id };
    if (teamIds.has(team.id)) add({ severity: 'error', code: 'duplicate-team-id', message: `Team id ${team.id} is used more than once.`, ...where });
    teamIds.add(team.id);
    if (teamSources.has(team.sourceId)) {
      add({ severity: 'error', code: 'duplicate-team-source', message: `Source club id ${team.sourceId} (${team.displayName}) appears twice.`, ...where });
    }
    teamSources.add(team.sourceId);

    if (team.coach === null) add({ severity: 'warning', code: 'no-coach', message: `${team.displayName}: no head coach.`, ...where });
    if (team.players.length < minSquad) {
      add({ severity: 'warning', code: 'small-squad', message: `${team.displayName}: only ${team.players.length} players listed.`, ...where });
    }
    if (team.logoUrl === null) add({ severity: 'warning', code: 'missing-logo', message: `${team.displayName}: no logo URL.`, ...where });
    if (team.city === null) add({ severity: 'warning', code: 'missing-city', message: `${team.displayName}: no home city in the source.`, ...where });
    if (team.abbreviation === null) add({ severity: 'warning', code: 'missing-abbreviation', message: `${team.displayName}: no abbreviation.`, ...where });
    if (team.verification === 'unverified') add({ severity: 'warning', code: 'unverified-record', message: `${team.displayName}: team record is unverified.`, ...where });

    const checkImage = (label: string, url: string | null, playerId?: string) => {
      if (url !== null && safeImageUrl(url) === null) {
        add({ severity: 'warning', code: 'image-url-not-allowed', message: `${label}: image URL is not https on an allowed host, so it will not be shown (${url}).`, ...where, playerId });
      }
    };
    checkImage(`${team.displayName} logo`, team.logoUrl);
    if (team.coach) checkImage(`${team.displayName} coach`, team.coach.photoUrl);

    const numbers = new Map<number, string[]>();
    for (const p of team.players) {
      const who = `${team.displayName}: ${p.name}`;
      const at = { ...where, playerId: p.id };
      const previousOwner = playerOwner.get(p.id);
      if (previousOwner === team.id) add({ severity: 'error', code: 'duplicate-player-id', message: `${who}: player id ${p.id} appears twice in the squad.`, ...at });
      else if (previousOwner) {
        add({ severity: 'error', code: 'player-in-multiple-teams', message: `${who}: player id ${p.id} is also listed for ${previousOwner}.`, ...at });
      }
      playerOwner.set(p.id, previousOwner ?? team.id);

      if (p.shirtNumber === null) add({ severity: 'warning', code: 'missing-shirt-number', message: `${who}: no shirt number.`, ...at });
      else if (p.shirtNumber < 1 || p.shirtNumber > 99) {
        add({ severity: 'warning', code: 'shirt-number-out-of-range', message: `${who}: shirt number ${p.shirtNumber} is outside 1–99 and cannot be used as-is.`, ...at });
      } else numbers.set(p.shirtNumber, [...(numbers.get(p.shirtNumber) ?? []), p.name]);
      if (p.position === null) add({ severity: 'warning', code: 'missing-position', message: `${who}: no position.`, ...at });
      if (p.nationality === null) add({ severity: 'warning', code: 'missing-nationality', message: `${who}: no nationality.`, ...at });
      if (p.dateOfBirth === null) add({ severity: 'warning', code: 'missing-date-of-birth', message: `${who}: no date of birth.`, ...at });
      if (p.headshotUrl === null) add({ severity: 'warning', code: 'missing-headshot', message: `${who}: no headshot URL.`, ...at });
      else checkImage(`${who} headshot`, p.headshotUrl, p.id);
      if (p.verification === 'unverified') add({ severity: 'warning', code: 'unverified-record', message: `${who}: unverified record.`, ...at });
      for (const note of p.notes) add({ severity: 'warning', code: 'source-note', message: `${who}: ${note}`, ...at });

      if (p.dateOfBirth !== null) {
        const key = `${p.name.toLowerCase()}|${p.dateOfBirth}`;
        const other = people.get(key);
        if (other && other !== p.id) {
          add({ severity: 'warning', code: 'possible-duplicate-person', message: `${who}: same name and date of birth as ${other}.`, ...at });
        }
        people.set(key, p.id);
      }
    }
    for (const [number, names] of numbers) {
      if (names.length > 1) {
        add({ severity: 'warning', code: 'duplicate-shirt-number', message: `${team.displayName}: #${number} is listed for ${names.join(' and ')}.`, ...where });
      }
    }
  }
  return issues;
}

export interface PresetSummary {
  league: string;
  season: string;
  teams: number;
  players: number;
  coaches: number;
  perTeam: { id: string; name: string; players: number; coach: string | null }[];
  gaps: Record<string, number>;
}

export function summarizeSeason(doc: SeasonPresets): PresetSummary {
  const all = doc.teams.flatMap((t) => t.players);
  const count = (pred: (p: (typeof all)[number]) => boolean) => all.filter(pred).length;
  return {
    league: doc.league.name,
    season: doc.season,
    teams: doc.teams.length,
    players: all.length,
    coaches: doc.teams.filter((t) => t.coach !== null).length,
    perTeam: doc.teams.map((t) => ({ id: t.id, name: t.displayName, players: t.players.length, coach: t.coach?.name ?? null })),
    gaps: {
      'teams without a head coach': doc.teams.filter((t) => t.coach === null).length,
      'teams without a logo': doc.teams.filter((t) => t.logoUrl === null).length,
      'teams without a home city': doc.teams.filter((t) => t.city === null).length,
      'teams without an abbreviation': doc.teams.filter((t) => t.abbreviation === null).length,
      'teams without a short name': doc.teams.filter((t) => t.shortName === null).length,
      'coaches without a photo': doc.teams.filter((t) => t.coach && t.coach.photoUrl === null).length,
      'players without a shirt number': count((p) => p.shirtNumber === null),
      'players without a position': count((p) => p.position === null),
      'players without a nationality': count((p) => p.nationality === null),
      'players without a date of birth': count((p) => p.dateOfBirth === null),
      'players without a headshot URL': count((p) => p.headshotUrl === null),
      'players without a profile URL': count((p) => p.profileUrl === null),
    },
  };
}
