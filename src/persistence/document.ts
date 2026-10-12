import { analyzeEvents } from '@/domain/events';
import { repairReplay } from '@/domain/replay/integrity';
import { validateTracking } from '@/domain/tracking/build';
import { validateSquadIntegrity } from '@/domain/squad';
import { isPlayingPeriod } from '@/domain/time';
import type { FormationRef, Match, Team } from '@/domain/types';
import { migrateMatch } from './migrate';
import { asMatch, CURRENT_SCHEMA_VERSION, FORMAT_ID, matchSchema } from './schema';

/**
 * Versioned match documents: the shape used both for browser storage and for
 * JSON export/import. Parsing never throws; it returns readable errors.
 */

export interface MatchDocument {
  format: typeof FORMAT_ID;
  schemaVersion: number;
  /** ISO timestamp of when this document was written. */
  savedAt: string;
  match: Match;
}

export type ParseResult =
  | { ok: true; match: Match; warnings: string[]; savedAt: string | null }
  | { ok: false; errors: string[] };

/** Largest file the importer will read (a full match is well under 1 MB). */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_REPORTED_ISSUES = 8;

export function createDocument(match: Match, now: Date): MatchDocument {
  return { format: FORMAT_ID, schemaVersion: CURRENT_SCHEMA_VERSION, savedAt: now.toISOString(), match };
}

/**
 * Readable JSON (2-space indent), except computer-vision tracking blocks, which are written on one line: indenting
 * their long number arrays would put every number on its own line and multiply the stored size about five times.
 * Parsing is unaffected; the data round-trips exactly.
 */
export function serializeDocument(match: Match, now: Date): string {
  const blocks = match.replays.map((r) => (r.tracking ? JSON.stringify(r.tracking) : null));
  if (blocks.every((b) => b === null)) return JSON.stringify(createDocument(match, now), null, 2);
  const plain = JSON.stringify(createDocument(match, now));
  // A placeholder that does not occur anywhere in the document, so no user text can be mistaken for it.
  let tag = 'dizpitch-tracking';
  while (plain.includes(tag)) tag += '-';
  const doc = createDocument({ ...match, replays: match.replays.map((r, i) => (r.tracking ? { ...r, tracking: `${tag}:${i}` as unknown as typeof r.tracking } : r)) }, now);
  return JSON.stringify(doc, null, 2).replace(new RegExp(`"${tag}:(\\d+)"`, 'g'), (_, i: string) => blocks[Number(i)] ?? 'null');
}

/** "home.players[3].shirtNumber" style path. */
function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, part) => {
    if (typeof part === 'number') return `${acc}[${part}]`;
    return acc ? `${acc}.${String(part)}` : String(part);
  }, '');
}

function fail(errors: string[]): ParseResult {
  return { ok: false, errors };
}

/** Validates an already-parsed value (e.g. from localStorage or a JSON file). */
export function parseDocument(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail(['The file does not contain a DizPitch match (expected a JSON object).']);
  }
  const doc = raw as Record<string, unknown>;
  if (doc.format !== FORMAT_ID) {
    return fail([
      'This is not a DizPitch match export (missing or unknown "format" marker). Only files exported from DizPitch can be imported.',
    ]);
  }
  if (typeof doc.schemaVersion !== 'number') return fail(['The file has no schema version, so it cannot be read safely.']);
  if (typeof doc.match !== 'object' || doc.match === null || Array.isArray(doc.match)) {
    return fail(['The file has no "match" section.']);
  }

  const migrated = migrateMatch(doc.match as Record<string, unknown>, doc.schemaVersion);
  if (!migrated.ok) return fail([migrated.error]);

  const parsed = matchSchema.safeParse(migrated.match);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${formatPath(i.path) || 'match'}: ${i.message}`);
    const shown = issues.slice(0, MAX_REPORTED_ISSUES);
    if (issues.length > shown.length) shown.push(`…and ${issues.length - shown.length} more problem(s).`);
    return fail(['The match data is not valid:', ...shown]);
  }

  const warnings: string[] = [];
  let match = asMatch(parsed.data);

  // --- cross-field consistency (cannot be expressed in the schema) ---------
  const errors: string[] = [];
  if (match.home.id === match.away.id) errors.push('The home and away teams share the same id.');
  const duplicates = (label: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const value of ids) {
      if (seen.has(value)) errors.push(`${label} id "${value}" is used more than once.`);
      seen.add(value);
    }
  };
  duplicates(
    'Player',
    [...match.home.players, ...(match.home.pool ?? []), ...match.away.players, ...(match.away.pool ?? [])].map((p) => p.id),
  );
  duplicates('Slot', [...match.home.slots, ...match.away.slots].map((s) => s.id));
  duplicates('Event', match.events.map((e) => e.id));
  duplicates('Drawing', match.drawings.map((d) => d.id));
  duplicates('Saved arrangement', match.savedLayouts.map((l) => l.id));
  duplicates('Replay', match.replays.map((r) => r.id));
  for (const r of match.replays) {
    // Tracking arrays must line up frame by frame; the schema alone cannot say so.
    if ((r.origin === 'tracking') !== (r.tracking !== null)) errors.push(`Replay "${r.title}": tracking data does not match its origin.`);
    if (r.tracking) for (const problem of validateTracking(r.tracking)) errors.push(`Replay "${r.title}": ${problem}`);
  }
  for (const [label, t] of [['Home', match.home], ['Away', match.away]] as const) {
    for (const problem of validateSquadIntegrity(t)) errors.push(`${label} team: ${problem.message}`);
  }
  if (errors.length > 0) return fail(['The match data is inconsistent:', ...errors.slice(0, MAX_REPORTED_ISSUES)]);

  // --- repairs that lose nothing, reported as warnings ---------------------
  const layoutIds = new Set(match.savedLayouts.map((l) => l.id));
  const repairFormation = (t: Team, label: string): Team => {
    const ref: FormationRef = t.formation;
    if (ref.kind === 'saved' && !layoutIds.has(ref.id)) {
      warnings.push(`${label} team used a saved arrangement that is not in the file; it was reset to 4-3-3.`);
      return { ...t, formation: { kind: 'preset', id: '4-3-3' } };
    }
    return t;
  };
  match = { ...match, home: repairFormation(match.home, 'Home'), away: repairFormation(match.away, 'Away') };

  // Replay links to squad players / actors that no longer exist are cleared (the replay itself is untouched).
  const squads = {
    home: new Set([...match.home.players, ...(match.home.pool ?? [])].map((p) => p.id)),
    away: new Set([...match.away.players, ...(match.away.pool ?? [])].map((p) => p.id)),
  };
  match = {
    ...match,
    replays: match.replays.map((r) => {
      const repaired = repairReplay(r, squads);
      warnings.push(...repaired.warnings);
      return repaired.replay;
    }),
  };

  if (match.clock.runningSinceEpochMs !== null && !isPlayingPeriod(match.clock.period)) {
    warnings.push('The clock was marked as running outside a half; it was paused.');
    match = { ...match, clock: { ...match.clock, runningSinceEpochMs: null } };
  }

  const invalid = analyzeEvents(match).ordered.filter((a) => a.errors.length > 0).length;
  if (invalid > 0) {
    warnings.push(
      `${invalid} event${invalid === 1 ? ' is' : 's are'} inconsistent with the squads and will be ignored in the score and lineups until fixed.`,
    );
  }

  const savedAt = typeof doc.savedAt === 'string' ? doc.savedAt : null;
  return { ok: true, match, warnings, savedAt };
}

/** Parses the text of a `.json` file. */
export function parseMatchJson(text: string): ParseResult {
  if (text.length > MAX_IMPORT_BYTES) {
    return fail([`The file is larger than ${MAX_IMPORT_BYTES / (1024 * 1024)} MB, which is far more than a match needs.`]);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? ` (${error.message})` : '';
    return fail([`The file is not valid JSON${detail}.`]);
  }
  return parseDocument(raw);
}

/** A safe file name such as `dizpitch-home-fc-vs-away-fc-2026-10-10.json`. */
export function exportFileName(match: Match, extension: 'json' | 'png', now: Date): string {
  const base = [match.name || [match.home.name, match.away.name].filter(Boolean).join(' vs ') || 'match']
    .join('')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  const day = (match.date || now.toISOString().slice(0, 10)).slice(0, 10);
  return `dizpitch-${base || 'match'}-${day}.${extension}`;
}
