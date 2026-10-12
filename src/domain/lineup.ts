import type { Id, LineupSlot, Team } from './types';

/**
 * Active-lineup derivation (invariant 6). The starting XI lives in
 * `Team.slots`; the lineup at any moment is obtained by folding valid
 * substitutions and dismissals, in event order, over it. Nothing here mutates
 * the team, so editing or deleting any historical event simply re-derives.
 *
 * Rules: an incoming substitute takes the outgoing player's SLOT (so their
 * position on the board); a player who has been substituted off cannot return;
 * a dismissed player's slot is left empty; dismissed substitutes can't come on.
 */

export interface LineupState {
  /** slotId → current occupant (null = empty, e.g. after a red card). */
  occupants: Map<Id, Id | null>;
  /** Substitutes still available to come on. */
  available: Set<Id>;
  substitutedOff: Set<Id>;
  substitutedOn: Set<Id>;
  sentOff: Set<Id>;
  yellowCards: Map<Id, number>;
  substitutionsMade: number;
}

export function initialLineup(team: Team): LineupState {
  return {
    occupants: new Map(team.slots.map((s) => [s.id, s.playerId])),
    available: new Set(team.bench),
    substitutedOff: new Set(),
    substitutedOn: new Set(),
    sentOff: new Set(),
    yellowCards: new Map(),
    substitutionsMade: 0,
  };
}

export function isOnPitch(state: LineupState, playerId: Id): boolean {
  for (const occupant of state.occupants.values()) if (occupant === playerId) return true;
  return false;
}

function slotOf(state: LineupState, playerId: Id): Id | null {
  for (const [slotId, occupant] of state.occupants) if (occupant === playerId) return slotId;
  return null;
}

/** Why a substitution is impossible in this state, or null if it is valid. */
export function substitutionError(state: LineupState, outPlayerId: Id, inPlayerId: Id): string | null {
  if (outPlayerId === inPlayerId) return 'The outgoing and incoming player must be different.';
  if (!isOnPitch(state, outPlayerId)) {
    if (state.substitutedOff.has(outPlayerId)) return 'The outgoing player has already been substituted off.';
    if (state.sentOff.has(outPlayerId)) return 'The outgoing player has been sent off.';
    return 'The outgoing player is not on the pitch at this time.';
  }
  if (!state.available.has(inPlayerId)) {
    if (isOnPitch(state, inPlayerId)) return 'The incoming player is already on the pitch.';
    if (state.substitutedOff.has(inPlayerId)) return 'The incoming player was substituted off and cannot return.';
    if (state.sentOff.has(inPlayerId)) return 'The incoming player has been sent off.';
    return 'The incoming player is not an available substitute.';
  }
  return null;
}

/** Applies a substitution already checked with `substitutionError`. Returns a new state. */
export function applySubstitution(state: LineupState, outPlayerId: Id, inPlayerId: Id): LineupState {
  const slotId = slotOf(state, outPlayerId);
  if (slotId === null) return state;
  const occupants = new Map(state.occupants);
  occupants.set(slotId, inPlayerId);
  const available = new Set(state.available);
  available.delete(inPlayerId);
  return {
    ...state,
    occupants,
    available,
    substitutedOff: new Set(state.substitutedOff).add(outPlayerId),
    substitutedOn: new Set(state.substitutedOn).add(inPlayerId),
    substitutionsMade: state.substitutionsMade + 1,
  };
}

/** Why a card cannot be shown to this player now, or null. */
export function cardError(state: LineupState, playerId: Id): string | null {
  return state.sentOff.has(playerId) ? 'This player has already been sent off.' : null;
}

/**
 * Applies a card. A red card, or a second yellow, dismisses the player: they
 * leave the pitch without replacement (their slot empties) or, if on the
 * bench, become unavailable. Returns the new state and whether it dismissed.
 */
export function applyCard(state: LineupState, playerId: Id, card: 'yellow' | 'red'): { state: LineupState; dismissed: boolean } {
  const yellows = (state.yellowCards.get(playerId) ?? 0) + (card === 'yellow' ? 1 : 0);
  const yellowCards = new Map(state.yellowCards).set(playerId, yellows);
  const dismissed = card === 'red' || yellows >= 2;
  if (!dismissed) return { state: { ...state, yellowCards }, dismissed };

  const occupants = new Map(state.occupants);
  const slotId = slotOf(state, playerId);
  if (slotId !== null) occupants.set(slotId, null);
  const available = new Set(state.available);
  available.delete(playerId);
  return {
    state: { ...state, yellowCards, occupants, available, sentOff: new Set(state.sentOff).add(playerId) },
    dismissed,
  };
}

export interface DerivedLineup {
  /** The team's slots with the CURRENT occupant (null = empty). Geometry unchanged. */
  slots: LineupSlot[];
  onPitch: Id[];
  /** Substitutes still available. */
  bench: Id[];
  substitutedOff: Id[];
  substitutedOn: Id[];
  sentOff: Id[];
  yellowCards: Record<Id, number>;
  substitutionsMade: number;
}

/** Freezes a working state into a plain, render-friendly result. */
export function toDerivedLineup(team: Team, state: LineupState): DerivedLineup {
  const slots = team.slots.map((s) => ({ ...s, playerId: state.occupants.get(s.id) ?? null }));
  return {
    slots,
    onPitch: slots.flatMap((s) => (s.playerId ? [s.playerId] : [])),
    bench: team.bench.filter((id) => state.available.has(id)),
    substitutedOff: [...state.substitutedOff],
    substitutedOn: [...state.substitutedOn],
    sentOff: [...state.sentOff],
    yellowCards: Object.fromEntries(state.yellowCards),
    substitutionsMade: state.substitutionsMade,
  };
}
