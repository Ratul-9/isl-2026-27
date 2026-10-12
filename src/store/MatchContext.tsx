'use client';

import { createContext, useContext, useMemo, useReducer } from 'react';
import type { Dispatch, ReactNode } from 'react';
import { ClientOnly } from '@/components/ui/ClientOnly';
import { createId } from '@/domain/ids';
import { createMatch, getTeam } from '@/domain/match';
import type { MatchInfoPatch } from '@/domain/match';
import { promoteFromPool, updatePoolPlayer, validatePlayerDraft, validateRoleChange } from '@/domain/squad';
import type { PlayerDraft, PlayerDraftErrors } from '@/domain/squad';
import { analyzeEvents, checkEventChange, eventsReferencingPlayer } from '@/domain/events';
import type { MatchAnalysis } from '@/domain/events';
import type { EventChangeCheck } from '@/domain/events';
import type { PatternId } from '@/domain/patterns';
import { validateReplay } from '@/domain/replay/integrity';
import { MAX_REPLAYS_PER_MATCH } from '@/domain/replay/limits';
import type {
  Drawing,
  FormationRef,
  Id,
  LineupRole,
  Match,
  MatchEvent,
  Officials,
  Period,
  Point,
  PositionCode,
  TacticalReplay,
  TeamSide,
} from '@/domain/types';
import { createHistory, historyReducer } from './history';
import type { HistoryAction } from './history';
import type { DrawingPatch, TeamPatch } from './matchReducer';

interface HistoryFlags {
  canUndo: boolean;
  canRedo: boolean;
}

/** A new event before it has an id (distributive over the event union). */
export type EventDraft = MatchEvent extends infer E ? (E extends MatchEvent ? Omit<E, 'id'> : never) : never;

const MatchStateContext = createContext<Match | null>(null);
const HistoryFlagsContext = createContext<HistoryFlags>({ canUndo: false, canRedo: false });
const MatchDispatchContext = createContext<Dispatch<HistoryAction> | null>(null);

function MatchStateProvider({ initialMatch, children }: { initialMatch?: Match; children: ReactNode }) {
  const [state, dispatch] = useReducer(historyReducer, initialMatch, (m) => createHistory(m ?? createMatch()));
  const canUndo = state.past.length > 0;
  const canRedo = state.future.length > 0;
  const flags = useMemo(() => ({ canUndo, canRedo }), [canUndo, canRedo]);
  return (
    <MatchStateContext.Provider value={state.match}>
      <HistoryFlagsContext.Provider value={flags}>
        <MatchDispatchContext.Provider value={dispatch}>{children}</MatchDispatchContext.Provider>
      </HistoryFlagsContext.Provider>
    </MatchStateContext.Provider>
  );
}

export function MatchProvider({
  initialMatch,
  fallback = null,
  children,
}: {
  initialMatch?: Match;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ClientOnly fallback={fallback}>
      <MatchStateProvider initialMatch={initialMatch}>{children}</MatchStateProvider>
    </ClientOnly>
  );
}

export function useMatch(): Match {
  const match = useContext(MatchStateContext);
  if (!match) throw new Error('useMatch must be used inside <MatchProvider>.');
  return match;
}

export interface MatchActions {
  updateInfo(patch: MatchInfoPatch): void;
  updateOfficials(patch: Partial<Officials>): void;
  updateTeam(side: TeamSide, patch: TeamPatch): void;
  /** Validates against current state; returns errors, or `{}` after dispatching. */
  addPlayer(side: TeamSide, draft: PlayerDraft): PlayerDraftErrors;
  updatePlayer(side: TeamSide, playerId: Id, draft: PlayerDraft): PlayerDraftErrors;
  /** Returns an error message when the player can't be removed (e.g. referenced by events). */
  removePlayer(side: TeamSide, playerId: Id): string | null;
  setRole(side: TeamSide, playerId: Id, role: LineupRole): PlayerDraftErrors;
  /** Squad pool: move a pool player into the XI / bench. Returns the refusal reasons, or `{}` after dispatching. */
  promoteFromPool(side: TeamSide, playerId: Id, role: LineupRole): PlayerDraftErrors;
  /** Squad pool: move a squad player back to the pool. Returns a message when refused (e.g. referenced by events). */
  returnToPool(side: TeamSide, playerId: Id): string | null;
  updatePoolPlayer(side: TeamSide, playerId: Id, draft: PlayerDraft): PlayerDraftErrors;
  setSlotPosition(side: TeamSide, slotId: Id, position: PositionCode): void;
  moveSlot(side: TeamSide, slotId: Id, point: Point): void;
  applyFormation(side: TeamSide, formation: FormationRef): void;
  resetFormation(side: TeamSide): void;
  /** Saves the team's current arrangement; returns the new layout id. */
  saveLayout(side: TeamSide, name: string): Id;
  deleteLayout(layoutId: Id): void;
  applyPattern(side: TeamSide, patternId: PatternId): void;
  clearDrawings(): void;
  /** Adds a drawing (id generated here); returns the new id. */
  addDrawing(drawing: Omit<Drawing, 'id'>): Id;
  updateDrawing(id: Id, patch: DrawingPatch): void;
  moveDrawing(id: Id, delta: Point): void;
  deleteDrawings(ids: Id[]): void;
  // Clock and events. `Date.now()` is read here (UI layer), never in the domain.
  advancePeriod(to: Period): void;
  startClock(): void;
  pauseClock(): void;
  correctClock(correction: { period?: Period; elapsedMs: number }): void;
  /** Validates then adds; returns the check (non-empty `errors` = refused). */
  addEvent(draft: EventDraft): EventChangeCheck & { id: Id | null };
  updateEvent(event: MatchEvent): EventChangeCheck;
  deleteEvent(id: Id): void;
  /**
   * Saves (adds or replaces) a tactical replay on the match, stamping `updatedAt`.
   * Returns the reasons it was refused; an empty list means it was saved.
   */
  saveReplay(replay: TacticalReplay): string[];
  deleteReplay(id: Id): void;
  /** Draw players as circles or (for teams created from a preset) jerseys. Presentation only. */
  setPlayerDisplay(mode: 'circles' | 'jerseys'): void;
  setTeamKit(side: TeamSide, kit: 'home' | 'away'): void;
}

/** Action helpers: generate IDs, validate against current state, then dispatch. */
export function useMatchActions(): MatchActions {
  const match = useMatch();
  const dispatch = useContext(MatchDispatchContext);
  if (!dispatch) throw new Error('useMatchActions must be used inside <MatchProvider>.');

  return useMemo<MatchActions>(
    () => ({
      updateInfo: (patch) => dispatch({ type: 'match/updateInfo', patch }),
      updateOfficials: (patch) => dispatch({ type: 'officials/update', patch }),
      updateTeam: (side, patch) => dispatch({ type: 'team/update', side, patch }),
      addPlayer: (side, draft) => {
        const errors = validatePlayerDraft(getTeam(match, side), draft);
        if (Object.keys(errors).length === 0) {
          dispatch({ type: 'player/add', side, draft, playerId: createId('plr') });
        }
        return errors;
      },
      updatePlayer: (side, playerId, draft) => {
        const errors = validatePlayerDraft(getTeam(match, side), draft, playerId);
        if (Object.keys(errors).length === 0) {
          dispatch({ type: 'player/update', side, playerId, draft });
        }
        return errors;
      },
      removePlayer: (side, playerId) => {
        const refs = eventsReferencingPlayer(match.events, playerId).length;
        if (refs > 0) {
          return `This player appears in ${refs} match event${refs === 1 ? '' : 's'}. Delete or edit those events first.`;
        }
        dispatch({ type: 'player/remove', side, playerId });
        return null;
      },
      setRole: (side, playerId, role) => {
        const errors = validateRoleChange(getTeam(match, side), playerId, role);
        if (Object.keys(errors).length === 0) {
          dispatch({ type: 'lineup/setRole', side, playerId, role });
        }
        return errors;
      },
      promoteFromPool: (side, playerId, role) => {
        const result = promoteFromPool(getTeam(match, side), playerId, role);
        if (result.ok) dispatch({ type: 'pool/promote', side, playerId, role });
        return result.ok ? {} : result.errors;
      },
      returnToPool: (side, playerId) => {
        const refs = eventsReferencingPlayer(match.events, playerId).length;
        if (refs > 0) {
          return `This player appears in ${refs} match event${refs === 1 ? '' : 's'}. Delete or edit those events first.`;
        }
        dispatch({ type: 'pool/return', side, playerId });
        return null;
      },
      updatePoolPlayer: (side, playerId, draft) => {
        const result = updatePoolPlayer(getTeam(match, side), playerId, draft);
        if (result.ok) dispatch({ type: 'pool/update', side, playerId, draft });
        return result.ok ? {} : result.errors;
      },
      setSlotPosition: (side, slotId, position) => dispatch({ type: 'slot/setPosition', side, slotId, position }),
      moveSlot: (side, slotId, point) => dispatch({ type: 'slot/move', side, slotId, point }),
      applyFormation: (side, formation) => dispatch({ type: 'formation/apply', side, formation }),
      resetFormation: (side) => dispatch({ type: 'formation/reset', side }),
      saveLayout: (side, name) => {
        const layoutId = createId('layout');
        dispatch({ type: 'layout/save', side, layoutId, name });
        return layoutId;
      },
      deleteLayout: (layoutId) => dispatch({ type: 'layout/delete', layoutId }),
      applyPattern: (side, patternId) =>
        dispatch({ type: 'pattern/apply', side, patternId, idSeed: createId('drw') }),
      clearDrawings: () => dispatch({ type: 'drawings/clear' }),
      addDrawing: (drawing) => {
        const id = createId('drw');
        dispatch({ type: 'drawing/add', drawing: { ...drawing, id } });
        return id;
      },
      updateDrawing: (id, patch) => dispatch({ type: 'drawing/update', id, patch }),
      moveDrawing: (id, delta) => dispatch({ type: 'drawing/move', id, delta }),
      deleteDrawings: (ids) => {
        if (ids.length > 0) dispatch({ type: 'drawings/delete', ids });
      },
      advancePeriod: (to) => dispatch({ type: 'clock/advance', to, now: Date.now(), idSeed: createId('evt') }),
      startClock: () => dispatch({ type: 'clock/start', now: Date.now() }),
      pauseClock: () => dispatch({ type: 'clock/pause', now: Date.now() }),
      correctClock: (correction) => dispatch({ type: 'clock/correct', ...correction, now: Date.now() }),
      addEvent: (draft) => {
        const event = { ...draft, id: createId('evt') } as MatchEvent;
        const check = checkEventChange(match, event);
        if (check.errors.length > 0) return { ...check, id: null };
        dispatch({ type: 'event/add', event });
        return { ...check, id: event.id };
      },
      updateEvent: (event) => {
        const check = checkEventChange(match, event);
        if (check.errors.length === 0) dispatch({ type: 'event/update', event });
        return check;
      },
      deleteEvent: (id) => dispatch({ type: 'event/delete', id }),
      saveReplay: (replay) => {
        const errors = validateReplay(replay);
        const isNew = !match.replays.some((r) => r.id === replay.id);
        if (isNew && match.replays.length >= MAX_REPLAYS_PER_MATCH) {
          errors.push(`A match can hold at most ${MAX_REPLAYS_PER_MATCH} replays. Delete one first.`);
        }
        if (errors.length === 0) {
          dispatch({ type: 'replay/save', replay: { ...replay, updatedAt: new Date().toISOString() } });
        }
        return errors;
      },
      deleteReplay: (id) => dispatch({ type: 'replay/delete', id }),
      setPlayerDisplay: (mode) => dispatch({ type: 'display/setPlayers', mode }),
      setTeamKit: (side, kit) => dispatch({ type: 'team/setKit', side, kit }),
    }),
    [dispatch, match],
  );
}

export interface BoardHistory extends HistoryFlags {
  undo(): void;
  redo(): void;
}

/** Undo/redo for tactical-board changes (see `store/history.ts`). */
export function useBoardHistory(): BoardHistory {
  const flags = useContext(HistoryFlagsContext);
  const dispatch = useContext(MatchDispatchContext);
  if (!dispatch) throw new Error('useBoardHistory must be used inside <MatchProvider>.');
  return useMemo(
    () => ({
      ...flags,
      undo: () => dispatch({ type: 'history/undo' }),
      redo: () => dispatch({ type: 'history/redo' }),
    }),
    [flags, dispatch],
  );
}

/**
 * Derived view of the match events: score, per-event errors/warnings and the
 * ACTIVE lineups (starting XI folded with substitutions and dismissals).
 * Memoised on the match, so every component shares one computation per change.
 */
export function useMatchAnalysis(): MatchAnalysis {
  const match = useMatch();
  return useMemo(() => analyzeEvents(match), [match]);
}
