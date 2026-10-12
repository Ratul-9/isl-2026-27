import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createId } from '@/domain/ids';
import { safeImageUrl } from '@/domain/presets/images';
import { buildMatchFromPresets } from '@/domain/presets/toMatch';
import { getPool, MAX_POOL_PLAYERS, promoteFromPool, validateSquadIntegrity } from '@/domain/squad';
import { parseDocument, serializeDocument } from '@/persistence/document';
import { checkSeasonPresets } from './quality';
import { parseManifest, parseSeasonPresets } from './schema';

/**
 * Guards the COMMITTED preset files (public/presets/**), i.e. what the app actually serves. These
 * are properties any refresh must keep; exact player counts are deliberately not asserted because
 * squads change.
 */
const root = path.join(process.cwd(), 'public', 'presets');
const read = (file: string): unknown => JSON.parse(readFileSync(path.join(root, file), 'utf8'));

describe('committed ISL 2026-27 presets', () => {
  const manifest = parseManifest(read('index.json'));
  const season = parseSeasonPresets(read('isl/2026-27.json'));

  it('has a valid index and season file that agree with each other', () => {
    expect(manifest.ok).toBe(true);
    expect(season.ok).toBe(true);
    if (!manifest.ok || !season.ok) return;
    const entry = manifest.value.seasons.find((s) => s.league.id === 'isl' && s.season === '2026-27');
    expect(entry).toBeDefined();
    expect(entry!.file).toBe('isl/2026-27.json');
    expect(entry!.teams).toBe(season.value.teams.length);
    expect(entry!.players).toBe(season.value.teams.reduce((n, t) => n + t.players.length, 0));
  });

  it('contains the 13 clubs the league lists for 2026-27, with no blocking data errors', () => {
    if (!season.ok) throw new Error('invalid season file');
    const { teams } = season.value;
    expect(teams).toHaveLength(13);
    expect(new Set(teams.map((t) => t.id)).size).toBe(13);
    expect(checkSeasonPresets(season.value, { expectedTeams: 13 }).filter((i) => i.severity === 'error')).toEqual([]);
    for (const t of teams) {
      expect(t.coach, t.displayName).not.toBeNull();
      expect(t.players.length, t.displayName).toBeGreaterThanOrEqual(18);
      expect(t.players.length, t.displayName).toBeLessThanOrEqual(MAX_POOL_PLAYERS);
      expect(t.source.url).toMatch(/^https:\/\/www\.indiansuperleague\.com\/clubs\/\d+-.+-profile\/squad$/);
      expect(t.verification).toBe('official');
    }
  });

  it('records a source and verification status on every player, and only uses image URLs the app will display', () => {
    if (!season.ok) throw new Error('invalid season file');
    for (const t of season.value.teams) {
      expect(safeImageUrl(t.logoUrl), `${t.displayName} logo`).not.toBeNull();
      for (const p of t.players) {
        expect(p.source.url).toBe(t.source.url);
        expect(['official', 'manual']).toContain(p.verification);
        expect(safeImageUrl(p.headshotUrl), `${t.displayName}: ${p.name} headshot`).not.toBeNull();
        expect(p.id).toBe(`isl-player-${p.sourceId}`);
      }
    }
  });

  it('never lists a player for two clubs', () => {
    if (!season.ok) throw new Error('invalid season file');
    const ids = season.value.teams.flatMap((t) => t.players.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every club can be put into a match that saves, reloads and still behaves as an ordinary match', () => {
    if (!season.ok) throw new Error('invalid season file');
    const { teams } = season.value;
    for (let i = 0; i < teams.length; i++) {
      const home = teams[i];
      const away = teams[(i + 1) % teams.length];
      const match = buildMatchFromPresets(season.value, home, away, '2026-10-12T09:00:00.000Z', createId);

      expect(validateSquadIntegrity(match.home)).toEqual([]);
      expect(getPool(match.home)).toHaveLength(home.players.length);
      // Shirt numbers on the match are always usable ones, even where the source had none.
      for (const p of getPool(match.home)) expect(p.shirtNumber).toBeGreaterThanOrEqual(1);

      const reloaded = parseDocument(JSON.parse(serializeDocument(match, new Date('2026-10-12T09:00:00Z'))));
      expect(reloaded.ok, `${home.displayName} v ${away.displayName}`).toBe(true);
      if (reloaded.ok) expect(reloaded.match).toEqual(match);
    }
  });

  it('lets a full real squad be moved into a lineup within the existing limits', () => {
    if (!season.ok) throw new Error('invalid season file');
    // East Bengal is the largest squad; it also lists duplicated shirt numbers on the official page.
    const team = season.value.teams.reduce((a, b) => (b.players.length > a.players.length ? b : a));
    const match = buildMatchFromPresets(season.value, team, season.value.teams.find((t) => t.id !== team.id)!, '2026-10-12T09:00:00.000Z', createId);
    let squad = match.home;
    let moved = 0;
    let refused = 0;
    for (const player of getPool(squad)) {
      const result = promoteFromPool(squad, player.id, moved < 11 ? 'starter' : 'substitute');
      if (result.ok) {
        squad = result.team;
        moved += 1;
      } else refused += 1;
      if (moved === 22) break;
    }
    expect(squad.players.length).toBe(moved);
    expect(moved).toBeLessThanOrEqual(22);
    expect(squad.slots.filter((s) => s.playerId !== null)).toHaveLength(Math.min(11, moved));
    expect(validateSquadIntegrity(squad)).toEqual([]);
    expect(moved + refused).toBeGreaterThanOrEqual(22);
  });
});
