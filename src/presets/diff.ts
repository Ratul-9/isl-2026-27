import type { PlayerPreset, SeasonPresets, TeamPreset } from '@/domain/presets/types';

/**
 * What changes between two versions of a season's presets. Used to preview an import before it is
 * applied and to flag players who left or moved. Timestamps are not compared: re-reading an
 * unchanged source must show "no changes".
 */

interface FieldChange {
  field: string;
  from: string | number | null;
  to: string | number | null;
}

interface PlayerChange {
  playerId: string;
  name: string;
  changes: FieldChange[];
}

interface TeamChange {
  teamId: string;
  name: string;
  fields: FieldChange[];
  coach: { from: string | null; to: string | null } | null;
  playersAdded: { id: string; name: string; shirtNumber: number | null; movedFrom: string | null }[];
  /** Players no longer listed for this team (`movedTo` is set when they appear for another team in the new data). */
  playersRemoved: { id: string; name: string; movedTo: string | null }[];
  playersChanged: PlayerChange[];
}

export interface SeasonDiff {
  isNew: boolean;
  teamsAdded: string[];
  teamsRemoved: string[];
  teams: TeamChange[];
  /** Total number of individual differences (0 = the data is identical). */
  changeCount: number;
}

const TEAM_FIELDS: (keyof TeamPreset & string)[] = ['officialName', 'displayName', 'shortName', 'abbreviation', 'city', 'venue', 'logoUrl', 'profileUrl'];
const PLAYER_FIELDS: (keyof PlayerPreset & string)[] = ['name', 'displayName', 'shirtNumber', 'position', 'nationality', 'dateOfBirth', 'headshotUrl', 'profileUrl'];

function changes<T extends object>(before: T, after: T, fields: string[]): FieldChange[] {
  const out: FieldChange[] = [];
  for (const field of fields) {
    const a = (before as Record<string, unknown>)[field] as string | number | null;
    const b = (after as Record<string, unknown>)[field] as string | number | null;
    if (a !== b) out.push({ field, from: a, to: b });
  }
  return out;
}

export function diffSeasons(previous: SeasonPresets | null, next: SeasonPresets): SeasonDiff {
  if (previous === null) {
    return {
      isNew: true,
      teamsAdded: next.teams.map((t) => t.displayName),
      teamsRemoved: [],
      teams: [],
      changeCount: next.teams.length + next.teams.reduce((n, t) => n + t.players.length, 0),
    };
  }

  const before = new Map(previous.teams.map((t) => [t.id, t]));
  const after = new Map(next.teams.map((t) => [t.id, t]));
  const ownerBefore = new Map<string, string>();
  const ownerAfter = new Map<string, string>();
  for (const t of previous.teams) for (const p of t.players) ownerBefore.set(p.id, t.displayName);
  for (const t of next.teams) for (const p of t.players) ownerAfter.set(p.id, t.displayName);

  const teams: TeamChange[] = [];
  for (const [id, newTeam] of after) {
    const oldTeam = before.get(id);
    if (!oldTeam) continue;
    const fields = changes(oldTeam, newTeam, TEAM_FIELDS);
    const coachFrom = oldTeam.coach?.name ?? null;
    const coachTo = newTeam.coach?.name ?? null;
    const oldPlayers = new Map(oldTeam.players.map((p) => [p.id, p]));
    const newPlayers = new Map(newTeam.players.map((p) => [p.id, p]));
    const playersAdded = newTeam.players
      .filter((p) => !oldPlayers.has(p.id))
      .map((p) => ({ id: p.id, name: p.name, shirtNumber: p.shirtNumber, movedFrom: ownerBefore.get(p.id) ?? null }));
    const playersRemoved = oldTeam.players
      .filter((p) => !newPlayers.has(p.id))
      .map((p) => ({ id: p.id, name: p.name, movedTo: ownerAfter.get(p.id) ?? null }));
    const playersChanged: PlayerChange[] = [];
    for (const [pid, np] of newPlayers) {
      const op = oldPlayers.get(pid);
      if (!op) continue;
      const diff = changes(op, np, PLAYER_FIELDS);
      if (diff.length > 0) playersChanged.push({ playerId: pid, name: np.name, changes: diff });
    }
    const coach = coachFrom !== coachTo ? { from: coachFrom, to: coachTo } : null;
    if (fields.length > 0 || coach || playersAdded.length > 0 || playersRemoved.length > 0 || playersChanged.length > 0) {
      teams.push({ teamId: id, name: newTeam.displayName, fields, coach, playersAdded, playersRemoved, playersChanged });
    }
  }

  const teamsAdded = next.teams.filter((t) => !before.has(t.id)).map((t) => t.displayName);
  const teamsRemoved = previous.teams.filter((t) => !after.has(t.id)).map((t) => t.displayName);
  const changeCount =
    teamsAdded.length +
    teamsRemoved.length +
    teams.reduce(
      (n, t) =>
        n + t.fields.length + (t.coach ? 1 : 0) + t.playersAdded.length + t.playersRemoved.length + t.playersChanged.reduce((m, p) => m + p.changes.length, 0),
      0,
    );
  return { isNew: false, teamsAdded, teamsRemoved, teams, changeCount };
}

/** Plain-text preview of a diff for the terminal / report. */
export function formatDiff(diff: SeasonDiff): string[] {
  if (diff.isNew) return [`New season file: ${diff.teamsAdded.length} teams.`];
  if (diff.changeCount === 0) return ['No changes: the imported data is identical to the current file.'];
  const lines: string[] = [];
  for (const t of diff.teamsAdded) lines.push(`+ team added: ${t}`);
  for (const t of diff.teamsRemoved) lines.push(`- team removed: ${t}`);
  for (const team of diff.teams) {
    lines.push(`~ ${team.name}`);
    for (const f of team.fields) lines.push(`    ${f.field}: ${f.from ?? '∅'} → ${f.to ?? '∅'}`);
    if (team.coach) lines.push(`    head coach: ${team.coach.from ?? '∅'} → ${team.coach.to ?? '∅'}`);
    for (const p of team.playersAdded) {
      lines.push(`    + ${p.name}${p.shirtNumber !== null ? ` (#${p.shirtNumber})` : ''}${p.movedFrom ? ` — joined from ${p.movedFrom}` : ''}`);
    }
    for (const p of team.playersRemoved) lines.push(`    - ${p.name}${p.movedTo ? ` — now listed for ${p.movedTo}` : ' — no longer listed (left or not registered)'}`);
    for (const p of team.playersChanged) {
      for (const f of p.changes) lines.push(`    ~ ${p.name}: ${f.field} ${f.from ?? '∅'} → ${f.to ?? '∅'}`);
    }
  }
  return lines;
}
