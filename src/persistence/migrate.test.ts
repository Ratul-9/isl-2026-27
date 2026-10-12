import { describe, expect, it } from 'vitest';
import { parseDocument } from './document';
import { migrateMatch } from './migrate';
import { CURRENT_SCHEMA_VERSION, FORMAT_ID } from './schema';
import { createMatch } from '@/domain/match';
import { richMatch } from './testFixtures';

describe('migrateMatch', () => {
  it('passes the current version through untouched', () => {
    const match = { id: 'm' };
    expect(migrateMatch(match, CURRENT_SCHEMA_VERSION)).toEqual({ ok: true, match, from: CURRENT_SCHEMA_VERSION });
  });

  it('1 → 2 adds an empty list of replays and keeps everything else', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(5);
    const r = migrateMatch({ id: 'm', name: 'Old tie' }, 1);
    expect(r).toEqual({ ok: true, match: { id: 'm', name: 'Old tie', replays: [] }, from: 1 });
  });

  it('2 → 3 gives every existing replay empty tracking data and keeps everything else', () => {
    const r = migrateMatch({ id: 'm', replays: [{ id: 'r1', origin: 'ai', title: 'Goal' }] }, 2);
    expect(r).toEqual({ ok: true, match: { id: 'm', replays: [{ id: 'r1', origin: 'ai', title: 'Goal', tracking: null }] }, from: 2 });
  });

  it('3 → 4 changes nothing: team presets only add optional fields', () => {
    const match = { id: 'm', home: { id: 't1', players: [] }, replays: [] };
    expect(migrateMatch(match, 3)).toEqual({ ok: true, match, from: 3 });
  });

  it('4 → 5 changes nothing: jersey display only adds optional fields', () => {
    const match = { id: 'm', home: { id: 't1', players: [] }, replays: [] };
    expect(migrateMatch(match, 4)).toEqual({ ok: true, match, from: 4 });
  });

  it('opens a complete version-4 document (saved before jersey display) with circles and automatic kits', () => {
    const match = createMatch();
    const parsed = parseDocument({ format: FORMAT_ID, schemaVersion: 4, savedAt: '2026-10-01T10:00:00.000Z', match });
    expect(parsed).toMatchObject({ ok: true });
    if (parsed.ok) {
      expect(parsed.match).toEqual(match);
      expect(parsed.match.playerDisplay).toBeUndefined();
      expect(parsed.match.home.kit).toBeUndefined();
    }
  });

  it('opens a complete version-3 document (saved before team presets existed) unchanged', () => {
    const match = createMatch();
    expect(match.home.pool).toBeUndefined();
    expect(match.home.preset).toBeUndefined();
    const parsed = parseDocument({ format: FORMAT_ID, schemaVersion: 3, savedAt: '2026-10-01T10:00:00.000Z', match });
    expect(parsed).toMatchObject({ ok: true });
    if (parsed.ok) {
      expect(parsed.match).toEqual(match);
      expect(parsed.match.home.pool).toBeUndefined();
      expect(parsed.match.home.preset).toBeUndefined();
    }
  });

  it('opens a complete version-2 document (replays saved before tracking existed)', () => {
    const match = richMatch();
    const v2Replays = match.replays.map((r) => {
      const { tracking: _t, ...rest } = r;
      void _t;
      return rest;
    });
    const parsed = parseDocument({ format: FORMAT_ID, schemaVersion: 2, savedAt: '2026-10-01T10:00:00.000Z', match: { ...match, replays: v2Replays } });
    expect(parsed).toMatchObject({ ok: true });
    if (parsed.ok) {
      expect(parsed.match.replays).toHaveLength(1);
      expect(parsed.match.replays[0].tracking).toBeNull();
      expect(parsed.match.replays[0]).toEqual(match.replays[0]);
    }
  });

  it('opens a complete version-1 document (saved before replays existed) with no replays', () => {
    const { replays: _dropped, ...v1Match } = createMatch();
    void _dropped;
    const parsed = parseDocument({ format: FORMAT_ID, schemaVersion: 1, savedAt: '2026-10-01T10:00:00.000Z', match: v1Match });
    expect(parsed).toMatchObject({ ok: true });
    if (parsed.ok) expect(parsed.match.replays).toEqual([]);
  });

  it('applies migrations in order up to the target version', () => {
    const migrations = {
      1: (m: Record<string, unknown>) => ({ ...m, a: 'from1' }),
      2: (m: Record<string, unknown>) => ({ ...m, b: `${String(m.a)}+from2` }),
    };
    const r = migrateMatch({ id: 'm' }, 1, migrations, 3);
    expect(r).toEqual({ ok: true, match: { id: 'm', a: 'from1', b: 'from1+from2' }, from: 1 });
    expect(migrateMatch({ id: 'm', a: 'x' }, 2, migrations, 3)).toMatchObject({ ok: true, match: { b: 'x+from2' } });
  });

  it('refuses newer, invalid and unmigratable versions with clear messages', () => {
    expect(migrateMatch({}, 2, {}, 1)).toMatchObject({ ok: false, error: expect.stringContaining('newer version') });
    expect(migrateMatch({}, 0)).toMatchObject({ ok: false, error: expect.stringContaining('Unsupported') });
    expect(migrateMatch({}, 1.5)).toMatchObject({ ok: false });
    expect(migrateMatch({}, 1, {}, 3)).toMatchObject({ ok: false, error: expect.stringContaining('No migration') });
  });
});
