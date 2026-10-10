import { describe, expect, it } from 'vitest';
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
