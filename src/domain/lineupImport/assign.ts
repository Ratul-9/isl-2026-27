import { getFormation } from '../formations';
import type { FormationId, Point } from '../types';
import { imageToTeamFrame } from './orientation';
import type { GoalkeeperEdge } from './types';

export interface AssignInput {
  /** Position on the source graphic's pitch, or null when unknown. */
  x: number | null;
  y: number | null;
  /** Displayed as the goalkeeper (position text or "(GK)" marker). */
  goalkeeper: boolean;
}

export interface Assignment {
  /** Template slot index (0 = goalkeeper) per input starter; null when it could not be placed. */
  slots: (number | null)[];
  confident: boolean;
  reason: string | null;
}

/** Line sizes of a formation, back to front, e.g. '4-2-3-1' → [4, 2, 3, 1]. */
export function formationLines(id: FormationId): number[] {
  return id.split('-').map(Number);
}

/**
 * Places up to 11 starters onto a formation's slots using their positions on
 * the source graphic: the goalkeeper takes slot 0; the others are grouped
 * into the formation's lines by depth, then ordered left→right within a line
 * (from the team's own left) and matched to that line's slots in order.
 *
 * Template slots are in the same left→right order, so this reproduces how a
 * broadcast graphic is laid out. When coordinates are missing the input order
 * is used (goalkeeper first, then line by line) and the result is flagged
 * as not confident.
 */
export function assignStarters(inputs: AssignInput[], formation: FormationId, edge: GoalkeeperEdge | null): Assignment {
  const template = getFormation(formation).slots;
  const lines = formationLines(formation);
  const result: (number | null)[] = inputs.map(() => null);
  if (inputs.length === 0) return { slots: result, confident: false, reason: 'No starters were found.' };

  // 1. Goalkeeper: marked as one, else the deepest player on the graphic, else the first listed.
  const team = inputs.map((p) =>
    p.x !== null && p.y !== null && edge ? imageToTeamFrame({ x: p.x, y: p.y }, edge) : null,
  );
  let gk = inputs.findIndex((p) => p.goalkeeper);
  if (gk < 0) {
    let deepest = -1;
    team.forEach((t, i) => {
      if (t && (deepest < 0 || t.x < (team[deepest] as Point).x)) deepest = i;
    });
    gk = deepest >= 0 ? deepest : 0;
  }
  result[gk] = 0;

  // 2. Outfield players, ordered back to front using the graphic when it is complete.
  const outfield = inputs.map((_, i) => i).filter((i) => i !== gk);
  const haveCoordinates = outfield.every((i) => team[i] !== null);
  const sizes = lines.slice(0, lines.length);
  const expected = sizes.reduce((a, b) => a + b, 0);

  const templateOutfield = template
    .map((s, index) => ({ index, x: s.x, y: s.y }))
    .filter((s) => s.index !== 0)
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const templateLines: number[][] = [];
  let cursor = 0;
  for (const size of sizes) {
    templateLines.push(
      templateOutfield
        .slice(cursor, cursor + size)
        .sort((a, b) => a.y - b.y)
        .map((s) => s.index),
    );
    cursor += size;
  }

  let confident = true;
  let reason: string | null = null;
  if (outfield.length !== expected) {
    confident = false;
    reason = `${formation} needs ${expected} outfield players but ${outfield.length} were read.`;
  }
  if (!haveCoordinates) {
    confident = false;
    reason = reason ?? 'Some players have no position on the graphic, so the order they were listed in was used.';
  }
  if (!edge && haveCoordinates === false) confident = false;

  let ordered: number[];
  if (haveCoordinates && edge) {
    // Back to front by depth, then chunk into formation lines, left→right inside each.
    const byDepth = [...outfield].sort((a, b) => (team[a] as Point).x - (team[b] as Point).x);
    ordered = [];
    let at = 0;
    for (const size of sizes) {
      const line = byDepth.slice(at, at + size).sort((a, b) => (team[a] as Point).y - (team[b] as Point).y);
      ordered.push(...line);
      at += size;
    }
    ordered.push(...byDepth.slice(at)); // surplus (when too many were read)
  } else {
    ordered = outfield; // listed order
  }

  const flatSlots = templateLines.flat();
  ordered.forEach((playerIndex, i) => {
    result[playerIndex] = i < flatSlots.length ? flatSlots[i] : null;
  });
  if (ordered.length > flatSlots.length) {
    confident = false;
    reason = reason ?? 'More than 11 starters were read.';
  }
  return { slots: result, confident, reason };
}
