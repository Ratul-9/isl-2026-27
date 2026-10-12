import { describe, expect, it } from 'vitest';
import { cloneMatchWithNewIds } from '@/domain/duplicate';
import { counterIds } from '@/domain/replay/fixtures';
import { parseDocument, parseMatchJson, serializeDocument } from './document';
import { richMatch } from './testFixtures';
import realResult from '@/tracking/__fixtures__/real-result-147s.json';
import { asServiceResult, trackingResultSchema } from '@/tracking/schema';
import { replayFromTracking, trackingFromServiceResult } from '@/domain/tracking/build';
import { assignPlayer, rejectObservation, setClusterSide, setPosition } from '@/domain/tracking/edit';
import type { Match } from '@/domain/types';

/** richMatch plus a tracked replay built from REAL cv-service output, with user edits. */
function matchWithTrackedReplay(): Match {
  const match = richMatch();
  let tracking = trackingFromServiceResult(asServiceResult(trackingResultSchema.parse(realResult)), 'test_clip.mp4');
  tracking = setClusterSide(tracking, 'A', 'home');
  const person = tracking.tracks.find((t) => t.objectType === 'player' && t.team === 'A')!;
  tracking = assignPlayer(tracking, person.id, match.home.players[0].id);
  tracking = setPosition(tracking, person.id, person.obs.frame[0], { x: 40, y: 50 }, '2026-10-12T10:00:00.000Z');
  tracking = rejectObservation(tracking, person.id, person.obs.frame[1], '2026-10-12T10:00:00.000Z');
  const replay = replayFromTracking(tracking, { id: 'rpl-track', now: '2026-10-12T10:00:00.000Z' });
  return { ...match, replays: [...match.replays, replay] };
}

describe('replays in persisted matches', () => {
  it('round-trips a replay with its original analysis, edits and provenance exactly', () => {
    const match = richMatch();
    expect(match.replays).toHaveLength(1);
    const parsed = parseMatchJson(serializeDocument(match, new Date('2026-10-12T10:00:00Z')));
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.match.replays).toEqual(match.replays);
    expect(parsed.match.replays[0].original).toEqual(match.replays[0].original);
    expect(parsed.warnings).toEqual([]);
  });

  it('does not touch the rest of the match when replays are present', () => {
    const match = richMatch();
    const parsed = parseMatchJson(serializeDocument(match, new Date()));
    if (!parsed.ok) throw new Error('parse failed');
    const { replays: _a, ...rest } = parsed.match;
    const { replays: _b, ...expected } = match;
    void _a;
    void _b;
    expect(rest).toEqual(expected);
  });

  it('rejects a replay with a position off the pitch, naming where', () => {
    const doc = JSON.parse(serializeDocument(richMatch(), new Date()));
    const kf = doc.match.replays[0].keyframes[0];
    kf.positions[Object.keys(kf.positions)[0]].x = 140;
    const parsed = parseDocument(doc);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join('\n')).toMatch(/replays\[0\]\.keyframes\[0\]\.positions\.[\w-]+\.x/);
  });

  it('rejects malformed replay data without partially importing', () => {
    const doc = JSON.parse(serializeDocument(richMatch(), new Date()));
    doc.match.replays[0].event.type = 'wizardry';
    expect(parseDocument(doc)).toMatchObject({ ok: false });
    const dup = JSON.parse(serializeDocument(richMatch(), new Date()));
    dup.match.replays.push(dup.match.replays[0]);
    const r = parseDocument(dup);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/Replay id/);
  });

  it('clears a link to a squad player that is not in the file and says so', () => {
    const doc = JSON.parse(serializeDocument(richMatch(), new Date()));
    doc.match.replays[0].actors[0].playerId = 'no-such-player';
    const parsed = parseDocument(doc);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.match.replays[0].actors[0].playerId).toBeNull();
      expect(parsed.warnings.join(' ')).toMatch(/player link/);
    }
  });

  it('a duplicated match carries independent replays whose squad links point at the copy', () => {
    const original = richMatch();
    const copy = cloneMatchWithNewIds(original, counterIds());
    expect(copy.replays).toHaveLength(1);
    expect(copy.replays[0].id).not.toBe(original.replays[0].id);
    const linked = copy.replays[0].actors[0].playerId!;
    expect(linked).not.toBe('home-p9');
    expect(copy.home.players.some((p) => p.id === linked)).toBe(true);
    // Editing the copy does not reach the original.
    const firstKey = (r: typeof copy.replays[0]) => Object.keys(r.keyframes[0].positions)[0];
    copy.replays[0].keyframes[0].positions[firstKey(copy.replays[0])].x = 1;
    expect(original.replays[0].keyframes[0].positions[firstKey(original.replays[0])].x).not.toBe(1);
    // Internal references still resolve inside the copy.
    const actorIds = new Set(copy.replays[0].actors.map((a) => a.id));
    for (const k of copy.replays[0].keyframes) for (const id of Object.keys(k.positions)) expect(actorIds.has(id)).toBe(true);
    for (const p of copy.replays[0].paths) for (const id of [p.fromActorId, p.toActorId]) if (id) expect(actorIds.has(id)).toBe(true);
    expect(copy.replays[0].original).toEqual(original.replays[0].original);
    expect(copy.replays[0].original).not.toBe(original.replays[0].original);
  });

  it('round-trips a tracked replay (real service output, team mapping, squad link, corrections) exactly', () => {
    const match = matchWithTrackedReplay();
    const json = serializeDocument(match, new Date('2026-10-12T10:00:00Z'));
    expect(json).not.toMatch(/base64|data:video/);
    const parsed = parseMatchJson(json);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.match.replays[1]).toEqual(match.replays[1]);
    expect(parsed.warnings).toEqual([]);
  });

  it('clears a tracked player link to someone not in that squad and says so', () => {
    const doc = JSON.parse(serializeDocument(matchWithTrackedReplay(), new Date()));
    const linked = doc.match.replays[1].tracking.tracks.find((t: { playerId: string | null }) => t.playerId !== null);
    linked.playerId = doc.match.away.players[0].id; // the track is on the home side
    const parsed = parseDocument(doc);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.match.replays[1].tracking!.tracks.every((t) => t.playerId === null)).toBe(true);
      expect(parsed.warnings.join(' ')).toMatch(/player link/);
    }
  });

  it('refuses a tracked replay whose data is inconsistent', () => {
    const doc = JSON.parse(serializeDocument(matchWithTrackedReplay(), new Date()));
    doc.match.replays[1].tracking.frameTimesMs.pop();
    expect(parseDocument(doc).ok).toBe(false);
  });

  it('a duplicated match remaps tracked squad links to the copy', () => {
    const original = matchWithTrackedReplay();
    const copy = cloneMatchWithNewIds(original, counterIds());
    const link = copy.replays[1].tracking!.tracks.find((t) => t.playerId !== null)!.playerId!;
    expect(copy.home.players.some((p) => p.id === link)).toBe(true);
    expect(original.home.players.some((p) => p.id === link)).toBe(false);
  });

  it('stores tracking blocks compactly (indenting them would multiply the size) and still round-trips exactly', () => {
    const match = matchWithTrackedReplay();
    match.notes = 'Tricky text: "dizpitch-tracking:1" and dizpitch-tracking- must survive.';
    const json = serializeDocument(match, new Date('2026-10-12T10:00:00Z'));
    const pretty = JSON.stringify({ format: 'x', match }, null, 2).length;
    expect(json.length).toBeLessThan(pretty / 2);
    expect(json).toContain('\n  "match": {'); // the rest stays readable
    const parsed = parseMatchJson(json);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.match.notes).toBe(match.notes);
    expect(parsed.match.replays).toEqual(match.replays);
  });

  it('round-trips the jersey display choice, a side\'s kit and a temporary-number marker', () => {
    const match = richMatch();
    const withKits = {
      ...match,
      playerDisplay: 'jerseys' as const,
      home: {
        ...match.home,
        kit: 'away' as const,
        players: match.home.players.map((p, i) =>
          i === 0
            ? { ...p, origin: { presetId: 'p1', season: '2026-27', imported: { name: p.name, shirtNumber: null, position: p.preferredPosition }, assignedNumber: p.shirtNumber, sourcePosition: null, nationality: null, dateOfBirth: null, photoUrl: null, profileUrl: null } }
            : p,
        ),
      },
    };
    const parsed = parseMatchJson(serializeDocument(withKits, new Date('2026-10-12T10:00:00Z')));
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.match.playerDisplay).toBe('jerseys');
    expect(parsed.match.home.kit).toBe('away');
    expect(parsed.match.home.players[0].origin?.assignedNumber).toBe(withKits.home.players[0].shirtNumber);
    expect(parsed.match).toEqual(withKits);
    // A duplicate keeps the choice.
    const copy = cloneMatchWithNewIds(withKits, counterIds());
    expect(copy.playerDisplay).toBe('jerseys');
    expect(copy.home.kit).toBe('away');
    expect(copy.home.players[0].origin?.assignedNumber).toBe(withKits.home.players[0].shirtNumber);
  });
});
