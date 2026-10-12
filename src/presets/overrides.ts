import { z } from 'zod';
import { SOURCE_POSITIONS } from '@/domain/presets/types';
import type { PlayerPreset, SeasonPresets, SourcePosition, TeamPreset } from '@/domain/presets/types';

/**
 * Hand-made corrections that must survive a refresh.
 *
 * When the official source is wrong or silent about something, the fix goes in an overrides file
 * (`data/presets/<league>/<season>.overrides.json`) rather than in the generated season file, which
 * the importer rewrites. Each override says why and where the value comes from; it is applied after
 * every import, marked `verification: 'manual'`, and listed in the report so it can be retired once
 * the source catches up.
 */

export const OVERRIDES_FORMAT = 'dizpitch.presetoverrides';

const reason = z.string().trim().min(3).max(200);
const sourceUrl = z.string().url().max(500).optional();
const nullableText = (max = 80) => z.string().trim().min(1).max(max).nullable();

const teamOverride = z
  .object({
    displayName: z.string().trim().min(1).max(60),
    shortName: nullableText(60),
    abbreviation: nullableText(12),
    city: nullableText(80),
    venue: nullableText(120),
    logoUrl: z.string().url().max(500).nullable(),
    coachName: z.string().trim().min(1).max(80),
    reason,
    source: sourceUrl,
  })
  .partial()
  .required({ reason: true });

const playerOverride = z
  .object({
    name: z.string().trim().min(1).max(80),
    shirtNumber: z.number().int().min(1).max(99).nullable(),
    position: z.enum(SOURCE_POSITIONS as unknown as [SourcePosition, ...SourcePosition[]]).nullable(),
    nationality: nullableText(60),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    headshotUrl: z.string().url().max(500).nullable(),
    reason,
    source: sourceUrl,
  })
  .partial()
  .required({ reason: true });

export const overridesSchema = z.object({
  format: z.literal(OVERRIDES_FORMAT),
  schemaVersion: z.literal(1),
  league: z.string().min(1).max(40),
  season: z.string().regex(/^\d{4}-\d{2}$/),
  teams: z.record(z.string(), teamOverride).default({}),
  players: z.record(z.string(), playerOverride).default({}),
});

export type PresetOverrides = z.infer<typeof overridesSchema>;

export interface OverrideReport {
  applied: string[];
  /** Overrides that name a team/player that is not in the data (probably stale). */
  unmatched: string[];
  /** Overrides whose value now equals what the source says: safe to delete. */
  redundant: string[];
}

function stamp(note: string, overrideReason: string, source: string | undefined): string {
  return `Override: ${note} — ${overrideReason}${source ? ` (${source})` : ''}`;
}

/** Returns a copy of `doc` with the overrides applied. Never mutates its input. */
export function applyOverrides(doc: SeasonPresets, overrides: PresetOverrides): { doc: SeasonPresets; report: OverrideReport } {
  const report: OverrideReport = { applied: [], unmatched: [], redundant: [] };
  const teams: TeamPreset[] = doc.teams.map((t) => ({ ...t, notes: [...t.notes], players: t.players.map((p) => ({ ...p, notes: [...p.notes] })) }));
  const byTeam = new Map(teams.map((t) => [t.id, t]));

  for (const [teamId, o] of Object.entries(overrides.teams)) {
    const team = byTeam.get(teamId);
    if (!team) {
      report.unmatched.push(`team ${teamId}`);
      continue;
    }
    const set = <K extends 'displayName' | 'shortName' | 'abbreviation' | 'city' | 'venue' | 'logoUrl'>(key: K, value: TeamPreset[K] | undefined) => {
      if (value === undefined) return;
      if (team[key] === value) report.redundant.push(`${team.displayName}.${key}`);
      else {
        team[key] = value;
        report.applied.push(`${team.displayName}.${key}`);
        team.notes.push(stamp(`${key} set to ${value === null ? 'blank' : `"${String(value)}"`}`, o.reason, o.source));
        team.verification = 'manual';
      }
    };
    set('displayName', o.displayName);
    set('shortName', o.shortName);
    set('abbreviation', o.abbreviation);
    set('city', o.city);
    set('venue', o.venue);
    set('logoUrl', o.logoUrl);
    if (o.coachName !== undefined) {
      if (team.coach?.name === o.coachName) report.redundant.push(`${team.displayName}.coach`);
      else {
        team.coach = {
          sourceId: null,
          name: o.coachName,
          role: team.coach?.role ?? 'Head Coach',
          nationality: team.coach?.nationality ?? null,
          photoUrl: team.coach?.photoUrl ?? null,
          verification: 'manual',
          notes: [stamp(`head coach set to "${o.coachName}"`, o.reason, o.source)],
          source: team.coach?.source ?? team.source,
        };
        report.applied.push(`${team.displayName}.coach`);
      }
    }
  }

  const players = new Map<string, { team: TeamPreset; player: PlayerPreset }>();
  for (const team of teams) for (const player of team.players) players.set(player.id, { team, player });

  for (const [playerId, o] of Object.entries(overrides.players)) {
    const found = players.get(playerId);
    if (!found) {
      report.unmatched.push(`player ${playerId}`);
      continue;
    }
    const { player, team } = found;
    const label = `${team.displayName}: ${player.name}`;
    const set = <K extends 'name' | 'shirtNumber' | 'position' | 'nationality' | 'dateOfBirth' | 'headshotUrl'>(key: K, value: PlayerPreset[K] | undefined) => {
      if (value === undefined) return;
      if (player[key] === value) report.redundant.push(`${label}.${key}`);
      else {
        player[key] = value;
        report.applied.push(`${label}.${key}`);
        player.notes.push(stamp(`${key} set to ${value === null ? 'blank' : `"${String(value)}"`}`, o.reason, o.source));
        player.verification = 'manual';
      }
    };
    set('name', o.name);
    set('shirtNumber', o.shirtNumber);
    set('position', o.position);
    set('nationality', o.nationality);
    set('dateOfBirth', o.dateOfBirth);
    set('headshotUrl', o.headshotUrl);
  }

  return { doc: { ...doc, teams }, report };
}
