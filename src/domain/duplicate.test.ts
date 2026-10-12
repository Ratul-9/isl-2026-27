import { describe, expect, it } from 'vitest';
import { presetSeason } from '@/domain/presets/fixtures';
import { buildMatchFromPresets } from '@/domain/presets/toMatch';
import { promoteFromPool } from '@/domain/squad';
import { richMatch } from '@/persistence/testFixtures';
import { cloneMatchWithNewIds } from './duplicate';
import { analyzeEvents } from './events';
import type { Match } from './types';

let n = 0;
const newId = (prefix: string) => `${prefix}_new${++n}`;

/** Every id string that appears anywhere in the match, by walking the JSON. */
function collectIds(match: Match): string[] {
  const ids: string[] = [];
  const idKeys = new Set(['id', 'teamId', 'playerId', 'scorerId', 'assistId', 'outPlayerId', 'inPlayerId', 'fromPlayerId', 'toPlayerId', 'fromActorId', 'toActorId']);
  const walk = (value: unknown, key?: string) => {
    if (Array.isArray(value)) {
      value.forEach((v) => walk(v, key === 'bench' ? 'id' : undefined));
    } else if (value && typeof value === 'object') {
      // `original` is a replay's unedited AI analysis: its ids are local labels, not match entities.
      for (const [k, v] of Object.entries(value)) if (k !== 'original') walk(v, k);
    } else if (typeof value === 'string' && key && (idKeys.has(key) || key === 'bench')) {
      // `formation.id` of a preset is a formation name, not an entity id.
      if (!/^\d(-\d)+$/.test(value)) ids.push(value);
    }
  };
  walk(match);
  return ids;
}

describe('cloneMatchWithNewIds', () => {
  it('gives every entity a new id and shares none with the original', () => {
    const original = richMatch();
    const copy = cloneMatchWithNewIds(original, newId);
    const before = new Set(collectIds(original));
    const after = collectIds(copy);
    expect(after.length).toBeGreaterThan(50);
    expect(after.filter((id) => before.has(id))).toEqual([]);
    expect(copy.id).not.toBe(original.id);
  });

  it('keeps content identical and all references consistent', () => {
    const original = richMatch();
    const copy = cloneMatchWithNewIds(original, newId);
    expect(copy.name).toBe(original.name);
    expect(copy.home.players.map((p) => p.name)).toEqual(original.home.players.map((p) => p.name));
    expect(copy.home.slots.map((s) => [s.x, s.y, s.position])).toEqual(original.home.slots.map((s) => [s.x, s.y, s.position]));
    expect(copy.events.map((e) => e.type)).toEqual(original.events.map((e) => e.type));
    expect(copy.clock).toEqual(original.clock);

    // References resolve inside the copy.
    const players = new Set([...copy.home.players, ...copy.away.players].map((p) => p.id));
    for (const slot of copy.home.slots) if (slot.playerId) expect(players.has(slot.playerId)).toBe(true);
    for (const id of copy.home.bench) expect(players.has(id)).toBe(true);
    const teams = new Set([copy.home.id, copy.away.id]);
    for (const e of copy.events) if ('teamId' in e && e.teamId) expect(teams.has(e.teamId)).toBe(true);
    for (const d of copy.drawings) {
      if (d.fromPlayerId) expect(players.has(d.fromPlayerId)).toBe(true);
      if (d.source) expect(teams.has(d.source.teamId)).toBe(true);
    }
    // The saved arrangement the home team follows was remapped, not dropped.
    expect(copy.home.formation).toEqual({ kind: 'saved', id: copy.savedLayouts[0].id });
    expect(copy.savedLayouts[0].id).not.toBe(original.savedLayouts[0].id);
  });

  it('derives the same score and lineups (structurally) as the original', () => {
    const original = richMatch();
    const copy = cloneMatchWithNewIds(original, newId);
    const a = analyzeEvents(original);
    const b = analyzeEvents(copy);
    expect(b.score).toEqual(a.score);
    expect(b.lineups.home.onPitch).toHaveLength(a.lineups.home.onPitch.length);
    expect(b.lineups.home.substitutionsMade).toBe(a.lineups.home.substitutionsMade);
    expect(b.lineups.home.sentOff).toHaveLength(a.lineups.home.sentOff.length);
    expect(b.ordered.map((x) => [x.minute, x.errors.length])).toEqual(a.ordered.map((x) => [x.minute, x.errors.length]));
  });

  it('does not mutate the original or share nested objects', () => {
    const original = richMatch();
    const snapshot = JSON.stringify(original);
    const copy = cloneMatchWithNewIds(original, newId);
    expect(JSON.stringify(original)).toBe(snapshot);
    copy.drawings[0].from.x = 0.99;
    copy.officials.referee = 'Changed';
    expect(original.drawings[0].from.x).not.toBe(0.99);
    expect(original.officials.referee).toBe('A. Ref');
  });

  it('keeps dangling references consistent', () => {
    const original = richMatch();
    original.events.push({ id: 'ghost', type: 'yellowCard', teamId: original.home.id, playerId: 'removed-player', period: 'firstHalf', matchTimeMs: 100 });
    original.events.push({ id: 'ghost2', type: 'redCard', teamId: original.home.id, playerId: 'removed-player', period: 'firstHalf', matchTimeMs: 200 });
    const copy = cloneMatchWithNewIds(original, newId);
    const [a, b] = copy.events.slice(-2);
    expect(a.type === 'yellowCard' && b.type === 'redCard' && a.playerId === b.playerId).toBe(true);
    expect((a as { playerId: string }).playerId).not.toBe('removed-player');
  });
});

describe('cloneMatchWithNewIds with team presets', () => {
  function presetMatch(): Match {
    const season = presetSeason();
    const match = buildMatchFromPresets(season, season.teams[0], season.teams[1], '2026-10-12T09:00:00.000Z', (p) => `${p}_orig${++n}`);
    const first = match.home.pool![0];
    const moved = promoteFromPool(match.home, first.id, 'starter');
    if (!moved.ok) throw new Error('fixture');
    return { ...match, home: moved.team };
  }

  it('remaps squad and pool players, and keeps the preset ids that are provenance', () => {
    const original = presetMatch();
    const copy = cloneMatchWithNewIds(original, newId);
    const before = new Set(collectIds(original));
    expect(collectIds(copy).filter((id) => before.has(id))).toEqual([]);
    expect(copy.home.pool).toHaveLength(original.home.pool!.length);
    expect(copy.home.players).toHaveLength(1);
    expect(copy.home.players[0].origin?.presetId).toBe(original.home.players[0].origin?.presetId);
    expect(copy.home.pool!.map((p) => p.origin?.presetId)).toEqual(original.home.pool!.map((p) => p.origin?.presetId));
    expect(copy.home.preset?.presetId).toBe(original.home.preset?.presetId);
    // The XI still points at the copied player, not the original.
    expect(copy.home.slots.some((s) => s.playerId === copy.home.players[0].id)).toBe(true);
  });

  it('is independent of the original: editing the copy leaves the original untouched', () => {
    const original = presetMatch();
    const frozen = structuredClone(original);
    const copy = cloneMatchWithNewIds(original, newId);
    copy.home.pool![0].origin!.imported.name = 'changed';
    copy.home.pool![0].origin!.photoUrl = 'https://example.com/x.png';
    copy.home.players[0].origin!.imported.shirtNumber = 99;
    copy.home.preset!.coach!.name = 'Someone else';
    copy.home.preset!.city = 'Elsewhere';
    expect(original).toEqual(frozen);
  });
});

