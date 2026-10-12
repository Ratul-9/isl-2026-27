import { z } from 'zod';
import { MAX_POOL_PLAYERS } from '@/domain/squad';
import { SOURCE_POSITIONS } from '@/domain/presets/types';
import type { PresetManifest, PresetVerification, SeasonPresets, SourcePosition } from '@/domain/presets/types';

/**
 * Everything read from `public/presets/**` or supplied to the importer goes through these schemas.
 * Unknown properties are stripped; problems are reported with their path.
 */

export const PRESET_FORMAT = 'dizpitch.teampresets';
export const MANIFEST_FORMAT = 'dizpitch.presetindex';
export const PRESET_SCHEMA_VERSION = 1;
const MAX_TEAMS_PER_SEASON = 40;
const MAX_NOTES = 20;

function enumOf<T extends string>(values: readonly T[]) {
  return z.enum(values as unknown as [T, ...T[]]);
}

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,58}$/, 'Use lowercase letters, digits and hyphens');
const shortText = (max = 80) => z.string().trim().min(1).max(max);
const optionalText = (max = 80) => z.string().trim().min(1).max(max).nullable();
const iso = z.string().max(40).refine((v) => !Number.isNaN(Date.parse(v)), 'Expected an ISO date-time');
const httpUrl = z
  .string()
  .max(500)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'Expected an http(s) URL');
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Expected a real calendar date (YYYY-MM-DD)');

const verification = enumOf<PresetVerification>(['official', 'manual', 'unverified']);
const source = z.object({ url: httpUrl, retrievedAt: iso });
const notes = z.array(z.string().max(300)).max(MAX_NOTES);

const playerPreset = z.object({
  id: slug,
  sourceId: shortText(40),
  name: shortText(80),
  displayName: optionalText(80),
  shirtNumber: z.number().int().min(0).max(999).nullable(),
  position: enumOf<SourcePosition>(SOURCE_POSITIONS).nullable(),
  nationality: optionalText(60),
  dateOfBirth: dateOnly.nullable(),
  headshotUrl: httpUrl.nullable(),
  profileUrl: httpUrl.nullable(),
  verification,
  notes,
  source,
});

const coachPreset = z.object({
  sourceId: optionalText(40),
  name: shortText(80),
  role: shortText(40),
  nationality: optionalText(60),
  photoUrl: httpUrl.nullable(),
  verification,
  notes,
  source,
});

const teamPreset = z.object({
  id: slug,
  sourceId: shortText(40),
  officialName: shortText(80),
  displayName: shortText(60),
  shortName: optionalText(60),
  abbreviation: optionalText(12),
  city: optionalText(80),
  venue: optionalText(120),
  logoUrl: httpUrl.nullable(),
  profileUrl: httpUrl.nullable(),
  coach: coachPreset.nullable(),
  players: z.array(playerPreset).max(MAX_POOL_PLAYERS),
  verification,
  notes,
  source,
});

const seasonPresetsSchema = z.object({
  format: z.literal(PRESET_FORMAT),
  schemaVersion: z.literal(PRESET_SCHEMA_VERSION),
  league: z.object({ id: slug, name: shortText(80) }),
  season: z.string().regex(/^\d{4}-\d{2}$/, 'Use a season such as 2026-27'),
  generatedAt: iso,
  generator: shortText(120),
  sources: z.array(z.object({ name: shortText(80), url: httpUrl, retrievedAt: iso })).max(40),
  teams: z.array(teamPreset).max(MAX_TEAMS_PER_SEASON),
});

const manifestSchema = z.object({
  format: z.literal(MANIFEST_FORMAT),
  schemaVersion: z.literal(PRESET_SCHEMA_VERSION),
  seasons: z
    .array(
      z.object({
        league: z.object({ id: slug, name: shortText(80) }),
        season: z.string().regex(/^\d{4}-\d{2}$/),
        file: z.string().min(1).max(200).regex(/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/, 'A relative path without ".."').refine((f) => !f.split('/').includes('..')),
        teams: z.number().int().min(0),
        players: z.number().int().min(0),
        generatedAt: iso,
      }),
    )
    .max(100),
});

/** Compile-time proof that the schemas produce exactly the domain types. */
function asSeasonPresets(parsed: z.infer<typeof seasonPresetsSchema>): SeasonPresets {
  return parsed satisfies SeasonPresets;
}
function asManifest(parsed: z.infer<typeof manifestSchema>): PresetManifest {
  return parsed satisfies PresetManifest;
}

export type PresetParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, part) => (typeof part === 'number' ? `${acc}[${part}]` : acc ? `${acc}.${String(part)}` : String(part)), '');
}

function describe(error: z.ZodError): string[] {
  const issues = error.issues.map((i) => `${formatPath(i.path) || 'document'}: ${i.message}`);
  return issues.length > 8 ? [...issues.slice(0, 8), `…and ${issues.length - 8} more problem(s).`] : issues;
}

export function parseSeasonPresets(raw: unknown): PresetParseResult<SeasonPresets> {
  const parsed = seasonPresetsSchema.safeParse(raw);
  return parsed.success ? { ok: true, value: asSeasonPresets(parsed.data) } : { ok: false, errors: describe(parsed.error) };
}

export function parseManifest(raw: unknown): PresetParseResult<PresetManifest> {
  const parsed = manifestSchema.safeParse(raw);
  return parsed.success ? { ok: true, value: asManifest(parsed.data) } : { ok: false, errors: describe(parsed.error) };
}
