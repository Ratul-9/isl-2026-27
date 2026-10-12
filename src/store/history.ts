import type { Drawing, FormationRef, Id, Match, PositionCode, SavedLayout } from '@/domain/types';
import { BOARD_ACTION_TYPES, matchReducer } from './matchReducer';
import type { MatchAction } from './matchReducer';

/**
 * Undo/redo for the tactical board (decision A6).
 *
 * Only board state is snapshotted: per-slot GEOMETRY keyed by slot id (label,
 * x, y), each team's formation reference, drawings and saved layouts. Who
 * occupies a slot is deliberately NOT part of a snapshot, so undoing a drag
 * after a roster change can never resurrect a removed player or put a
 * benched player back in the XI. Setup actions never enter the history.
 */

export const HISTORY_LIMIT = 100;

interface SlotGeometry {
  position: PositionCode;
  x: number;
  y: number;
}

interface BoardSnapshot {
  slots: { home: Record<Id, SlotGeometry>; away: Record<Id, SlotGeometry> };
  formations: { home: FormationRef; away: FormationRef };
  drawings: Drawing[];
  savedLayouts: SavedLayout[];
}

export interface HistoryState {
  match: Match;
  past: BoardSnapshot[];
  future: BoardSnapshot[];
}

export type HistoryAction = MatchAction | { type: 'history/undo' } | { type: 'history/redo' };

function geometry(match: Match, side: 'home' | 'away'): Record<Id, SlotGeometry> {
  return Object.fromEntries(
    match[side].slots.map((s) => [s.id, { position: s.position, x: s.x, y: s.y }]),
  );
}

function takeSnapshot(match: Match): BoardSnapshot {
  return {
    slots: { home: geometry(match, 'home'), away: geometry(match, 'away') },
    formations: { home: match.home.formation, away: match.away.formation },
    drawings: match.drawings,
    savedLayouts: match.savedLayouts,
  };
}

/** Restores board state onto the current match, keeping current slot occupants and roster. */
function restoreSnapshot(match: Match, snap: BoardSnapshot): Match {
  const side = (s: 'home' | 'away') => ({
    ...match[s],
    formation: snap.formations[s],
    slots: match[s].slots.map((slot) => {
      const g = snap.slots[s][slot.id];
      return g ? { ...slot, position: g.position, x: g.x, y: g.y } : slot;
    }),
  });
  return { ...match, home: side('home'), away: side('away'), drawings: snap.drawings, savedLayouts: snap.savedLayouts };
}

const sameBoard = (a: BoardSnapshot, b: BoardSnapshot) => JSON.stringify(a) === JSON.stringify(b);

export function createHistory(match: Match): HistoryState {
  return { match, past: [], future: [] };
}

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  if (action.type === 'history/undo') {
    const previous = state.past[state.past.length - 1];
    if (!previous) return state;
    return {
      match: restoreSnapshot(state.match, previous),
      past: state.past.slice(0, -1),
      future: [takeSnapshot(state.match), ...state.future],
    };
  }

  if (action.type === 'history/redo') {
    const [next, ...rest] = state.future;
    if (!next) return state;
    return {
      match: restoreSnapshot(state.match, next),
      past: [...state.past, takeSnapshot(state.match)],
      future: rest,
    };
  }

  const match = matchReducer(state.match, action);
  if (match === state.match) return state;
  if (!BOARD_ACTION_TYPES.has(action.type)) return { ...state, match };

  const before = takeSnapshot(state.match);
  // Board actions that changed nothing visible (e.g. a zero-length move) aren't recorded.
  if (sameBoard(before, takeSnapshot(match))) return { ...state, match };
  return {
    match,
    past: [...state.past, before].slice(-HISTORY_LIMIT),
    future: [],
  };
}
