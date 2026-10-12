import { CURRENT_SCHEMA_VERSION } from './schema';

/**
 * Upgrades a stored/imported document one version at a time. Add an entry
 * `n: (doc) => docAtVersionN+1` whenever the persisted shape changes, bump
 * CURRENT_SCHEMA_VERSION, and add a test with a fixture of the old shape
 * (invariant 10).
 */
export type Migration = (match: Record<string, unknown>) => Record<string, unknown>;

const MIGRATIONS: Record<number, Migration> = {
  // 1 → 2: tactical replays were added; existing matches simply have none.
  1: (match) => ({ ...match, replays: [] }),
  // 2 -> 3: replays may carry computer-vision tracking data; existing replays have none.
  2: (match) => ({
    ...match,
    replays: Array.isArray(match.replays)
      ? match.replays.map((r) => (r && typeof r === 'object' ? { ...(r as Record<string, unknown>), tracking: null } : r))
      : match.replays,
  }),
  // 3 -> 4: team presets add OPTIONAL `Team.pool`, `Team.preset` and `Player.origin`. Existing matches
  // have none of them and need no change; the bump stops an older build from opening (and, on save,
  // silently stripping) preset data it does not know about.
  3: (match) => match,
  // 4 -> 5: jersey display adds OPTIONAL `Match.playerDisplay`, `Team.kit` and `PlayerOrigin.assignedNumber`.
  // Existing matches need no change (circles, automatic kits); the bump keeps an older build from opening
  // and silently stripping them on save.
  4: (match) => match,
};

export type MigrationResult =
  | { ok: true; match: Record<string, unknown>; from: number }
  | { ok: false; error: string };

export function migrateMatch(
  match: Record<string, unknown>,
  fromVersion: number,
  migrations: Record<number, Migration> = MIGRATIONS,
  target: number = CURRENT_SCHEMA_VERSION,
): MigrationResult {
  if (!Number.isInteger(fromVersion) || fromVersion < 1) {
    return { ok: false, error: `Unsupported schema version "${String(fromVersion)}".` };
  }
  if (fromVersion > target) {
    return {
      ok: false,
      error: `This match was saved by a newer version of DizPitch (schema ${fromVersion}; this version understands up to ${target}). Update the app to open it.`,
    };
  }
  let current = match;
  for (let v = fromVersion; v < target; v++) {
    const step = migrations[v];
    if (!step) return { ok: false, error: `No migration is available from schema version ${v}.` };
    current = step(current);
  }
  return { ok: true, match: current, from: fromVersion };
}
