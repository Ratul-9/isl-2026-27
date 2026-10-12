import { describe, expect, it } from 'vitest';
import { createMatch } from '../match';
import { MAX_PLAYERS, MAX_POOL_PLAYERS, validateSquadIntegrity } from '../squad';
import { presetPlayer, presetSeason, presetTeam } from './fixtures';
import { positionCodeForSource, formatDateOfBirth, playerEdits, playerProvenance, describeEdits, snapshotPlayers, snapshotTeam } from './snapshot';
import { buildMatchFromPresets, PresetSelectionError } from './toMatch';

let n = 0;
const newId = (prefix: string) => `${prefix}_t${++n}`;
const ctx = { league: 'isl', season: '2026-27', snapshotAt: '2026-10-12T09:00:00.000Z' };

describe('snapshotTeam', () => {
  it('copies name, coach and the whole squad into the pool, leaving the XI, bench and formation untouched', () => {
    const base = createMatch().home;
    const preset = presetTeam('a', { size: 30 });
    const team = snapshotTeam(base, preset, ctx, newId);

    expect(team.name).toBe(preset.displayName);
    expect(team.coach).toBe('Coach A');
    expect(team.pool).toHaveLength(30);
    expect(team.players).toEqual([]);
    expect(team.bench).toEqual([]);
    expect(team.slots).toEqual(base.slots);
    expect(team.slots.every((s) => s.playerId === null)).toBe(true);
    expect(team.formation).toEqual(base.formation);
    expect(team.id).toBe(base.id);
    expect(validateSquadIntegrity(team)).toEqual([]);
  });

  it('holds more players than a matchday squad can (ISL squads are ~30)', () => {
    const team = snapshotTeam(createMatch().home, presetTeam('a', { size: 36 }), ctx, newId);
    expect(team.pool!.length).toBeGreaterThan(MAX_PLAYERS);
    expect(team.pool!.length).toBeLessThanOrEqual(MAX_POOL_PLAYERS);
  });

  it('gives every player a fresh match id and keeps the preset id only as provenance', () => {
    const preset = presetTeam('a');
    const team = snapshotTeam(createMatch().home, preset, ctx, newId);
    const ids = team.pool!.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of team.pool!) {
      expect(preset.players.map((x) => x.id)).not.toContain(p.id);
      expect(preset.players.map((x) => x.id)).toContain(p.origin!.presetId);
    }
  });

  it('shares no objects with the preset, and does not modify it', () => {
    const preset = presetTeam('a');
    const before = structuredClone(preset);
    const team = snapshotTeam(createMatch().home, preset, ctx, newId);
    team.pool![0].name = 'Edited';
    team.pool![0].origin!.imported.name = 'Edited';
    team.preset!.coach!.name = 'Someone else';
    expect(preset).toEqual(before);
  });

  it('records the imported values, the source position and the snapshot time', () => {
    const preset = presetTeam('a', {
      players: [presetPlayer({ id: 'isl-player-1', name: 'Sunil Chhetri', shirtNumber: 11, position: 'Forward', nationality: 'India', dateOfBirth: '1984-08-03' })],
    });
    const team = snapshotTeam(createMatch().home, preset, ctx, newId);
    expect(team.pool![0]).toMatchObject({
      name: 'Sunil Chhetri',
      shirtNumber: 11,
      preferredPosition: 'ST',
      notes: '',
      origin: {
        presetId: 'isl-player-1',
        season: '2026-27',
        sourcePosition: 'Forward',
        nationality: 'India',
        dateOfBirth: '1984-08-03',
        imported: { name: 'Sunil Chhetri', shirtNumber: 11, position: 'ST' },
      },
    });
    expect(team.preset).toMatchObject({ presetId: 'isl-club-a', season: '2026-27', league: 'isl', snapshotAt: ctx.snapshotAt, officialName: 'Test FC A' });
  });

  it('orders the pool goalkeepers first, then defenders, midfielders, forwards, by number', () => {
    const preset = presetTeam('a', {
      players: [
        presetPlayer({ id: 'isl-player-1', name: 'F', shirtNumber: 9, position: 'Forward' }),
        presetPlayer({ id: 'isl-player-2', name: 'G', shirtNumber: 1, position: 'Goalkeeper' }),
        presetPlayer({ id: 'isl-player-3', name: 'D2', shirtNumber: 5, position: 'Defender' }),
        presetPlayer({ id: 'isl-player-4', name: 'D1', shirtNumber: 3, position: 'Defender' }),
        presetPlayer({ id: 'isl-player-5', name: 'M', shirtNumber: 8, position: 'Midfielder' }),
      ],
    });
    expect(snapshotTeam(createMatch().home, preset, ctx, newId).pool!.map((p) => p.name)).toEqual(['G', 'D1', 'D2', 'M', 'F']);
  });

  it('keeps duplicated source numbers as published (the pool does not need unique numbers)', () => {
    const preset = presetTeam('a', {
      players: [
        presetPlayer({ id: 'isl-player-1', name: 'One', shirtNumber: 8 }),
        presetPlayer({ id: 'isl-player-2', name: 'Two', shirtNumber: 8 }),
      ],
    });
    expect(snapshotTeam(createMatch().home, preset, ctx, newId).pool!.map((p) => p.shirtNumber)).toEqual([8, 8]);
  });

  it('gives players without a usable number a temporary one, counting down from 99, and flags it', () => {
    const preset = presetTeam('a', {
      players: [
        presetPlayer({ id: 'isl-player-1', name: 'No number', shirtNumber: null }),
        presetPlayer({ id: 'isl-player-2', name: 'Out of range', shirtNumber: 150 }),
        presetPlayer({ id: 'isl-player-3', name: 'Real', shirtNumber: 99 }),
      ],
    });
    const pool = snapshotPlayers(preset, ctx, newId);
    const byName = Object.fromEntries(pool.map((p) => [p.name, p]));
    expect(byName.Real.shirtNumber).toBe(99);
    // Temporary numbers are handed out in squad order (by source number, blanks last).
    expect(byName['Out of range'].shirtNumber).toBe(98);
    expect(byName['No number'].shirtNumber).toBe(97);
    expect(new Set(pool.map((p) => p.shirtNumber)).size).toBe(3);
    expect(byName['No number'].origin!.imported.shirtNumber).toBeNull();
    expect(playerEdits(byName['No number'])).toMatchObject({ numberMissing: true, shirtNumber: false });
  });

  it('maps the four published positions to the nearest DizPitch position', () => {
    expect([positionCodeForSource('Goalkeeper'), positionCodeForSource('Defender'), positionCodeForSource('Midfielder'), positionCodeForSource('Forward'), positionCodeForSource(null)]).toEqual([
      'GK',
      'CB',
      'CM',
      'ST',
      'CM',
    ]);
  });
});

describe('provenance', () => {
  const team = () => snapshotTeam(createMatch().home, presetTeam('a', { size: 3 }), ctx, newId);

  it('tells imported, corrected and hand-made players apart', () => {
    const [imported, corrected] = team().pool!;
    expect(playerProvenance(imported)).toBe('imported');
    const edited = { ...corrected, name: 'Fixed Name', shirtNumber: 77 };
    expect(playerProvenance(edited)).toBe('corrected');
    expect(describeEdits(edited)).toEqual([`Name changed from "${corrected.name}"`, `Shirt number changed from #${corrected.shirtNumber}`]);
    const custom = { id: 'x', name: 'Walk-on', shirtNumber: 50, preferredPosition: 'CM' as const, notes: '' };
    expect(playerProvenance(custom)).toBe('custom');
    expect(describeEdits(custom)).toEqual([]);
  });
});

describe('formatDateOfBirth', () => {
  it('formats ISO dates without any time zone handling and rejects junk', () => {
    expect(formatDateOfBirth('1984-08-03')).toBe('3 Aug 1984');
    expect(formatDateOfBirth('2001-12-31')).toBe('31 Dec 2001');
    expect(formatDateOfBirth(null)).toBeNull();
    expect(formatDateOfBirth('03-08-1984')).toBeNull();
    expect(formatDateOfBirth('2001-13-01')).toBeNull();
  });
});

describe('buildMatchFromPresets', () => {
  const season = presetSeason();
  const [a, b] = season.teams;

  it('creates an ordinary match with both teams snapshotted', () => {
    const match = buildMatchFromPresets(season, a, b, ctx.snapshotAt, newId);
    expect(match.home.name).toBe(a.displayName);
    expect(match.away.name).toBe(b.displayName);
    expect(match.competition).toBe('Indian Super League 2026-27');
    expect(match.date).toBe('');
    expect(match.venue).toBe('');
    expect(match.events).toEqual([]);
    expect(match.home.pool).toHaveLength(a.players.length);
    expect(match.away.preset?.presetId).toBe(b.id);
    expect(match.home.id).not.toBe(match.away.id);
  });

  it('refuses the same team on both sides', () => {
    expect(() => buildMatchFromPresets(season, a, a, ctx.snapshotAt, newId)).toThrow(PresetSelectionError);
  });

  it('is independent of the presets afterwards (a later refresh cannot reach an existing match)', () => {
    const before = structuredClone(a);
    const match = buildMatchFromPresets(season, a, b, ctx.snapshotAt, newId);
    const frozen = structuredClone(match);

    // The league data changes: new coach, a transfer, a renumbering.
    a.coach!.name = 'New Coach';
    a.players[0].name = 'Transferred Away';
    a.players[1].shirtNumber = 99;
    a.players.pop();

    expect(match).toEqual(frozen);
    expect(match.home.coach).toBe('Coach A');
    Object.assign(a, before); // restore the shared fixture for the other tests
  });
});
