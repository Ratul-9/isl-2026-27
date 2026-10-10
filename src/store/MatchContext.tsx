'use client';

import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  useSyncExternalStore,
} from 'react';
import type { Dispatch, ReactNode } from 'react';
import { createId } from '@/domain/ids';
import { createMatch, getTeam } from '@/domain/match';
import type { MatchInfoPatch } from '@/domain/match';
import { validatePlayerDraft, validateRoleChange } from '@/domain/squad';
import type { PlayerDraft, PlayerDraftErrors } from '@/domain/squad';
import type { PatternId } from '@/domain/patterns';
import type { FormationRef, Id, LineupRole, Match, Officials, Point, PositionCode, TeamSide } from '@/domain/types';
import { matchReducer } from './matchReducer';
import type { MatchAction, TeamPatch } from './matchReducer';

const MatchStateContext = createContext<Match | null>(null);
const MatchDispatchContext = createContext<Dispatch<MatchAction> | null>(null);

const subscribeNever = () => () => {};

/**
 * Renders children only on the client. Match state uses random IDs, so it must
 * never be created during server prerendering (hydration + Cache Components).
 */
function ClientOnly({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const isClient = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  return isClient ? children : fallback;
}

function MatchStateProvider({ initialMatch, children }: { initialMatch?: Match; children: ReactNode }) {
  const [match, dispatch] = useReducer(matchReducer, initialMatch, (m) => m ?? createMatch());
  return (
    <MatchStateContext.Provider value={match}>
      <MatchDispatchContext.Provider value={dispatch}>{children}</MatchDispatchContext.Provider>
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
  removePlayer(side: TeamSide, playerId: Id): void;
  setRole(side: TeamSide, playerId: Id, role: LineupRole): PlayerDraftErrors;
  setSlotPosition(side: TeamSide, slotId: Id, position: PositionCode): void;
  moveSlot(side: TeamSide, slotId: Id, point: Point): void;
  applyFormation(side: TeamSide, formation: FormationRef): void;
  resetFormation(side: TeamSide): void;
  /** Saves the team's current arrangement; returns the new layout id. */
  saveLayout(side: TeamSide, name: string): Id;
  deleteLayout(layoutId: Id): void;
  applyPattern(side: TeamSide, patternId: PatternId): void;
  clearDrawings(): void;
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
      removePlayer: (side, playerId) => dispatch({ type: 'player/remove', side, playerId }),
      setRole: (side, playerId, role) => {
        const errors = validateRoleChange(getTeam(match, side), playerId, role);
        if (Object.keys(errors).length === 0) {
          dispatch({ type: 'lineup/setRole', side, playerId, role });
        }
        return errors;
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
    }),
    [dispatch, match],
  );
}
