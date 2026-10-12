import { describe, expect, it } from 'vitest';
import { at, goal, squadMatch, sub, withEvents } from '@/domain/eventFixtures';
import { fullTeam } from '@/domain/fixtures';
import { createMatch } from '@/domain/match';
import type { PlayerDraft } from '@/domain/squad';
import { matchReducer } from './matchReducer';

const draft = (o: Partial<PlayerDraft> = {}): PlayerDraft => ({
  name: 'Player',
  shirtNumber: 10,
  preferredPosition: 'CAM',
  notes: '',
  role: 'starter',
  ...o,
});

describe('matchReducer', () => {
  it('updates match info without touching teams', () => {
    const m = createMatch();
    const next = matchReducer(m, { type: 'match/updateInfo', patch: { venue: 'Fatorda', durationMinutes: 80 } });
    expect(next).toMatchObject({ venue: 'Fatorda', durationMinutes: 80 });
    expect(next.home).toBe(m.home);
    expect(next.away).toBe(m.away);
  });

  it('configures the two teams independently', () => {
    let m = createMatch();
    m = matchReducer(m, { type: 'team/update', side: 'home', patch: { name: 'Home FC', coach: 'H Coach' } });
    m = matchReducer(m, { type: 'team/update', side: 'away', patch: { name: 'Away FC' } });
    expect(m.home).toMatchObject({ name: 'Home FC', coach: 'H Coach' });
    expect(m.away).toMatchObject({ name: 'Away FC', coach: '' });
  });

  it('allows the same shirt number in both teams but not twice in one', () => {
    let m = createMatch();
    m = matchReducer(m, { type: 'player/add', side: 'home', draft: draft(), playerId: 'h1' });
    m = matchReducer(m, { type: 'player/add', side: 'away', draft: draft(), playerId: 'a1' });
    expect(m.home.players).toHaveLength(1);
    expect(m.away.players).toHaveLength(1);

    const rejected = matchReducer(m, {
      type: 'player/add',
      side: 'home',
      draft: draft({ name: 'Dup' }),
      playerId: 'h2',
    });
    expect(rejected).toBe(m);
  });

  it('returns the same state for a rejected role change', () => {
    let m = createMatch();
    for (let i = 1; i <= 11; i++) {
      m = matchReducer(m, {
        type: 'player/add',
        side: 'home',
        draft: draft({ name: `P${i}`, shirtNumber: i }),
        playerId: `p${i}`,
      });
    }
    m = matchReducer(m, {
      type: 'player/add',
      side: 'home',
      draft: draft({ name: 'Sub', shirtNumber: 12, role: 'substitute' }),
      playerId: 'sub',
    });
    const next = matchReducer(m, { type: 'lineup/setRole', side: 'home', playerId: 'sub', role: 'starter' });
    expect(next).toBe(m);
  });
});

describe('matchReducer: board actions', () => {
  function withSquads() {
    let m = createMatch();
    m = { ...m, home: fullTeam('home'), away: fullTeam('away') };
    return m;
  }

  it('switches formation and resets without touching the other team', () => {
    let m = withSquads();
    m = matchReducer(m, { type: 'formation/apply', side: 'home', formation: { kind: 'preset', id: '3-5-2' } });
    expect(m.home.formation).toEqual({ kind: 'preset', id: '3-5-2' });
    expect(m.away.formation).toEqual({ kind: 'preset', id: '4-3-3' });
    const slotId = m.home.slots[4].id;
    const before = m.home.slots[4];
    m = matchReducer(m, { type: 'slot/move', side: 'home', slotId, point: { x: 2, y: 0.5 } });
    expect(m.home.slots[4]).toMatchObject({ x: 1, y: 0.5 });
    m = matchReducer(m, { type: 'formation/reset', side: 'home' });
    expect(m.home.slots[4]).toMatchObject({ x: before.x, y: before.y });
  });

  it('replaces only the same team’s pattern arrows and clears drawings without moving players', () => {
    let m = withSquads();
    m = matchReducer(m, { type: 'pattern/apply', side: 'home', patternId: 'high-press', idSeed: 'a' });
    m = matchReducer(m, { type: 'pattern/apply', side: 'away', patternId: 'low-block', idSeed: 'b' });
    const awayCount = m.drawings.filter((d) => d.source?.teamId === m.away.id).length;
    m = matchReducer(m, { type: 'pattern/apply', side: 'home', patternId: 'overlap', idSeed: 'c' });
    const home = m.drawings.filter((d) => d.source?.teamId === m.home.id);
    expect(home.every((d) => d.source?.patternId === 'overlap' && d.id.startsWith('c-'))).toBe(true);
    expect(m.drawings.filter((d) => d.source?.teamId === m.away.id)).toHaveLength(awayCount);

    const slots = m.home.slots;
    m = matchReducer(m, { type: 'drawings/clear' });
    expect(m.drawings).toEqual([]);
    expect(m.home.slots).toBe(slots);
    expect(matchReducer(m, { type: 'drawings/clear' })).toBe(m);
  });

  it('saves a layout, makes the team follow it, and falls back to the base preset on delete', () => {
    let m = withSquads();
    m = matchReducer(m, { type: 'formation/apply', side: 'home', formation: { kind: 'preset', id: '4-4-2' } });
    m = matchReducer(m, { type: 'slot/move', side: 'home', slotId: m.home.slots[9].id, point: { x: 0.48, y: 0.3 } });
    m = matchReducer(m, { type: 'layout/save', side: 'home', layoutId: 'L1', name: '  Pressing 4-4-2  ' });
    expect(m.savedLayouts).toEqual([expect.objectContaining({ id: 'L1', name: 'Pressing 4-4-2', baseFormation: '4-4-2' })]);
    expect(m.home.formation).toEqual({ kind: 'saved', id: 'L1' });

    // The away team can reuse it (mirrored).
    m = matchReducer(m, { type: 'formation/apply', side: 'away', formation: { kind: 'saved', id: 'L1' } });
    expect(m.away.formation).toEqual({ kind: 'saved', id: 'L1' });
    expect(m.away.slots.every((s) => s.x > 0.5)).toBe(true);

    m = matchReducer(m, { type: 'layout/delete', layoutId: 'L1' });
    expect(m.savedLayouts).toEqual([]);
    expect(m.home.formation).toEqual({ kind: 'preset', id: '4-4-2' });
    expect(m.away.formation).toEqual({ kind: 'preset', id: '4-4-2' });
  });

  it('ignores blank layout names and unknown saved layouts', () => {
    const m = withSquads();
    expect(matchReducer(m, { type: 'layout/save', side: 'home', layoutId: 'x', name: '   ' })).toBe(m);
    expect(matchReducer(m, { type: 'formation/apply', side: 'home', formation: { kind: 'saved', id: 'nope' } })).toBe(m);
    expect(matchReducer(m, { type: 'layout/delete', layoutId: 'nope' })).toBe(m);
  });

  it('relabels a slot without moving it', () => {
    let m = withSquads();
    const slot = m.home.slots.find((s) => s.position === 'ST')!;
    m = matchReducer(m, { type: 'slot/setPosition', side: 'home', slotId: slot.id, position: 'CF' });
    expect(m.home.slots.find((s) => s.id === slot.id)).toMatchObject({ position: 'CF', x: slot.x, y: slot.y });
  });
});

describe('matchReducer: drawing actions', () => {
  const pass = (id: string) => ({
    id,
    kind: 'pass' as const,
    from: { x: 0.2, y: 0.4 },
    to: { x: 0.45, y: 0.4 },
  });

  it('adds sanitised user drawings and ignores duplicates or tiny gestures', () => {
    let m = createMatch();
    m = matchReducer(m, { type: 'drawing/add', drawing: { ...pass('a'), to: { x: 1.3, y: 0.4 }, source: { patternId: 'x', teamId: 't' } } });
    expect(m.drawings).toEqual([{ id: 'a', kind: 'pass', from: { x: 0.2, y: 0.4 }, to: { x: 1, y: 0.4 } }]);
    expect(matchReducer(m, { type: 'drawing/add', drawing: pass('a') })).toBe(m);
    expect(matchReducer(m, { type: 'drawing/add', drawing: { ...pass('b'), to: { x: 0.201, y: 0.4 } } })).toBe(m);
  });

  it('converts a pass to a lofted pass and adds a note without moving it', () => {
    let m = matchReducer(createMatch(), { type: 'drawing/add', drawing: pass('a') });
    m = matchReducer(m, { type: 'drawing/update', id: 'a', patch: { kind: 'lofted', note: 'Switch play' } });
    expect(m.drawings[0]).toMatchObject({ kind: 'lofted', note: 'Switch play', from: pass('a').from, to: pass('a').to });
  });

  it('edits an endpoint, attaching or detaching a player hint', () => {
    let m = matchReducer(createMatch(), { type: 'drawing/add', drawing: pass('a') });
    m = matchReducer(m, { type: 'drawing/update', id: 'a', patch: { to: { x: 0.6, y: 0.2 }, toPlayerId: 'p9' } });
    expect(m.drawings[0]).toMatchObject({ to: { x: 0.6, y: 0.2 }, toPlayerId: 'p9' });
    m = matchReducer(m, { type: 'drawing/update', id: 'a', patch: { to: { x: 0.7, y: 0.2 }, toPlayerId: undefined } });
    expect('toPlayerId' in m.drawings[0]).toBe(false);
  });

  it('detaches pattern arrows when the user edits them, so re-applying keeps them', () => {
    let m = { ...createMatch(), home: fullTeam('home') };
    m = matchReducer(m, { type: 'pattern/apply', side: 'home', patternId: 'overlap', idSeed: 's' });
    const edited = m.drawings[0].id;
    m = matchReducer(m, { type: 'drawing/update', id: edited, patch: { note: 'mine now' } });
    expect(m.drawings.find((d) => d.id === edited)?.source).toBeUndefined();
    m = matchReducer(m, { type: 'pattern/apply', side: 'home', patternId: 'high-press', idSeed: 't' });
    expect(m.drawings.some((d) => d.id === edited)).toBe(true);
  });

  it('refuses to turn an arrow into freehand (or back)', () => {
    let m = matchReducer(createMatch(), { type: 'drawing/add', drawing: pass('a') });
    m = matchReducer(m, { type: 'drawing/update', id: 'a', patch: { kind: 'freehand' } });
    expect(m.drawings[0].kind).toBe('pass');
  });

  it('moves and deletes drawings', () => {
    let m = matchReducer(createMatch(), { type: 'drawing/add', drawing: pass('a') });
    m = matchReducer(m, { type: 'drawing/add', drawing: pass('b') });
    m = matchReducer(m, { type: 'drawing/move', id: 'a', delta: { x: 0.1, y: 0.1 } });
    expect(m.drawings[0].from.x).toBeCloseTo(0.3);
    m = matchReducer(m, { type: 'drawings/delete', ids: ['a', 'zzz'] });
    expect(m.drawings.map((d) => d.id)).toEqual(['b']);
    expect(matchReducer(m, { type: 'drawings/delete', ids: ['nope'] })).toBe(m);
  });
});

describe('matchReducer: clock and events', () => {
  const T0 = Date.UTC(2026, 9, 10, 19, 30);
  const MIN = 60_000;

  it('advances periods, records timeline markers and keeps the status in step', () => {
    let m = squadMatch();
    expect(m.status).toBe('scheduled');
    m = matchReducer(m, { type: 'clock/advance', to: 'firstHalf', now: T0, idSeed: 'k' });
    expect(m.clock).toMatchObject({ period: 'firstHalf', runningSinceEpochMs: T0 });
    expect(m.status).toBe('inProgress');
    expect(m.events).toEqual([{ id: 'k-1', type: 'periodMarker', marker: 'kickoff', period: 'firstHalf', matchTimeMs: 0 }]);

    m = matchReducer(m, { type: 'clock/advance', to: 'halfTime', now: T0 + 46 * MIN, idSeed: 'h' });
    m = matchReducer(m, { type: 'clock/advance', to: 'secondHalf', now: T0 + 61 * MIN, idSeed: 's' });
    m = matchReducer(m, { type: 'clock/advance', to: 'fullTime', now: T0 + 109 * MIN, idSeed: 'f' });
    expect(m.status).toBe('completed');
    expect(m.events.map((e) => (e.type === 'periodMarker' ? e.marker : e.type))).toEqual([
      'kickoff',
      'halfTime',
      'secondHalfKickoff',
      'fullTime',
    ]);
    // Invalid transitions are ignored.
    expect(matchReducer(m, { type: 'clock/advance', to: 'secondHalf', now: T0, idSeed: 'x' })).toBe(m);
  });

  it('starts, pauses and corrects the clock', () => {
    let m = matchReducer(squadMatch(), { type: 'clock/advance', to: 'firstHalf', now: T0, idSeed: 'k' });
    m = matchReducer(m, { type: 'clock/pause', now: T0 + 10 * MIN });
    expect(m.clock).toMatchObject({ elapsedMs: 10 * MIN, runningSinceEpochMs: null });
    expect(matchReducer(m, { type: 'clock/pause', now: T0 + 11 * MIN })).toBe(m);
    m = matchReducer(m, { type: 'clock/correct', elapsedMs: 12 * MIN, now: T0 + 20 * MIN });
    expect(m.clock.elapsedMs).toBe(12 * MIN);
    m = matchReducer(m, { type: 'clock/start', now: T0 + 21 * MIN });
    expect(m.clock.runningSinceEpochMs).toBe(T0 + 21 * MIN);
    // Correcting back to pre-match leaves the manually chosen status alone.
    m = matchReducer({ ...m, status: 'inProgress' }, { type: 'clock/correct', period: 'notStarted', elapsedMs: 0, now: T0 });
    expect(m.status).toBe('inProgress');
  });

  it('adds valid events, refuses invalid ones, and edits in place', () => {
    let m = squadMatch();
    const g = goal(m, 'home', at(10), { scorer: 'home-p9', id: 'g' });
    m = matchReducer(m, { type: 'event/add', event: g });
    expect(m.events).toEqual([g]);
    expect(matchReducer(m, { type: 'event/add', event: g })).toBe(m); // duplicate id
    expect(matchReducer(m, { type: 'event/add', event: goal(m, 'home', at(11), { scorer: 'away-p9' }) })).toBe(m);

    const s = sub(m, 'home', at(5), 'home-p8', 'home-s0', 's');
    m = matchReducer(m, { type: 'event/add', event: s });
    const edited = { ...g, scorerId: 'home-p10' };
    m = matchReducer(m, { type: 'event/update', event: edited });
    expect(m.events.map((e) => e.id)).toEqual(['g', 's']); // array position kept
    expect(m.events[0]).toEqual(edited);
    expect(matchReducer(m, { type: 'event/update', event: { ...s, inPlayerId: 'home-p9' } as typeof s })).toBe(m);

    m = matchReducer(m, { type: 'event/delete', id: 'g' });
    expect(m.events.map((e) => e.id)).toEqual(['s']);
    expect(matchReducer(m, { type: 'event/delete', id: 'nope' })).toBe(m);
  });

  it('refuses to remove a player referenced by events', () => {
    const base = squadMatch();
    const m = withEvents(base, goal(base, 'home', at(10), { scorer: 'home-p9' }));
    expect(matchReducer(m, { type: 'player/remove', side: 'home', playerId: 'home-p9' })).toBe(m);
    const removed = matchReducer(m, { type: 'player/remove', side: 'home', playerId: 'home-p1' });
    expect(removed.home.players.some((p) => p.id === 'home-p1')).toBe(false);
  });
});

describe('matchReducer: patterns after substitutions', () => {
  it('attaches pattern arrows to the player now on the pitch while leaving the starting XI alone', () => {
    const base = squadMatch();
    // The striker (home-p9) is replaced by home-s0 before the pattern is applied.
    let m = withEvents(base, sub(base, 'home', at(60), 'home-p9', 'home-s0'));
    const startingSlots = m.home.slots;
    m = matchReducer(m, { type: 'pattern/apply', side: 'home', patternId: 'counterattack', idSeed: 'p' });

    const hints = m.drawings.flatMap((d) => [d.fromPlayerId, d.toPlayerId]);
    expect(hints).toContain('home-s0');
    expect(hints).not.toContain('home-p9');
    // Starting XI occupants are untouched (only geometry changed).
    expect(m.home.slots.map((s) => s.playerId)).toEqual(startingSlots.map((s) => s.playerId));
    expect(m.home.slots.map((s) => s.id)).toEqual(startingSlots.map((s) => s.id));
  });

  describe('jersey display', () => {
    const origin = (presetId: string) => ({
      presetId, league: 'isl', season: '2026-27', snapshotAt: '', verifiedAt: null, officialName: presetId,
      shortName: null, abbreviation: null, city: null, logoUrl: null, profileUrl: null, coach: null,
    });
    const presetMatch = () => {
      const m = createMatch();
      return { ...m, home: { ...m.home, preset: origin('isl-club-1874') } };
    };

    it('switches between circles and jerseys for a preset team, and refuses jerseys for custom teams', () => {
      const custom = createMatch();
      expect(matchReducer(custom, { type: 'display/setPlayers', mode: 'jerseys' })).toBe(custom);
      const m = presetMatch();
      const on = matchReducer(m, { type: 'display/setPlayers', mode: 'jerseys' });
      expect(on.playerDisplay).toBe('jerseys');
      expect(matchReducer(on, { type: 'display/setPlayers', mode: 'jerseys' })).toBe(on);
      expect(matchReducer(on, { type: 'display/setPlayers', mode: 'circles' }).playerDisplay).toBe('circles');
      // Nothing else changes.
      expect({ ...on, playerDisplay: undefined }).toEqual({ ...m, playerDisplay: undefined });
    });

    it('sets a kit only for a team that has a kit theme', () => {
      const m = presetMatch();
      expect(matchReducer(m, { type: 'team/setKit', side: 'home', kit: 'away' }).home.kit).toBe('away');
      expect(matchReducer(m, { type: 'team/setKit', side: 'away', kit: 'away' })).toBe(m);
    });
  });
});
