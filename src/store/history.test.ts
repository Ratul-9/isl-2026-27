import { describe, expect, it } from 'vitest';
import { fullTeam } from '@/domain/fixtures';
import { fromMetres } from '@/domain/geometry';
import { createMatch } from '@/domain/match';
import type { Drawing, Match } from '@/domain/types';
import { createHistory, HISTORY_LIMIT, historyReducer } from './history';
import type { HistoryAction, HistoryState } from './history';

function start(): HistoryState {
  const m: Match = { ...createMatch(), home: fullTeam('home'), away: fullTeam('away') };
  return createHistory(m);
}

const run = (s: HistoryState, ...actions: HistoryAction[]) => actions.reduce(historyReducer, s);
const pass = (id: string): Drawing => ({ id, kind: 'pass', from: fromMetres({ x: 20, y: 30 }), to: fromMetres({ x: 40, y: 30 }) });

describe('historyReducer', () => {
  it('undoes and redoes a drag', () => {
    let s = start();
    const slot = s.match.home.slots[9];
    s = run(s, { type: 'slot/move', side: 'home', slotId: slot.id, point: { x: 0.7, y: 0.2 } });
    expect(s.past).toHaveLength(1);
    s = run(s, { type: 'history/undo' });
    expect(s.match.home.slots[9]).toMatchObject({ x: slot.x, y: slot.y });
    s = run(s, { type: 'history/redo' });
    expect(s.match.home.slots[9]).toMatchObject({ x: 0.7, y: 0.2 });
  });

  it('restores the exact drawing list across add, edit, delete and clear', () => {
    let s = start();
    const states: Drawing[][] = [s.match.drawings];
    const steps: HistoryAction[] = [
      { type: 'drawing/add', drawing: pass('a') },
      { type: 'drawing/add', drawing: { ...pass('b'), kind: 'shot' } },
      { type: 'drawing/update', id: 'a', patch: { kind: 'lofted', note: 'switch' } },
      { type: 'drawing/move', id: 'b', delta: { x: 0.05, y: 0.05 } },
      { type: 'drawings/delete', ids: ['a'] },
      { type: 'drawings/clear' },
    ];
    for (const step of steps) {
      s = run(s, step);
      states.push(s.match.drawings);
    }
    expect(s.past).toHaveLength(steps.length);
    for (let i = states.length - 2; i >= 0; i--) {
      s = run(s, { type: 'history/undo' });
      expect(s.match.drawings).toEqual(states[i]);
    }
    for (let i = 1; i < states.length; i++) {
      s = run(s, { type: 'history/redo' });
      expect(s.match.drawings).toEqual(states[i]);
    }
  });

  it('undoes formation switches and pattern applications together with their arrows', () => {
    let s = start();
    const original = s.match;
    s = run(
      s,
      { type: 'formation/apply', side: 'home', formation: { kind: 'preset', id: '3-5-2' } },
      { type: 'pattern/apply', side: 'home', patternId: 'high-press', idSeed: 'p' },
    );
    expect(s.match.drawings.length).toBeGreaterThan(0);
    s = run(s, { type: 'history/undo' }, { type: 'history/undo' });
    expect(s.match.home.slots).toEqual(original.home.slots);
    expect(s.match.home.formation).toEqual(original.home.formation);
    expect(s.match.drawings).toEqual([]);
  });

  it('clears redo when a new board change is made', () => {
    let s = start();
    s = run(s, { type: 'drawing/add', drawing: pass('a') }, { type: 'history/undo' });
    expect(s.future).toHaveLength(1);
    s = run(s, { type: 'drawing/add', drawing: pass('b') });
    expect(s.future).toHaveLength(0);
    expect(run(s, { type: 'history/redo' })).toBe(s);
  });

  it('keeps setup changes out of history and never undoes them', () => {
    let s = start();
    s = run(s, { type: 'drawing/add', drawing: pass('a') });
    s = run(s, { type: 'team/update', side: 'home', patch: { name: 'Renamed FC' } });
    expect(s.past).toHaveLength(1);
    s = run(s, { type: 'history/undo' });
    expect(s.match.home.name).toBe('Renamed FC');
    expect(s.match.drawings).toEqual([]);
  });

  it('never resurrects a removed player or un-benches a player when undoing a drag', () => {
    let s = start();
    const slot = s.match.home.slots.find((x) => x.playerId === 'home-p9')!;
    s = run(s, { type: 'slot/move', side: 'home', slotId: slot.id, point: { x: 0.6, y: 0.5 } });
    s = run(s, { type: 'player/remove', side: 'home', playerId: 'home-p9' });
    const benched = s.match.home.slots.find((x) => x.playerId === 'home-p8')!;
    s = run(s, { type: 'lineup/setRole', side: 'home', playerId: 'home-p8', role: 'substitute' });
    s = run(s, { type: 'history/undo' });

    const restored = s.match.home.slots.find((x) => x.id === slot.id)!;
    expect(restored).toMatchObject({ x: slot.x, y: slot.y, playerId: null });
    expect(s.match.home.players.some((p) => p.id === 'home-p9')).toBe(false);
    expect(s.match.home.slots.find((x) => x.id === benched.id)!.playerId).toBeNull();
    expect(s.match.home.bench).toContain('home-p8');
  });

  it('does not record rejected or no-op board actions', () => {
    let s = start();
    const slot = s.match.home.slots[0];
    s = run(s, { type: 'slot/move', side: 'home', slotId: slot.id, point: { x: slot.x, y: slot.y } });
    s = run(s, { type: 'drawing/update', id: 'missing', patch: { note: 'x' } });
    s = run(s, { type: 'drawing/add', drawing: { ...pass('tiny'), to: pass('tiny').from } });
    expect(s.past).toHaveLength(0);
    expect(run(s, { type: 'history/undo' })).toBe(s);
  });

  it('caps the history length', () => {
    let s = start();
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) s = run(s, { type: 'drawing/add', drawing: pass(`d${i}`) });
    expect(s.past).toHaveLength(HISTORY_LIMIT);
  });
});

describe('history and match events', () => {
  it('keeps clock and event actions out of the board undo history', () => {
    let s = start();
    s = run(s, { type: 'drawing/add', drawing: pass('a') });
    s = run(
      s,
      { type: 'clock/advance', to: 'firstHalf', now: 1_000, idSeed: 'k' },
      { type: 'event/add', event: { id: 'g', type: 'goal', teamId: s.match.home.id, goalType: 'normal', period: 'firstHalf', matchTimeMs: 60_000 } },
    );
    expect(s.past).toHaveLength(1);
    s = run(s, { type: 'history/undo' });
    // The drawing is undone; the clock and events are untouched.
    expect(s.match.drawings).toEqual([]);
    expect(s.match.clock.period).toBe('firstHalf');
    expect(s.match.events.map((e) => e.id)).toEqual(['k-1', 'g']);
  });
});
