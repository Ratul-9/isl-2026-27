import { DEFAULT_FORMATION, getFormation } from './formations';
import { clampPoint, distanceMetres, fromTeamFrame, pointsEqual, toTeamFrame } from './geometry';
import { POSITIONS } from './positions';
import type {
  FormationRef,
  Id,
  LineupSlot,
  Point,
  PositionCode,
  SavedLayout,
  TeamSide,
  Team,
  TemplateSlot,
} from './types';

/** Every team always has exactly this many slots; filled ones are the XI. */
export const SLOT_COUNT = 11;

// ---------------------------------------------------------------------------
// Position similarity, used to keep players in sensible roles when a layout
// changes and to pick a slot for a newly selected starter.
// ---------------------------------------------------------------------------

type Family = 'gk' | 'cb' | 'fbL' | 'fbR' | 'cm' | 'am' | 'wideL' | 'wideR' | 'fw';

const FAMILY: Record<PositionCode, Family> = {
  GK: 'gk',
  LCB: 'cb',
  CB: 'cb',
  RCB: 'cb',
  LB: 'fbL',
  LWB: 'fbL',
  RB: 'fbR',
  RWB: 'fbR',
  CDM: 'cm',
  LCM: 'cm',
  CM: 'cm',
  RCM: 'cm',
  CAM: 'am',
  LM: 'wideL',
  LW: 'wideL',
  RM: 'wideR',
  RW: 'wideR',
  CF: 'fw',
  ST: 'fw',
};

const GROUP = new Map(POSITIONS.map((p) => [p.code, p.group]));

export function positionFamily(code: PositionCode): Family {
  return FAMILY[code];
}

/**
 * How badly `from` fits a slot labelled `to`. Labels dominate distance in the
 * assignment cost, so a left back stays a left back across formation changes.
 */
export function positionMismatch(from: PositionCode, to: PositionCode): number {
  if (from === to) return 0;
  if ((from === 'GK') !== (to === 'GK')) return 100;
  if (FAMILY[from] === FAMILY[to]) return 3;
  if (GROUP.get(from) === GROUP.get(to)) return 6;
  return 10;
}

/** Distance weight: 30 m of separation costs as much as one family step. */
const METRES_PER_COST = 10;

interface Candidate {
  slotIndex: number;
  templateIndex: number;
  cost: number;
}

/**
 * Greedy global-minimum assignment of slots to template entries: repeatedly
 * takes the cheapest remaining pair. Filled slots are assigned first so real
 * players get the best-fitting positions. Deterministic (ties → lower index).
 */
function assignTemplate(slots: readonly LineupSlot[], template: readonly TemplateSlot[], side: TeamSide): number[] {
  const result = new Array<number>(slots.length).fill(-1);
  const freeTemplates = new Set(template.map((_, i) => i));

  const pass = (indices: number[]) => {
    const candidates: Candidate[] = [];
    for (const slotIndex of indices) {
      const slot = slots[slotIndex];
      for (const templateIndex of freeTemplates) {
        const t = template[templateIndex];
        const target = fromTeamFrame({ x: t.x, y: t.y }, side);
        const cost =
          positionMismatch(slot.position, t.position) + distanceMetres(slot, target) / METRES_PER_COST;
        candidates.push({ slotIndex, templateIndex, cost });
      }
    }
    candidates.sort((a, b) => a.cost - b.cost || a.slotIndex - b.slotIndex || a.templateIndex - b.templateIndex);
    const assigned = new Set<number>();
    for (const c of candidates) {
      if (assigned.has(c.slotIndex) || !freeTemplates.has(c.templateIndex)) continue;
      result[c.slotIndex] = c.templateIndex;
      assigned.add(c.slotIndex);
      freeTemplates.delete(c.templateIndex);
    }
  };

  const filled = slots.flatMap((s, i) => (s.playerId !== null ? [i] : []));
  const empty = slots.flatMap((s, i) => (s.playerId === null ? [i] : []));
  pass(filled);
  pass(empty);
  return result;
}

/** Creates SLOT_COUNT empty slots laid out from a template. */
export function createSlots(template: readonly TemplateSlot[], side: TeamSide, slotIds: readonly Id[]): LineupSlot[] {
  if (template.length !== SLOT_COUNT || slotIds.length !== SLOT_COUNT) {
    throw new Error(`A layout needs exactly ${SLOT_COUNT} slots.`);
  }
  return template.map((t, i) => {
    const p = fromTeamFrame({ x: t.x, y: t.y }, side);
    return { id: slotIds[i], playerId: null, position: t.position, x: p.x, y: p.y };
  });
}

export function defaultSlots(side: TeamSide, slotIds: readonly Id[]): LineupSlot[] {
  return createSlots(getFormation(DEFAULT_FORMATION).slots, side, slotIds);
}

/**
 * Re-arranges a team's slots onto a template. Slot ids and the players in
 * them never change — only each slot's position label and coordinates — so
 * player identity and starting-XI membership are preserved.
 */
export function applyTemplate(
  team: Team,
  template: readonly TemplateSlot[],
  side: TeamSide,
  formation: FormationRef,
): Team {
  if (template.length !== SLOT_COUNT || team.slots.length !== SLOT_COUNT) return team;
  const mapping = assignTemplate(team.slots, template, side);
  const slots = team.slots.map((slot, i) => {
    const t = template[mapping[i]];
    const p = fromTeamFrame({ x: t.x, y: t.y }, side);
    return { ...slot, position: t.position, x: p.x, y: p.y };
  });
  return { ...team, slots, formation };
}

/** The template a formation reference points at, or null if a saved layout was deleted. */
export function resolveTemplate(
  ref: FormationRef,
  savedLayouts: readonly SavedLayout[],
): readonly TemplateSlot[] | null {
  if (ref.kind === 'preset') return getFormation(ref.id).slots;
  return savedLayouts.find((l) => l.id === ref.id)?.slots ?? null;
}

/** Restores the team's current formation defaults (positions and labels). */
export function resetToFormation(team: Team, side: TeamSide, savedLayouts: readonly SavedLayout[]): Team {
  const template = resolveTemplate(team.formation, savedLayouts);
  return template ? applyTemplate(team, template, side, team.formation) : team;
}

/** True when resetting would change anything, i.e. the user has a custom arrangement. */
export function isLayoutModified(team: Team, side: TeamSide, savedLayouts: readonly SavedLayout[]): boolean {
  const reset = resetToFormation(team, side, savedLayouts);
  return reset.slots.some((slot, i) => {
    const current = team.slots[i];
    return slot.position !== current.position || !pointsEqual(slot, current);
  });
}

export function moveSlot(team: Team, slotId: Id, point: Point): Team {
  const p = clampPoint(point);
  if (!team.slots.some((s) => s.id === slotId)) return team;
  return { ...team, slots: team.slots.map((s) => (s.id === slotId ? { ...s, x: p.x, y: p.y } : s)) };
}

/** Current arrangement in the team frame, for saving as a reusable layout. */
export function captureLayout(team: Team, side: TeamSide): TemplateSlot[] {
  return team.slots.map((s) => {
    const p = toTeamFrame({ x: s.x, y: s.y }, side);
    return { position: s.position, x: p.x, y: p.y };
  });
}

/**
 * Best empty slot for a player who joins the XI: exact position match, then
 * same family, then same group; a non-goalkeeper only takes the GK slot when
 * nothing else is free. Returns null when the XI is full.
 */
export function pickEmptySlot(slots: readonly LineupSlot[], preferred: PositionCode): LineupSlot | null {
  let best: LineupSlot | null = null;
  let bestCost = Infinity;
  for (const slot of slots) {
    if (slot.playerId !== null) continue;
    const cost = positionMismatch(preferred, slot.position);
    if (cost < bestCost) {
      best = slot;
      bestCost = cost;
    }
  }
  return best;
}

export interface SlotHit {
  side: TeamSide;
  slotId: Id;
  playerId: Id;
  point: Point;
}

/**
 * The nearest *occupied* slot within `radiusMetres` of a point, across both
 * teams. Used to start/end arrows on a player without relying on DOM hit tests.
 */
export function findPlayerAt(
  teams: { home: Team; away: Team },
  point: Point,
  radiusMetres: number,
): SlotHit | null {
  let best: SlotHit | null = null;
  let bestDistance = Infinity;
  for (const side of ['home', 'away'] as const) {
    for (const slot of teams[side].slots) {
      if (!slot.playerId) continue;
      const d = distanceMetres(slot, point);
      if (d <= radiusMetres && d < bestDistance) {
        best = { side, slotId: slot.id, playerId: slot.playerId, point: { x: slot.x, y: slot.y } };
        bestDistance = d;
      }
    }
  }
  return best;
}
