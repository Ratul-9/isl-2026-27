import { describe, expect, it } from 'vitest';
import { analyzeEvents } from '@/domain/events';
import { createMatch } from '@/domain/match';
import type { Match } from '@/domain/types';
import { createDocument, exportFileName, MAX_IMPORT_BYTES, parseDocument, parseMatchJson, serializeDocument } from './document';
import { CURRENT_SCHEMA_VERSION } from './schema';
import { richMatch } from './testFixtures';

const NOW = new Date(Date.UTC(2026, 9, 10, 20, 0, 0));
const errorsOf = (r: ReturnType<typeof parseDocument>) => (r.ok ? [] : r.errors);
const roundTrip = (m: Match) => {
  const r = parseMatchJson(serializeDocument(m, NOW));
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r;
};
/**
 * A document whose match has been edited by `edit` before parsing. The editor
 * receives untyped JSON on purpose: these tests corrupt arbitrary fields, which
 * the real `Match` type (rightly) would not allow.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withMatch(edit: (m: Record<string, any>) => void) {
  const doc = JSON.parse(serializeDocument(richMatch(), NOW));
  edit(doc.match);
  return parseDocument(doc);
}

describe('JSON round trip', () => {
  it('preserves the entire match exactly, including a running clock and event order', () => {
    const original = richMatch();
    const result = roundTrip(original);
    expect(result.match).toEqual(original);
    expect(result.match.clock.runningSinceEpochMs).toBe(original.clock.runningSinceEpochMs);
    expect(result.match.events.map((e) => e.id)).toEqual(original.events.map((e) => e.id));
    expect(result.warnings).toEqual([]);
    expect(result.savedAt).toBe(NOW.toISOString());
  });

  it('round-trips a brand new match', () => {
    const m = createMatch();
    expect(roundTrip(m).match).toEqual(m);
  });

  it('derives the same score and lineups after a round trip', () => {
    const original = richMatch();
    const before = analyzeEvents(original);
    const after = analyzeEvents(roundTrip(original).match);
    expect(after.score).toEqual(before.score);
    expect(after.score).toEqual({ home: 2, away: 0 });
    expect(after.lineups).toEqual(before.lineups);
  });

  it('writes a versioned, human-readable envelope', () => {
    const doc = createDocument(richMatch(), NOW);
    expect(doc).toMatchObject({ format: 'dizpitch.match', schemaVersion: CURRENT_SCHEMA_VERSION, savedAt: NOW.toISOString() });
    expect(serializeDocument(richMatch(), NOW)).toContain('\n  "match"');
  });
});

describe('rejecting bad files with useful messages', () => {
  it('explains JSON syntax errors', () => {
    const r = parseMatchJson('{"format": "dizpitch.match",');
    expect(errorsOf(r)[0]).toMatch(/not valid JSON/);
  });

  it('rejects non-objects and foreign JSON', () => {
    expect(errorsOf(parseMatchJson('[1,2]'))[0]).toMatch(/expected a JSON object/);
    expect(errorsOf(parseMatchJson('"hello"'))[0]).toMatch(/expected a JSON object/);
    expect(errorsOf(parseMatchJson('{"name":"x"}'))[0]).toMatch(/not a DizPitch match export/);
  });

  it('rejects missing, newer and invalid schema versions', () => {
    const base = JSON.parse(serializeDocument(richMatch(), NOW));
    expect(errorsOf(parseDocument({ ...base, schemaVersion: undefined }))[0]).toMatch(/no schema version/);
    expect(errorsOf(parseDocument({ ...base, schemaVersion: 99 }))[0]).toMatch(/newer version of DizPitch/);
    expect(errorsOf(parseDocument({ ...base, schemaVersion: 0 }))[0]).toMatch(/Unsupported schema version/);
    expect(errorsOf(parseDocument({ ...base, match: undefined }))[0]).toMatch(/no "match" section/);
  });

  it('reports the path of each invalid field', () => {
    const r = withMatch((m) => {
      m.home.players[2].shirtNumber = 0;
      m.status = 'delayed';
      m.events[1].goalType = 'volley';
      delete m.venue;
    });
    const text = errorsOf(r).join('\n');
    expect(r.ok).toBe(false);
    expect(text).toContain('home.players[2].shirtNumber');
    expect(text).toContain('status');
    expect(text).toContain('events[1].goalType');
    expect(text).toContain('venue');
  });

  it('rejects wrong types, NaN-like numbers and out-of-range coordinates', () => {
    expect(withMatch((m) => (m.durationMinutes = '90')).ok).toBe(false);
    expect(withMatch((m) => (m.durationMinutes = 5)).ok).toBe(false);
    expect(withMatch((m) => (m.home.slots[0].x = 1.5)).ok).toBe(false);
    expect(withMatch((m) => (m.drawings[0].from.x = -0.2)).ok).toBe(false);
    expect(withMatch((m) => (m.clock.elapsedMs = -5)).ok).toBe(false);
    expect(withMatch((m) => (m.date = '10/10/2026')).ok).toBe(false);
    expect(withMatch((m) => (m.kickoffTime = '7:30pm')).ok).toBe(false);
    expect(withMatch((m) => (m.clock.period = 'extraTime')).ok).toBe(false);
  });

  it('rejects squads that break the roster rules', () => {
    const tooMany = withMatch((m) => {
      for (let i = 0; i < 10; i++) m.home.players.push({ id: `x${i}`, name: 'X', shirtNumber: 50 + i, preferredPosition: 'CM', notes: '' });
    });
    expect(tooMany.ok).toBe(false);

    const dupNumber = withMatch((m) => (m.home.players[1].shirtNumber = m.home.players[0].shirtNumber));
    expect(errorsOf(dupNumber).join(' ')).toMatch(/Shirt number \d+ is used 2 times/);

    const missingPlayer = withMatch((m) => (m.home.slots[0].playerId = 'ghost'));
    expect(errorsOf(missingPlayer).join(' ')).toMatch(/unknown player ghost/);

    const twoSlots = withMatch((m) => (m.home.slots[1].playerId = m.home.slots[0].playerId));
    expect(errorsOf(twoSlots).join(' ')).toMatch(/more than one slot/);

    const wrongSlotCount = withMatch((m) => m.home.slots.pop());
    expect(wrongSlotCount.ok).toBe(false);
  });

  it('rejects duplicate ids across the document', () => {
    const r = withMatch((m) => (m.events[2].id = m.events[1].id));
    expect(errorsOf(r).join(' ')).toMatch(/Event id "g1" is used more than once/);
    const sameTeam = withMatch((m) => (m.away.id = m.home.id));
    expect(errorsOf(sameTeam).join(' ')).toMatch(/same id/);
    const sharedPlayer = withMatch((m) => (m.away.players[0].id = m.home.players[0].id));
    expect(errorsOf(sharedPlayer).join(' ')).toMatch(/Player id/);
  });

  it('refuses oversized files before parsing', () => {
    const r = parseMatchJson(' '.repeat(MAX_IMPORT_BYTES + 1));
    expect(errorsOf(r)[0]).toMatch(/larger than 5 MB/);
  });

  it('caps how many problems it reports', () => {
    const r = withMatch((m) => m.home.players.forEach((p: { shirtNumber: unknown }) => (p.shirtNumber = 'x')));
    expect(errorsOf(r).length).toBeLessThanOrEqual(10);
  });
});

describe('tolerance and repairs', () => {
  it('strips unknown properties instead of failing', () => {
    const r = withMatch((m) => {
      m.futureFeature = { a: 1 };
      m.home.players[0].favouriteColour = 'blue';
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect('futureFeature' in r.match).toBe(false);
      expect('favouriteColour' in r.match.home.players[0]).toBe(false);
    }
  });

  it('imports with a warning when events no longer fit the squads', () => {
    const r = withMatch((m) => {
      m.events.push({ id: 'bad', type: 'substitution', teamId: m.home.id, outPlayerId: 'home-s1', inPlayerId: 'home-s2', period: 'secondHalf', matchTimeMs: 3_000_000 });
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.join(' ')).toMatch(/1 event is inconsistent/);
  });

  it('repairs a dangling saved-arrangement reference and a running clock outside play', () => {
    const r = withMatch((m) => {
      m.savedLayouts = [];
      m.clock = { period: 'halfTime', elapsedMs: 45 * 60_000, runningSinceEpochMs: 123, endedPeriod: 'firstHalf' };
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.match.home.formation).toEqual({ kind: 'preset', id: '4-3-3' });
      expect(r.match.clock.runningSinceEpochMs).toBeNull();
      expect(r.warnings).toHaveLength(2);
    }
  });
});

describe('export file names', () => {
  it('are safe, descriptive and dated', () => {
    const m = { ...richMatch(), name: '  Cup Tie: Home FC v Away FC!  ' };
    expect(exportFileName(m, 'json', NOW)).toBe('dizpitch-cup-tie-home-fc-v-away-fc-2026-10-10.json');
    const unnamed = { ...createMatch(), date: '' };
    expect(exportFileName(unnamed, 'png', NOW)).toBe('dizpitch-match-2026-10-10.png');
    expect(exportFileName({ ...unnamed, home: { ...unnamed.home, name: 'Goa' }, away: { ...unnamed.away, name: 'Mumbai' } }, 'png', NOW)).toBe(
      'dizpitch-goa-vs-mumbai-2026-10-10.png',
    );
  });
});
