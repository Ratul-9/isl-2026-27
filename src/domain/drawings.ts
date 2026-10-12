import { clamp01, distanceMetres, isInBounds, toMetres } from './geometry';
import type { Drawing, DrawingKind, Point } from './types';

/**
 * Tactical drawing geometry and validation. Pure.
 *
 * Geometry that must look the same in both orientations (lofted curves, hit
 * testing) is computed in canonical METRES (x along 105 m, y across 68 m).
 * The view transforms are rotations of that space, so a curve bulging to the
 * left of its direction keeps doing so in portrait.
 */

export const DRAWING_KINDS: readonly DrawingKind[] = ['pass', 'lofted', 'shot', 'movement', 'freehand'];

export const DRAWING_LABELS: Record<DrawingKind, string> = {
  pass: 'Pass',
  lofted: 'Lofted pass',
  shot: 'Shot',
  movement: 'Movement',
  freehand: 'Freehand',
};

/** Kinds drawn as a single arrow (everything but freehand). */
export type ArrowKind = Exclude<DrawingKind, 'freehand'>;
export const ARROW_KINDS: readonly ArrowKind[] = ['pass', 'lofted', 'shot', 'movement'];

function isDrawingKind(value: unknown): value is DrawingKind {
  return typeof value === 'string' && (DRAWING_KINDS as readonly string[]).includes(value);
}

export function isArrowKind(kind: DrawingKind): kind is ArrowKind {
  return kind !== 'freehand';
}

/** Shorter gestures are treated as clicks, not arrows. */
export const MIN_ARROW_METRES = 1.5;
const MIN_FREEHAND_METRES = 1;
/** Freehand samples closer than this are dropped. */
const FREEHAND_SPACING_METRES = 0.6;
export const MAX_FREEHAND_POINTS = 400;
export const MAX_NOTE_LENGTH = 60;
/** Lofted-pass bulge as a fraction of its length. */
const LOFT_BULGE = 0.18;

// --- curves -----------------------------------------------------------------

/** Quadratic Bézier control point for a lofted pass, bulging left of travel. */
export function loftedControl(fromM: Point, toM: Point): Point {
  const dx = toM.x - fromM.x;
  const dy = toM.y - fromM.y;
  const mx = (fromM.x + toM.x) / 2;
  const my = (fromM.y + toM.y) / 2;
  // Left-hand normal of (dx, dy) in a y-down frame is (dy, -dx).
  return { x: mx + dy * LOFT_BULGE, y: my - dx * LOFT_BULGE };
}

export function quadPoint(p0: Point, c: Point, p1: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
  };
}

/** The portion of a quadratic Bézier between t0 and t1, as a new quadratic. */
export function subQuad(p0: Point, c: Point, p1: Point, t0: number, t1: number): [Point, Point, Point] {
  const start = quadPoint(p0, c, p1, t0);
  const end = quadPoint(p0, c, p1, t1);
  // Control point of the sub-curve: tangent at t0 extended by (t1 - t0).
  const tangent = (t: number) => ({
    x: 2 * (1 - t) * (c.x - p0.x) + 2 * t * (p1.x - c.x),
    y: 2 * (1 - t) * (c.y - p0.y) + 2 * t * (p1.y - c.y),
  });
  const d = tangent(t0);
  const k = (t1 - t0) / 2;
  return [start, { x: start.x + d.x * k, y: start.y + d.y * k }, end];
}

/** Parameter t at which the curve is `distance` away from its start (or end when `fromEnd`). */
export function quadTrimParameter(p0: Point, c: Point, p1: Point, distance: number, fromEnd = false): number {
  if (distance <= 0) return fromEnd ? 1 : 0;
  const anchor = fromEnd ? p1 : p0;
  const steps = 64;
  for (let i = 1; i <= steps; i++) {
    const t = fromEnd ? 1 - i / steps : i / steps;
    const p = quadPoint(p0, c, p1, t);
    if (Math.hypot(p.x - anchor.x, p.y - anchor.y) >= distance) return t;
  }
  return 0.5;
}

// --- shapes in metres ---------------------------------------------------------

/** The drawing's shape as a polyline in canonical metres (curves sampled). */
export function drawingPolylineMetres(d: Drawing, samples = 24): Point[] {
  if (d.kind === 'freehand') return (d.points ?? [d.from, d.to]).map(toMetres);
  const a = toMetres(d.from);
  const b = toMetres(d.to);
  if (d.kind !== 'lofted') return [a, b];
  const c = loftedControl(a, b);
  return Array.from({ length: samples + 1 }, (_, i) => quadPoint(a, c, b, i / samples));
}

/** Where to anchor a label (LD badge, note): the visual middle of the drawing, in metres. */
export function labelAnchorMetres(d: Drawing): Point {
  const line = drawingPolylineMetres(d);
  if (d.kind === 'lofted') return line[Math.floor(line.length / 2)];
  if (d.kind === 'freehand') return line[Math.floor(line.length / 2)];
  return { x: (line[0].x + line[1].x) / 2, y: (line[0].y + line[1].y) / 2 };
}

function polylineLengthMetres(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

// --- hit testing --------------------------------------------------------------

/** Distance from p to segment ab, all in the same (isotropic) units. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance in metres from a canonical point to a drawing. */
export function distanceToDrawingMetres(d: Drawing, point: Point): number {
  const p = toMetres(point);
  const line = drawingPolylineMetres(d);
  if (line.length === 1) return Math.hypot(p.x - line[0].x, p.y - line[0].y);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, distanceToSegment(p, line[i - 1], line[i]));
  return best;
}

/**
 * The drawing under a point within `toleranceMetres`, nearest first; on a tie
 * the one drawn last (on top) wins. Null when nothing is close enough.
 */
export function hitTestDrawings(
  drawings: readonly Drawing[],
  point: Point,
  toleranceMetres: number,
): Drawing | null {
  let best: Drawing | null = null;
  let bestDistance = Infinity;
  for (const d of drawings) {
    const distance = distanceToDrawingMetres(d, point);
    if (distance <= toleranceMetres && distance <= bestDistance) {
      best = d;
      bestDistance = distance;
    }
  }
  return best;
}

// --- editing ------------------------------------------------------------------

/**
 * Moves a whole drawing by `delta` (canonical units). The delta is limited so
 * every point stays on the pitch, keeping the shape intact.
 */
export function translateDrawing(d: Drawing, delta: Point): Drawing {
  const pts = d.points ?? [d.from, d.to];
  const all = [...pts, d.from, d.to];
  const minX = Math.min(...all.map((p) => p.x));
  const maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y));
  const maxY = Math.max(...all.map((p) => p.y));
  const dx = Math.min(Math.max(delta.x, -minX), 1 - maxX);
  const dy = Math.min(Math.max(delta.y, -minY), 1 - maxY);
  const move = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
  const next: Drawing = { ...d, from: move(d.from), to: move(d.to) };
  if (d.points) next.points = d.points.map(move);
  // A moved arrow no longer starts/ends at a player.
  delete next.fromPlayerId;
  delete next.toPlayerId;
  return next;
}

/** Swaps the direction of travel. */
export function reverseDrawing(d: Drawing): Drawing {
  const next: Drawing = { ...d, from: d.to, to: d.from };
  if (d.points) next.points = [...d.points].reverse();
  delete next.fromPlayerId;
  delete next.toPlayerId;
  if (d.toPlayerId) next.fromPlayerId = d.toPlayerId;
  if (d.fromPlayerId) next.toPlayerId = d.fromPlayerId;
  return next;
}

/** Appends a freehand sample if it is far enough from the previous one. */
export function appendFreehandPoint(points: readonly Point[], p: Point): Point[] {
  const last = points[points.length - 1];
  if (points.length >= MAX_FREEHAND_POINTS) return [...points];
  if (last && distanceMetres(last, p) < FREEHAND_SPACING_METRES) return [...points];
  return [...points, p];
}

const clampP = (p: Point): Point => ({ x: clamp01(p.x), y: clamp01(p.y) });
const finite = (p: Point | undefined): p is Point =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

/**
 * Normalises a drawing for storage: valid kind, clamped coordinates, freehand
 * endpoints derived from its points, empty optional fields removed, notes
 * trimmed/limited. Returns null if it is too small or malformed to keep.
 */
export function sanitizeDrawing(d: Drawing): Drawing | null {
  if (!isDrawingKind(d.kind) || !d.id) return null;
  const out: Drawing = { id: d.id, kind: d.kind, from: d.from, to: d.to };

  if (d.kind === 'freehand') {
    const points = (d.points ?? []).filter(finite).map(clampP).slice(0, MAX_FREEHAND_POINTS);
    if (points.length < 2 || polylineLengthMetres(points.map(toMetres)) < MIN_FREEHAND_METRES) return null;
    out.points = points;
    out.from = points[0];
    out.to = points[points.length - 1];
  } else {
    if (!finite(d.from) || !finite(d.to)) return null;
    out.from = clampP(d.from);
    out.to = clampP(d.to);
    if (distanceMetres(out.from, out.to) < MIN_ARROW_METRES) return null;
    if (d.fromPlayerId) out.fromPlayerId = d.fromPlayerId;
    if (d.toPlayerId) out.toPlayerId = d.toPlayerId;
  }

  const note = d.note?.trim().slice(0, MAX_NOTE_LENGTH);
  if (note) out.note = note;
  if (d.source) out.source = d.source;
  return out;
}

export function isDrawingInBounds(d: Drawing): boolean {
  return [d.from, d.to, ...(d.points ?? [])].every(isInBounds);
}
