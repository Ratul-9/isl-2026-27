import { SOURCE_POSITIONS } from '@/domain/presets/types';
import type { PlayerPreset, SeasonPresets, SourcePosition, TeamPreset } from '@/domain/presets/types';
import { PRESET_FORMAT, PRESET_SCHEMA_VERSION } from './schema';

/**
 * Manual import: the route for squads that the official site cannot supply (or when it blocks
 * automated access). A CSV has one row per player; the team columns repeat on every row of a team.
 * Every row must name its source, so the data stays auditable.
 *
 * Columns (header row required, any order, extra columns ignored):
 *   team, abbreviation, city, venue, logo_url, coach, coach_photo_url,
 *   player, shirt_number, position, nationality, date_of_birth, headshot_url, profile_url, source_url
 * Only `team`, `player` (blank for a team-only row) and `source_url` are mandatory.
 * Dates are YYYY-MM-DD; position is Goalkeeper, Defender, Midfielder or Forward.
 */

/** RFC 4180-style CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^﻿/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

function slug(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export interface ManualImportContext {
  league: { id: string; name: string };
  season: string;
  /** ISO time of the import (passed in so the function stays deterministic). */
  now: string;
  fileName: string;
}

export interface ManualImportResult {
  doc: SeasonPresets | null;
  errors: string[];
}

function positionFrom(value: string): SourcePosition | null | undefined {
  if (value === '') return null;
  return SOURCE_POSITIONS.find((p) => p.toLowerCase() === value.toLowerCase());
}

export function seasonFromCsv(text: string, ctx: ManualImportContext): ManualImportResult {
  const rows = parseCsv(text);
  const errors: string[] = [];
  if (rows.length < 2) return { doc: null, errors: ['The CSV needs a header row and at least one data row.'] };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const index = new Map(header.map((h, i) => [h, i]));
  for (const required of ['team', 'player', 'source_url']) {
    if (!index.has(required)) errors.push(`Missing required column "${required}".`);
  }
  if (errors.length > 0) return { doc: null, errors };

  const cell = (row: string[], column: string) => (row[index.get(column) ?? -1] ?? '').trim();
  const teams = new Map<string, TeamPreset>();
  const sourcesSeen = new Map<string, string>();

  rows.slice(1).forEach((row, i) => {
    const line = i + 2;
    const where = `Row ${line}`;
    const teamName = cell(row, 'team');
    const sourceUrl = cell(row, 'source_url');
    if (!teamName) return void errors.push(`${where}: team is empty.`);
    if (!sourceUrl) return void errors.push(`${where}: source_url is required so the data can be audited.`);
    const source = { url: sourceUrl, retrievedAt: ctx.now };
    sourcesSeen.set(sourceUrl, sourceUrl);

    const teamId = `${ctx.league.id}-club-${slug(teamName)}`;
    let team = teams.get(teamId);
    if (!team) {
      team = {
        id: teamId,
        sourceId: slug(teamName),
        officialName: teamName,
        displayName: teamName,
        shortName: null,
        abbreviation: cell(row, 'abbreviation') || null,
        city: cell(row, 'city') || null,
        venue: cell(row, 'venue') || null,
        logoUrl: cell(row, 'logo_url') || null,
        profileUrl: null,
        coach: null,
        players: [],
        verification: 'manual',
        notes: [`Supplied manually from ${ctx.fileName}.`],
        source,
      };
      teams.set(teamId, team);
    }
    const coachName = cell(row, 'coach');
    if (coachName && !team.coach) {
      team.coach = {
        sourceId: null,
        name: coachName,
        role: 'Head Coach',
        nationality: null,
        photoUrl: cell(row, 'coach_photo_url') || null,
        verification: 'manual',
        notes: [],
        source,
      };
    } else if (coachName && team.coach && team.coach.name !== coachName) {
      errors.push(`${where}: ${teamName} has two different coaches ("${team.coach.name}" and "${coachName}").`);
    }

    const playerName = cell(row, 'player');
    if (!playerName) return;
    const position = positionFrom(cell(row, 'position'));
    if (position === undefined) errors.push(`${where}: position "${cell(row, 'position')}" must be one of ${SOURCE_POSITIONS.join(', ')}.`);
    const numberText = cell(row, 'shirt_number');
    const shirtNumber = numberText === '' ? null : Number(numberText);
    if (shirtNumber !== null && (!Number.isInteger(shirtNumber) || shirtNumber < 0 || shirtNumber > 999)) {
      errors.push(`${where}: shirt_number "${numberText}" must be a whole number.`);
    }
    const dob = cell(row, 'date_of_birth');
    if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) errors.push(`${where}: date_of_birth "${dob}" must be YYYY-MM-DD.`);

    const player: PlayerPreset = {
      id: `${ctx.league.id}-player-${slug(teamName)}-${slug(playerName)}`,
      sourceId: `${slug(teamName)}-${slug(playerName)}`,
      name: playerName,
      displayName: null,
      shirtNumber: shirtNumber !== null && Number.isInteger(shirtNumber) ? shirtNumber : null,
      position: position ?? null,
      nationality: cell(row, 'nationality') || null,
      dateOfBirth: dob || null,
      headshotUrl: cell(row, 'headshot_url') || null,
      profileUrl: cell(row, 'profile_url') || null,
      verification: 'manual',
      notes: [],
      source,
    };
    if (team.players.some((p) => p.id === player.id)) {
      errors.push(`${where}: ${playerName} appears twice for ${teamName}.`);
      return;
    }
    team.players.push(player);
  });

  if (errors.length > 0) return { doc: null, errors };
  return {
    doc: {
      format: PRESET_FORMAT,
      schemaVersion: PRESET_SCHEMA_VERSION,
      league: ctx.league,
      season: ctx.season,
      generatedAt: ctx.now,
      generator: `manual CSV import (${ctx.fileName})`,
      sources: [...sourcesSeen.keys()].map((url) => ({ name: 'Manual source', url, retrievedAt: ctx.now })),
      teams: [...teams.values()],
    },
    errors: [],
  };
}

/**
 * Manual imports REPLACE the teams they contain and leave every other team of the season untouched,
 * so one club can be corrected or added without re-importing the league.
 */
export function mergeTeams(existing: SeasonPresets | null, incoming: SeasonPresets): SeasonPresets {
  if (existing === null) return incoming;
  const replaced = new Set(incoming.teams.map((t) => t.id));
  const teams = [...existing.teams.filter((t) => !replaced.has(t.id)), ...incoming.teams].sort((a, b) => a.displayName.localeCompare(b.displayName));
  const known = new Set(existing.sources.map((s) => s.url));
  return {
    ...existing,
    generatedAt: incoming.generatedAt,
    generator: `${existing.generator}; ${incoming.generator}`.slice(0, 120),
    sources: [...existing.sources, ...incoming.sources.filter((s) => !known.has(s.url))].slice(0, 40),
    teams,
  };
}
