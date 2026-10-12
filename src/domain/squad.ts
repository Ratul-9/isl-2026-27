import { isInBounds } from './geometry';
import { pickEmptySlot, SLOT_COUNT } from './layout';
import { isPositionCode, positionOrder } from './positions';
import type { Id, LineupRole, LineupSlot, Player, PositionCode, Team } from './types';

export const MAX_PLAYERS = 22;
export const MAX_STARTERS = 11;
export const MAX_SUBSTITUTES = 11;
/** Players a team may hold outside the matchday squad (a club's full squad, e.g. an ISL preset). */
export const MAX_POOL_PLAYERS = 60;
export const MIN_SHIRT_NUMBER = 1;
export const MAX_SHIRT_NUMBER = 99;
const MAX_NAME_LENGTH = 60;
export const MAX_NOTES_LENGTH = 500;

/** What the player form edits. `shirtNumber` is null while the field is blank/invalid. */
export interface PlayerDraft {
  name: string;
  shirtNumber: number | null;
  preferredPosition: PositionCode;
  notes: string;
  role: LineupRole;
}

type PlayerDraftField = 'name' | 'shirtNumber' | 'preferredPosition' | 'notes' | 'role' | 'form';
export type PlayerDraftErrors = Partial<Record<PlayerDraftField, string>>;

export type SquadResult =
  | { ok: true; team: Team }
  | { ok: false; errors: PlayerDraftErrors };


export interface SquadCounts {
  total: number;
  starters: number;
  substitutes: number;
}

export function getSquadCounts(team: Team): SquadCounts {
  return {
    total: team.players.length,
    starters: team.slots.filter((s) => s.playerId !== null).length,
    substitutes: team.bench.length,
  };
}

/** The lineup role of a player, or null when the player is in neither list (inconsistent data). */
export function getPlayerRole(team: Team, playerId: Id): LineupRole | null {
  if (team.slots.some((s) => s.playerId === playerId)) return 'starter';
  if (team.bench.includes(playerId)) return 'substitute';
  return null;
}

export interface Starter {
  player: Player;
  slot: LineupSlot;
}

/** Starting XI sorted goalkeeper → striker, then by shirt number. */
export function getStarters(team: Team): Starter[] {
  const byId = new Map(team.players.map((p) => [p.id, p]));
  const starters: Starter[] = [];
  for (const slot of team.slots) {
    const player = slot.playerId ? byId.get(slot.playerId) : undefined;
    if (player) starters.push({ player, slot });
  }
  return starters.sort(
    (a, b) =>
      positionOrder(a.slot.position) - positionOrder(b.slot.position) ||
      a.player.shirtNumber - b.player.shirtNumber,
  );
}

/** Substitutes in bench order. */
export function getSubstitutes(team: Team): Player[] {
  const byId = new Map(team.players.map((p) => [p.id, p]));
  return team.bench.flatMap((id) => {
    const player = byId.get(id);
    return player ? [player] : [];
  });
}

/** Role a newly added player gets by default: starter while the XI has room. */
export function defaultRoleForNewPlayer(team: Team): LineupRole {
  return getSquadCounts(team).starters < MAX_STARTERS ? 'starter' : 'substitute';
}

export function emptyPlayerDraft(team: Team): PlayerDraft {
  return {
    name: '',
    shirtNumber: null,
    preferredPosition: 'CM',
    notes: '',
    role: defaultRoleForNewPlayer(team),
  };
}

export function draftFromPlayer(team: Team, player: Player): PlayerDraft {
  return {
    name: player.name,
    shirtNumber: player.shirtNumber,
    preferredPosition: player.preferredPosition,
    notes: player.notes,
    role: getPlayerRole(team, player.id) ?? 'substitute',
  };
}

/** The field-level rules shared by squad and pool players (everything except squad-wide clashes and capacity). */
function validateDraftFields(draft: PlayerDraft): PlayerDraftErrors {
  const errors: PlayerDraftErrors = {};

  const name = draft.name.trim();
  if (name.length === 0) errors.name = 'Enter the player’s full name.';
  else if (name.length > MAX_NAME_LENGTH)
    errors.name = `Name must be ${MAX_NAME_LENGTH} characters or fewer.`;

  const number = draft.shirtNumber;
  if (number === null || !Number.isInteger(number)) {
    errors.shirtNumber = 'Enter a whole shirt number.';
  } else if (number < MIN_SHIRT_NUMBER || number > MAX_SHIRT_NUMBER) {
    errors.shirtNumber = `Shirt number must be between ${MIN_SHIRT_NUMBER} and ${MAX_SHIRT_NUMBER}.`;
  }

  if (!isPositionCode(draft.preferredPosition)) {
    errors.preferredPosition = 'Choose a position.';
  }

  if (draft.notes.length > MAX_NOTES_LENGTH) {
    errors.notes = `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`;
  }
  return errors;
}

/**
 * Validates a player form. Pass `editingPlayerId` when editing so the player's
 * own shirt number and current role are not counted against themselves.
 */
export function validatePlayerDraft(
  team: Team,
  draft: PlayerDraft,
  editingPlayerId?: Id,
): PlayerDraftErrors {
  const errors = validateDraftFields(draft);

  if (errors.shirtNumber === undefined) {
    const clash = team.players.find(
      (p) => p.shirtNumber === draft.shirtNumber && p.id !== editingPlayerId,
    );
    if (clash) errors.shirtNumber = `#${draft.shirtNumber} is already worn by ${clash.name || 'another player'}.`;
  }

  if (editingPlayerId === undefined && team.players.length >= MAX_PLAYERS) {
    errors.form = `A squad can have at most ${MAX_PLAYERS} players.`;
  }

  const currentRole = editingPlayerId ? getPlayerRole(team, editingPlayerId) : null;
  if (currentRole !== draft.role) {
    const roleError = roleCapacityError(team, draft.role);
    if (roleError) errors.role = roleError;
  }

  return errors;
}

function roleCapacityError(team: Team, role: LineupRole): string | null {
  const counts = getSquadCounts(team);
  if (role === 'starter' && counts.starters >= MAX_STARTERS) {
    return `The starting XI already has ${MAX_STARTERS} players.`;
  }
  if (role === 'substitute' && counts.substitutes >= MAX_SUBSTITUTES) {
    return `There are already ${MAX_SUBSTITUTES} substitutes.`;
  }
  return null;
}

/** Errors for moving an existing player between the XI and the bench. */
export function validateRoleChange(team: Team, playerId: Id, role: LineupRole): PlayerDraftErrors {
  if (!team.players.some((p) => p.id === playerId)) return { form: 'That player no longer exists.' };
  if (getPlayerRole(team, playerId) === role) return {};
  const error = roleCapacityError(team, role);
  return error ? { role: error } : {};
}

/**
 * Places a player in the XI (best-fitting empty slot) or on the bench, removing
 * them from wherever they were. Callers check capacity first.
 */
function withRole(team: Team, playerId: Id, role: LineupRole, preferred: PositionCode): Team {
  let slots = team.slots.map((s) => (s.playerId === playerId ? { ...s, playerId: null } : s));
  const bench = team.bench.filter((id) => id !== playerId);
  if (role === 'starter') {
    const target = pickEmptySlot(slots, preferred);
    if (!target) return team;
    slots = slots.map((s) => (s.id === target.id ? { ...s, playerId } : s));
  } else {
    bench.push(playerId);
  }
  return { ...team, slots, bench };
}

export function addPlayer(team: Team, draft: PlayerDraft, playerId: Id): SquadResult {
  const errors = validatePlayerDraft(team, draft);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const player: Player = {
    id: playerId,
    name: draft.name.trim(),
    shirtNumber: draft.shirtNumber as number,
    preferredPosition: draft.preferredPosition,
    notes: draft.notes.trim(),
  };
  const next = { ...team, players: [...team.players, player] };
  return { ok: true, team: withRole(next, player.id, draft.role, player.preferredPosition) };
}

/**
 * Updates name, number, preferred position, notes and role. The player's id
 * never changes. A player staying a starter keeps their slot (and its
 * position on the pitch and any manual lineup-position override).
 */
export function updatePlayer(team: Team, playerId: Id, draft: PlayerDraft): SquadResult {
  const existing = team.players.find((p) => p.id === playerId);
  if (!existing) return { ok: false, errors: { form: 'That player no longer exists.' } };

  const errors = validatePlayerDraft(team, draft, playerId);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const players = team.players.map((p) =>
    p.id === playerId
      ? {
          ...p,
          name: draft.name.trim(),
          shirtNumber: draft.shirtNumber as number,
          preferredPosition: draft.preferredPosition,
          notes: draft.notes.trim(),
        }
      : p,
  );
  const updated = { ...team, players };
  const currentRole = getPlayerRole(team, playerId);
  if (currentRole === draft.role) return { ok: true, team: updated };
  return { ok: true, team: withRole(updated, playerId, draft.role, draft.preferredPosition) };
}

export function removePlayer(team: Team, playerId: Id): Team {
  return {
    ...team,
    players: team.players.filter((p) => p.id !== playerId),
    slots: team.slots.map((s) => (s.playerId === playerId ? { ...s, playerId: null } : s)),
    bench: team.bench.filter((id) => id !== playerId),
  };
}

/** Moves a player between the starting XI and the bench. */
export function setLineupRole(team: Team, playerId: Id, role: LineupRole): SquadResult {
  const player = team.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, errors: { form: 'That player no longer exists.' } };
  if (getPlayerRole(team, playerId) === role) return { ok: true, team };

  const roleError = roleCapacityError(team, role);
  if (roleError) return { ok: false, errors: { role: roleError } };
  return { ok: true, team: withRole(team, playerId, role, player.preferredPosition) };
}

// --- squad pool --------------------------------------------------------------------------------
//
// `Team.players` is the matchday squad (invariant 12). A team created from a preset also holds the
// club's other players in `Team.pool`: registered, editable, but not in the XI or on the bench, and
// so invisible to the board and to events until the user moves them into the squad.

export function getPool(team: Team): Player[] {
  return team.pool ?? [];
}

/** Moves a pool player into the starting XI or onto the bench. Nothing changes when it is refused. */
export function promoteFromPool(team: Team, playerId: Id, role: LineupRole): SquadResult {
  const player = getPool(team).find((p) => p.id === playerId);
  if (!player) return { ok: false, errors: { form: 'That player is no longer in the squad pool.' } };
  if (team.players.length >= MAX_PLAYERS) {
    return { ok: false, errors: { form: `The matchday squad already has ${MAX_PLAYERS} players. Return a player to the pool first.` } };
  }
  const roleError = roleCapacityError(team, role);
  if (roleError) return { ok: false, errors: { role: roleError } };
  const clash = team.players.find((p) => p.shirtNumber === player.shirtNumber);
  if (clash) {
    return {
      ok: false,
      errors: {
        shirtNumber: `#${player.shirtNumber} is already worn by ${clash.name || 'another player'} in the matchday squad. Change one of the numbers first.`,
      },
    };
  }
  const next: Team = { ...team, players: [...team.players, player], pool: getPool(team).filter((p) => p.id !== playerId) };
  return { ok: true, team: withRole(next, player.id, role, player.preferredPosition) };
}

/** Takes a player out of the XI/bench and back into the pool. Callers check match events first. */
export function returnToPool(team: Team, playerId: Id): Team {
  const player = team.players.find((p) => p.id === playerId);
  if (!player) return team;
  return { ...removePlayer(team, playerId), pool: [...getPool(team), player] };
}

/** Edits a pool player's name, number, position and notes (the role field of the draft is ignored). */
export function updatePoolPlayer(team: Team, playerId: Id, draft: PlayerDraft): SquadResult {
  const pool = getPool(team);
  if (!pool.some((p) => p.id === playerId)) return { ok: false, errors: { form: 'That player is no longer in the squad pool.' } };
  const errors = validateDraftFields(draft);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    team: {
      ...team,
      pool: pool.map((p) =>
        p.id === playerId
          ? {
              ...p,
              name: draft.name.trim(),
              shirtNumber: draft.shirtNumber as number,
              preferredPosition: draft.preferredPosition,
              notes: draft.notes.trim(),
            }
          : p,
      ),
    },
  };
}

/** Manual override of the position label of a slot (and so of the player in it). */
export function setSlotPosition(team: Team, slotId: Id, position: PositionCode): Team {
  if (!isPositionCode(position) || !team.slots.some((s) => s.id === slotId)) return team;
  return {
    ...team,
    slots: team.slots.map((s) => (s.id === slotId ? { ...s, position } : s)),
  };
}

export interface SquadIntegrityIssue {
  code:
    | 'too-many-players'
    | 'too-many-starters'
    | 'too-many-substitutes'
    | 'duplicate-shirt-number'
    | 'player-in-multiple-slots'
    | 'player-on-bench-and-in-xi'
    | 'duplicate-bench-entry'
    | 'unknown-player'
    | 'player-without-role'
    | 'too-many-pool-players'
    | 'duplicate-player-id'
    | 'invalid-slot-count'
    | 'duplicate-slot-id'
    | 'slot-out-of-bounds';
  message: string;
}

/**
 * Whole-team consistency check, for imported/stored data and tests.
 * Returns an empty array when every squad invariant holds.
 */
export function validateSquadIntegrity(team: Team): SquadIntegrityIssue[] {
  const issues: SquadIntegrityIssue[] = [];
  const add = (code: SquadIntegrityIssue['code'], message: string) => issues.push({ code, message });

  const ids = new Set(team.players.map((p) => p.id));
  const counts = getSquadCounts(team);

  if (counts.total > MAX_PLAYERS) add('too-many-players', `More than ${MAX_PLAYERS} players registered.`);
  if (counts.starters > MAX_STARTERS) add('too-many-starters', `More than ${MAX_STARTERS} starters.`);
  if (counts.substitutes > MAX_SUBSTITUTES) add('too-many-substitutes', `More than ${MAX_SUBSTITUTES} substitutes.`);

  if (team.slots.length !== SLOT_COUNT) {
    add('invalid-slot-count', `A team must have exactly ${SLOT_COUNT} lineup slots (found ${team.slots.length}).`);
  }
  const slotIds = new Set<Id>();
  for (const slot of team.slots) {
    if (slotIds.has(slot.id)) add('duplicate-slot-id', `Slot id ${slot.id} is used more than once.`);
    slotIds.add(slot.id);
    if (!isInBounds(slot)) add('slot-out-of-bounds', `Slot ${slot.id} is outside the pitch.`);
  }

  const numbers = new Map<number, number>();
  for (const p of team.players) numbers.set(p.shirtNumber, (numbers.get(p.shirtNumber) ?? 0) + 1);
  for (const [number, count] of numbers) {
    if (count > 1) add('duplicate-shirt-number', `Shirt number ${number} is used ${count} times.`);
  }

  const slotted = new Set<Id>();
  for (const slot of team.slots) {
    if (slot.playerId === null) continue;
    if (!ids.has(slot.playerId)) add('unknown-player', `A lineup slot references unknown player ${slot.playerId}.`);
    if (slotted.has(slot.playerId)) add('player-in-multiple-slots', `Player ${slot.playerId} fills more than one slot.`);
    slotted.add(slot.playerId);
  }

  const benched = new Set<Id>();
  for (const id of team.bench) {
    if (!ids.has(id)) add('unknown-player', `The bench references unknown player ${id}.`);
    if (benched.has(id)) add('duplicate-bench-entry', `Player ${id} is on the bench twice.`);
    if (slotted.has(id)) add('player-on-bench-and-in-xi', `Player ${id} is both a starter and a substitute.`);
    benched.add(id);
  }

  for (const p of team.players) {
    if (!slotted.has(p.id) && !benched.has(p.id)) {
      add('player-without-role', `${p.name || p.id} is neither a starter nor a substitute.`);
    }
  }

  // The squad pool: bounded, and a player is either in the matchday squad or in the pool, never both.
  const pool = getPool(team);
  if (pool.length > MAX_POOL_PLAYERS) add('too-many-pool-players', `More than ${MAX_POOL_PLAYERS} players in the squad pool.`);
  const seen = new Set<Id>(ids);
  for (const p of pool) {
    if (seen.has(p.id)) add('duplicate-player-id', `Player ${p.name || p.id} appears more than once in the squad.`);
    seen.add(p.id);
  }

  return issues;
}
