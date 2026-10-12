import { MAX_POOL_PLAYERS, MAX_SHIRT_NUMBER, MIN_SHIRT_NUMBER } from '../squad';
import type { Id, Player, PlayerOrigin, PositionCode, Team, TeamOrigin } from '../types';
import type { PlayerPreset, SourcePosition, TeamPreset } from './types';

/**
 * Copies a preset team into a match team (invariant 45). The result shares nothing with the
 * preset: every player gets a fresh match id, and the imported values are kept in `origin` /
 * `preset` so later manual corrections can be told apart from imported data.
 *
 * The whole squad goes to the SQUAD POOL; nobody is put in the XI or on the bench and the
 * formation is left as it was, so the user still chooses the lineup exactly as before.
 */

/** Nearest DizPitch position for the four coarse categories the official site publishes. */
const POSITION_FOR_SOURCE: Record<SourcePosition, PositionCode> = {
  Goalkeeper: 'GK',
  Defender: 'CB',
  Midfielder: 'CM',
  Forward: 'ST',
};

const SOURCE_ORDER: Record<SourcePosition, number> = { Goalkeeper: 0, Defender: 1, Midfielder: 2, Forward: 3 };

export function positionCodeForSource(position: SourcePosition | null): PositionCode {
  return position === null ? 'CM' : POSITION_FOR_SOURCE[position];
}

function isUsableNumber(n: number | null): n is number {
  return n !== null && Number.isInteger(n) && n >= MIN_SHIRT_NUMBER && n <= MAX_SHIRT_NUMBER;
}

export interface SnapshotContext {
  league: string;
  season: string;
  /** ISO time of the snapshot (passed in: domain code never reads the clock). */
  snapshotAt: string;
}

/** Players ordered goalkeeper → forward, then by shirt number, then by name (stable and predictable). */
function sortedForSquad(players: PlayerPreset[]): PlayerPreset[] {
  const rank = (p: PlayerPreset) => (p.position === null ? 4 : SOURCE_ORDER[p.position]);
  return [...players].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.shirtNumber ?? Number.MAX_SAFE_INTEGER) - (b.shirtNumber ?? Number.MAX_SAFE_INTEGER) ||
      a.name.localeCompare(b.name),
  );
}

export function snapshotPlayers(preset: TeamPreset, ctx: SnapshotContext, newId: (prefix: string) => Id): Player[] {
  // Temporary numbers (for players the source gave none) count down from the top, skipping any number in use.
  const taken = new Set(preset.players.map((p) => p.shirtNumber).filter(isUsableNumber));
  let temporary = MAX_SHIRT_NUMBER;
  const nextTemporary = () => {
    while (temporary > MIN_SHIRT_NUMBER && taken.has(temporary)) temporary -= 1;
    taken.add(temporary);
    return temporary;
  };

  return sortedForSquad(preset.players)
    .slice(0, MAX_POOL_PLAYERS)
    .map((p): Player => {
      const position = positionCodeForSource(p.position);
      const name = p.name.trim() || (p.displayName ?? '').trim();
      const usable = isUsableNumber(p.shirtNumber);
      const assigned = usable ? null : nextTemporary();
      const origin: PlayerOrigin = {
        presetId: p.id,
        season: ctx.season,
        imported: { name, shirtNumber: usable ? p.shirtNumber : null, position },
        ...(assigned !== null ? { assignedNumber: assigned } : {}),
        sourcePosition: p.position,
        nationality: p.nationality,
        dateOfBirth: p.dateOfBirth,
        photoUrl: p.headshotUrl,
        profileUrl: p.profileUrl,
      };
      return {
        id: newId('plr'),
        name,
        shirtNumber: usable ? (p.shirtNumber as number) : (assigned as number),
        preferredPosition: position,
        notes: '',
        origin,
      };
    });
}

function snapshotTeamOrigin(preset: TeamPreset, ctx: SnapshotContext): TeamOrigin {
  return {
    presetId: preset.id,
    league: ctx.league,
    season: ctx.season,
    snapshotAt: ctx.snapshotAt,
    verifiedAt: preset.source.retrievedAt,
    officialName: preset.officialName,
    shortName: preset.shortName,
    abbreviation: preset.abbreviation,
    city: preset.city,
    logoUrl: preset.logoUrl,
    profileUrl: preset.profileUrl,
    coach: preset.coach ? { name: preset.coach.name, photoUrl: preset.coach.photoUrl } : null,
  };
}

/** Fills `base` (a fresh, empty team) from `preset`. The XI, bench and formation of `base` are untouched. */
export function snapshotTeam(base: Team, preset: TeamPreset, ctx: SnapshotContext, newId: (prefix: string) => Id): Team {
  return {
    ...base,
    name: preset.displayName.trim().slice(0, 60),
    coach: (preset.coach?.name ?? '').trim().slice(0, 80),
    players: [],
    bench: [],
    pool: snapshotPlayers(preset, ctx, newId),
    preset: snapshotTeamOrigin(preset, ctx),
  };
}

export interface PlayerEdits {
  name: boolean;
  shirtNumber: boolean;
  position: boolean;
  /** The source gave no usable number, so the current one is temporary and should be corrected. */
  numberMissing: boolean;
}

/** How a preset-origin player differs from what was imported; null for players entered by hand. */
export function playerEdits(player: Player): PlayerEdits | null {
  const origin = player.origin;
  if (!origin) return null;
  const { imported } = origin;
  return {
    name: player.name !== imported.name,
    shirtNumber: imported.shirtNumber !== null ? player.shirtNumber !== imported.shirtNumber : !isNumberUnknown(player),
    position: player.preferredPosition !== imported.position,
    numberMissing: isNumberUnknown(player),
  };
}

/**
 * True while a preset player still carries the temporary number the snapshot assigned because the source had
 * none: the real number is unknown, so it must not be presented as a shirt number (jerseys draw none).
 * Matches made before `assignedNumber` existed cannot tell a temporary number from a corrected one, so for them a
 * missing import number keeps being treated as unknown.
 */
export function isNumberUnknown(player: Player): boolean {
  const origin = player.origin;
  if (!origin || origin.imported.shirtNumber !== null) return false;
  return origin.assignedNumber === undefined || player.shirtNumber === origin.assignedNumber;
}

export type PlayerProvenance = 'custom' | 'imported' | 'corrected';

export function playerProvenance(player: Player): PlayerProvenance {
  const edits = playerEdits(player);
  if (edits === null) return 'custom';
  return edits.name || edits.shirtNumber || edits.position ? 'corrected' : 'imported';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `1984-08-03` → `3 Aug 1984` (no time zone or clock involved), or null when unusable. */
export function formatDateOfBirth(dateOfBirth: string | null): string | null {
  const m = dateOfBirth ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth) : null;
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : null;
}

/** Human-readable list of what differs from the imported values (empty when nothing does). */
export function describeEdits(player: Player): string[] {
  const edits = playerEdits(player);
  const imported = player.origin?.imported;
  if (!edits || !imported) return [];
  const lines: string[] = [];
  if (edits.name) lines.push(`Name changed from "${imported.name}"`);
  if (edits.shirtNumber) lines.push(`Shirt number changed from #${imported.shirtNumber}`);
  if (edits.position) lines.push(`Position changed from ${imported.position}`);
  return lines;
}
