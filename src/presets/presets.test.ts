import { describe, expect, it } from 'vitest';
import { presetPlayer, presetSeason, presetTeam } from '@/domain/presets/fixtures';
import { safeImageUrl } from '@/domain/presets/images';
import { loadManifest, loadSeason } from './client';
import { diffSeasons, formatDiff } from './diff';
import { mergeTeams, parseCsv, seasonFromCsv } from './manual';
import { applyOverrides, overridesSchema, OVERRIDES_FORMAT } from './overrides';
import { checkSeasonPresets, summarizeSeason } from './quality';
import { buildReport } from './report';
import { parseManifest, parseSeasonPresets } from './schema';

const clone = <T,>(v: T): T => structuredClone(v);

describe('schema', () => {
  it('accepts a complete season and strips unknown properties', () => {
    const season = { ...presetSeason(), extra: 'nope' };
    const parsed = parseSeasonPresets(season);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect('extra' in parsed.value).toBe(false);
  });

  it('reports readable, path-prefixed errors for bad data', () => {
    const season = clone(presetSeason());
    season.teams[0].players[0].dateOfBirth = '1998-02-31';
    season.teams[1].logoUrl = 'javascript:alert(1)';
    season.teams[2].id = 'Has Spaces';
    const parsed = parseSeasonPresets(season);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      const text = parsed.errors.join('\n');
      expect(text).toContain('teams[0].players[0].dateOfBirth');
      expect(text).toContain('teams[1].logoUrl');
      expect(text).toContain('teams[2].id');
    }
  });

  it('rejects a file that is not a preset file', () => {
    expect(parseSeasonPresets({ format: 'something-else' }).ok).toBe(false);
    expect(parseSeasonPresets(null).ok).toBe(false);
  });

  it('validates the manifest, including path safety', () => {
    const ok = { format: 'dizpitch.presetindex', schemaVersion: 1, seasons: [{ league: { id: 'isl', name: 'Indian Super League' }, season: '2026-27', file: 'isl/2026-27.json', teams: 13, players: 366, generatedAt: '2026-10-12T05:00:00.000Z' }] };
    expect(parseManifest(ok).ok).toBe(true);
    const evil = clone(ok);
    evil.seasons[0].file = '../../etc/passwd';
    expect(parseManifest(evil).ok).toBe(false);
  });
});

describe('checkSeasonPresets', () => {
  it('passes a clean season with no errors', () => {
    const issues = checkSeasonPresets(presetSeason(), { expectedTeams: 3 });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('flags the wrong number of teams without failing', () => {
    const issues = checkSeasonPresets(presetSeason(), { expectedTeams: 13 });
    expect(issues).toContainEqual(expect.objectContaining({ code: 'unexpected-team-count', severity: 'warning' }));
  });

  it('errors on duplicate team ids, duplicate players and one player in two teams', () => {
    const season = clone(presetSeason());
    season.teams[1].id = season.teams[0].id;
    season.teams[2].players[1] = { ...season.teams[2].players[1], id: season.teams[2].players[0].id };
    season.teams[2].players[2] = { ...season.teams[2].players[2], id: season.teams[0].players[0].id };
    const codes = checkSeasonPresets(season).filter((i) => i.severity === 'error').map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['duplicate-team-id', 'duplicate-player-id', 'player-in-multiple-teams']));
  });

  it('warns about gaps: coach, numbers, positions, images, duplicates and out-of-range numbers', () => {
    const season = clone(presetSeason([presetTeam('a', { coach: null, players: [
      presetPlayer({ id: 'isl-player-1', name: 'A', shirtNumber: null, position: null, headshotUrl: null, dateOfBirth: null, nationality: null }),
      presetPlayer({ id: 'isl-player-2', name: 'B', shirtNumber: 8 }),
      presetPlayer({ id: 'isl-player-3', name: 'C', shirtNumber: 8 }),
      presetPlayer({ id: 'isl-player-4', name: 'D', shirtNumber: 120, headshotUrl: 'https://evil.example/x.png' }),
    ] })]));
    const codes = new Set(checkSeasonPresets(season).map((i) => i.code));
    for (const c of ['no-coach', 'small-squad', 'missing-shirt-number', 'missing-position', 'missing-headshot', 'missing-date-of-birth', 'missing-nationality', 'duplicate-shirt-number', 'shirt-number-out-of-range', 'image-url-not-allowed'] as const) {
      expect(codes.has(c)).toBe(true);
    }
  });

  it('summarises counts and gaps', () => {
    const summary = summarizeSeason(presetSeason());
    expect(summary).toMatchObject({ teams: 3, players: 78, coaches: 3 });
    expect(summary.gaps['players without a headshot URL']).toBe(0);
    expect(summary.gaps['teams without a short name']).toBe(3);
  });
});

describe('diffSeasons', () => {
  it('shows no change for identical data, whatever the timestamps', () => {
    const a = presetSeason();
    const b = clone(a);
    b.generatedAt = '2027-01-01T00:00:00.000Z';
    b.teams[0].source.retrievedAt = '2027-01-01T00:00:00.000Z';
    const diff = diffSeasons(a, b);
    expect(diff.changeCount).toBe(0);
    expect(formatDiff(diff)).toEqual(['No changes: the imported data is identical to the current file.']);
  });

  it('reports a coach change, a transfer between clubs, a departure, a new signing and a renumbering', () => {
    const before = presetSeason();
    const after = clone(before);
    after.teams[0].coach!.name = 'New Coach';
    const [moved] = after.teams[0].players.splice(0, 1); // leaves A…
    after.teams[1].players.push({ ...moved, shirtNumber: 40 }); // …joins B
    after.teams[0].players.splice(0, 1); // another leaves the league
    after.teams[1].players.push(presetPlayer({ id: 'isl-player-new', name: 'Newcomer', shirtNumber: 41 }));
    after.teams[2].players[0].shirtNumber = 77;

    const diff = diffSeasons(before, after);
    const a = diff.teams.find((t) => t.teamId === 'isl-club-a')!;
    const b = diff.teams.find((t) => t.teamId === 'isl-club-b')!;
    const c = diff.teams.find((t) => t.teamId === 'isl-club-c')!;
    expect(a.coach).toEqual({ from: 'Coach A', to: 'New Coach' });
    expect(a.playersRemoved).toEqual([
      expect.objectContaining({ id: moved.id, movedTo: 'Test FC B' }),
      expect.objectContaining({ movedTo: null }),
    ]);
    expect(b.playersAdded).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: moved.id, movedFrom: 'Test FC A' }), expect.objectContaining({ name: 'Newcomer', movedFrom: null })]),
    );
    expect(c.playersChanged[0].changes).toEqual([{ field: 'shirtNumber', from: 1, to: 77 }]);
    expect(formatDiff(diff).join('\n')).toContain('joined from Test FC A');
  });

  it('reports added and removed teams and treats a missing file as a new season', () => {
    const before = presetSeason();
    const after = presetSeason([before.teams[0], presetTeam('d')]);
    expect(diffSeasons(before, after)).toMatchObject({ teamsAdded: ['Test FC D'], teamsRemoved: ['Test FC B', 'Test FC C'] });
    expect(diffSeasons(null, after).isNew).toBe(true);
  });
});

describe('overrides', () => {
  const overrides = (o: Record<string, unknown>) => overridesSchema.parse({ format: OVERRIDES_FORMAT, schemaVersion: 1, league: 'isl', season: '2026-27', ...o });

  it('applies a correction, marks it manual and records why', () => {
    const season = presetSeason();
    const target = season.teams[0].players[0];
    const { doc, report } = applyOverrides(season, overrides({
      players: { [target.id]: { shirtNumber: 99, reason: 'Club announced a new number', source: 'https://example.com/news' } },
      teams: { 'isl-club-b': { city: 'Varanasi', reason: 'Home city confirmed by club site' } },
    }));
    const changed = doc.teams[0].players[0];
    expect(changed.shirtNumber).toBe(99);
    expect(changed.verification).toBe('manual');
    expect(changed.notes.join(' ')).toContain('Club announced a new number');
    expect(doc.teams[1].city).toBe('Varanasi');
    expect(report.applied).toHaveLength(2);
    expect(season.teams[0].players[0].shirtNumber).toBe(1); // the input is untouched
  });

  it('reports overrides that match nothing or that the source now agrees with', () => {
    const season = presetSeason();
    const p = season.teams[0].players[0];
    const { report } = applyOverrides(season, overrides({
      players: { [p.id]: { shirtNumber: p.shirtNumber, reason: 'old fix' }, 'isl-player-gone': { name: 'Ghost', reason: 'stale' } },
    }));
    expect(report.redundant).toHaveLength(1);
    expect(report.unmatched).toEqual(['player isl-player-gone']);
    expect(report.applied).toEqual([]);
  });

  it('requires a reason', () => {
    expect(overridesSchema.safeParse({ format: OVERRIDES_FORMAT, schemaVersion: 1, league: 'isl', season: '2026-27', teams: { x: { city: 'Y' } } }).success).toBe(false);
  });
});

describe('manual import', () => {
  const header = 'team,abbreviation,city,coach,player,shirt_number,position,nationality,date_of_birth,headshot_url,source_url';
  const ctx = { league: { id: 'isl', name: 'Indian Super League' }, season: '2026-27', now: '2026-10-12T09:00:00.000Z', fileName: 'squads.csv' };

  it('parses quoted CSV fields, doubled quotes and embedded commas', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\r\n\r\nlast,')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['last', '']]);
  });

  it('builds a valid season with manual verification and the supplied source on every record', () => {
    const csv = [
      header,
      'Test United,TU,Testville,Jane Coach,"Doe, John",9,Forward,India,1999-01-02,,https://club.example/squad',
      'Test United,TU,Testville,Jane Coach,Sam Keeper,1,Goalkeeper,Spain,,,https://club.example/squad',
    ].join('\n');
    const result = seasonFromCsv(csv, ctx);
    expect(result.errors).toEqual([]);
    const doc = result.doc!;
    expect(parseSeasonPresets(doc).ok).toBe(true);
    expect(doc.teams).toHaveLength(1);
    expect(doc.teams[0]).toMatchObject({ displayName: 'Test United', abbreviation: 'TU', city: 'Testville', verification: 'manual', coach: { name: 'Jane Coach' } });
    expect(doc.teams[0].players.map((p) => [p.name, p.shirtNumber, p.position, p.verification, p.source.url])).toEqual([
      ['Doe, John', 9, 'Forward', 'manual', 'https://club.example/squad'],
      ['Sam Keeper', 1, 'Goalkeeper', 'manual', 'https://club.example/squad'],
    ]);
  });

  it('rejects rows without a source or with an unknown position or bad date, naming the row', () => {
    const csv = [header, 'T,,,,P1,1,Winger,,,,https://x', 'T,,,,P2,2,Defender,,02/03/2000,,https://x', 'T,,,,P3,3,Defender,,,,'].join('\n');
    const result = seasonFromCsv(csv, ctx);
    expect(result.doc).toBeNull();
    expect(result.errors.join('\n')).toContain('Row 2: position "Winger"');
    expect(result.errors.join('\n')).toContain('Row 3: date_of_birth');
    expect(result.errors.join('\n')).toContain('Row 4: source_url is required');
  });

  it('merges by team: replaces the teams it contains and keeps the rest', () => {
    const existing = presetSeason();
    const incoming = presetSeason([presetTeam('b', { name: 'Test FC B', size: 5 }), presetTeam('z')]);
    const merged = mergeTeams(existing, incoming);
    expect(merged.teams.map((t) => t.id).sort()).toEqual(['isl-club-a', 'isl-club-b', 'isl-club-c', 'isl-club-z']);
    expect(merged.teams.find((t) => t.id === 'isl-club-b')!.players).toHaveLength(5);
    expect(merged.teams.find((t) => t.id === 'isl-club-a')).toEqual(existing.teams[0]);
  });
});

describe('report', () => {
  it('states what was imported, the gaps, and that a preview wrote nothing', () => {
    const doc = presetSeason();
    const text = buildReport({ doc, issues: checkSeasonPresets(doc), diff: diffSeasons(null, doc), overrides: null, applied: false, expectedTeams: 3 });
    expect(text).toContain('Indian Super League 2026-27');
    expect(text).toContain('PREVIEW ONLY');
    expect(text).toContain('Players: **78**');
    expect(text).toContain('players without a headshot URL');
  });
});

describe('safeImageUrl', () => {
  it('allows https on the league host only', () => {
    expect(safeImageUrl('https://www.indiansuperleague.com/static-assets/images/players/1.png')).not.toBeNull();
    expect(safeImageUrl('http://www.indiansuperleague.com/x.png')).toBeNull();
    expect(safeImageUrl('https://tracker.example/pixel.gif')).toBeNull();
    expect(safeImageUrl('javascript:alert(1)')).toBeNull();
    expect(safeImageUrl('https://user:pw@www.indiansuperleague.com/x.png')).toBeNull();
    expect(safeImageUrl('not a url')).toBeNull();
    expect(safeImageUrl(null)).toBeNull();
  });
});

describe('client loader', () => {
  const json = (value: unknown, status = 200) => async () => ({ ok: status < 400, status, json: async () => value });
  const manifest = { format: 'dizpitch.presetindex', schemaVersion: 1, seasons: [{ league: { id: 'isl', name: 'Indian Super League' }, season: '2026-27', file: 'isl/2026-27.json', teams: 3, players: 78, generatedAt: '2026-10-12T05:00:00.000Z' }] };

  it('treats a missing index as "not imported", not as an error', async () => {
    expect(await loadManifest(json({}, 404))).toMatchObject({ ok: false, kind: 'not-imported' });
  });

  it('reports unreachable, invalid JSON and invalid content separately', async () => {
    expect(await loadManifest(async () => { throw new TypeError('offline'); })).toMatchObject({ ok: false, kind: 'unreachable' });
    expect(await loadManifest(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }))).toMatchObject({ ok: false, kind: 'invalid' });
    expect(await loadManifest(json({ format: 'nope' }))).toMatchObject({ ok: false, kind: 'invalid' });
    expect(await loadManifest(json({}, 500))).toMatchObject({ ok: false, kind: 'unreachable' });
  });

  it('loads and validates a season, and calls a listed-but-missing file a broken import', async () => {
    const entry = parseManifest(manifest);
    if (!entry.ok) throw new Error('fixture');
    expect(await loadSeason(entry.value.seasons[0], json(presetSeason()))).toMatchObject({ ok: true });
    expect(await loadSeason(entry.value.seasons[0], json({}, 404))).toMatchObject({ ok: false, kind: 'invalid', message: expect.stringContaining('missing') });
    expect(await loadSeason(entry.value.seasons[0], json({ ...presetSeason(), teams: 'x' }))).toMatchObject({ ok: false, kind: 'invalid' });
  });
});
