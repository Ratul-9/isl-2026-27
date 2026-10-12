import type { Point, TeamSide } from './types';

/**
 * Pitch geometry.
 *
 * Canonical frame (stored data): `x` along the length, 0 = left goal line,
 * 1 = right goal line; `y` across the width, 0 = top touchline, 1 = bottom.
 * Both are normalised 0–1, so the frame is NOT isotropic: convert to metres
 * before measuring distances or angles.
 *
 * Team frame (formation/pattern templates): `x` 0 = own goal line, 1 = the
 * goal being attacked; `y` 0 = the team's left touchline. The home team
 * attacks toward canonical x = 1, so its team frame equals the canonical
 * frame. The away team's frame is rotated 180° (x → 1 − x, y → 1 − y), which
 * keeps its left-sided players on its own left.
 *
 * View frame (rendering): SVG user units in metres. Landscape draws the length
 * horizontally; portrait draws it vertically with the home goal at the bottom.
 */

export const PITCH_LENGTH = 105;
export const PITCH_WIDTH = 68;
/** Space around the pitch inside the SVG viewBox (goals sit 2 m outside the lines). */
const VIEW_MARGIN = 4;

export type Orientation = 'landscape' | 'portrait';

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function clampPoint(p: Point): Point {
  return { x: clamp01(p.x), y: clamp01(p.y) };
}

export function isInBounds(p: Point): boolean {
  return p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
}

export function toMetres(p: Point): Point {
  return { x: p.x * PITCH_LENGTH, y: p.y * PITCH_WIDTH };
}

export function fromMetres(m: Point): Point {
  return { x: m.x / PITCH_LENGTH, y: m.y / PITCH_WIDTH };
}

/** Real-world distance in metres between two normalised points. */
export function distanceMetres(a: Point, b: Point): number {
  const dx = (a.x - b.x) * PITCH_LENGTH;
  const dy = (a.y - b.y) * PITCH_WIDTH;
  return Math.hypot(dx, dy);
}

/** Team frame → canonical frame. The transform is its own inverse. */
export function fromTeamFrame(p: Point, side: TeamSide): Point {
  return side === 'home' ? { x: p.x, y: p.y } : { x: 1 - p.x, y: 1 - p.y };
}

/** Canonical frame → team frame. */
export function toTeamFrame(p: Point, side: TeamSide): Point {
  return fromTeamFrame(p, side);
}

export function viewBoxFor(orientation: Orientation): ViewBox {
  const [w, h] = orientation === 'landscape' ? [PITCH_LENGTH, PITCH_WIDTH] : [PITCH_WIDTH, PITCH_LENGTH];
  return { x: -VIEW_MARGIN, y: -VIEW_MARGIN, width: w + VIEW_MARGIN * 2, height: h + VIEW_MARGIN * 2 };
}

/** Canonical normalised point → SVG view coordinates (metres). */
export function toView(p: Point, orientation: Orientation): Point {
  if (orientation === 'landscape') return { x: p.x * PITCH_LENGTH, y: p.y * PITCH_WIDTH };
  // Portrait: home goal (x = 0) at the bottom, home's left (y = 0) on the left.
  return { x: p.y * PITCH_WIDTH, y: (1 - p.x) * PITCH_LENGTH };
}

/** SVG view coordinates (metres) → canonical normalised point (unclamped). */
export function fromView(v: Point, orientation: Orientation): Point {
  if (orientation === 'landscape') return { x: v.x / PITCH_LENGTH, y: v.y / PITCH_WIDTH };
  return { x: 1 - v.y / PITCH_LENGTH, y: v.x / PITCH_WIDTH };
}

/**
 * SVG `transform` that draws landscape-metre artwork (the pitch markings) in
 * the given orientation. Matches `toView`.
 */
export function markingsTransform(orientation: Orientation): string | undefined {
  return orientation === 'landscape' ? undefined : `translate(0 ${PITCH_LENGTH}) rotate(-90)`;
}

export interface ClientRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Maps a client (screen) point to SVG user units for an <svg> rendered with
 * the default `preserveAspectRatio="xMidYMid meet"`. Pure, so resize and
 * letterboxing behaviour is unit-testable without a browser.
 */
export function clientToViewBox(client: Point, rect: ClientRectLike, vb: ViewBox): Point | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const scale = Math.min(rect.width / vb.width, rect.height / vb.height);
  const offsetX = rect.left + (rect.width - vb.width * scale) / 2;
  const offsetY = rect.top + (rect.height - vb.height * scale) / 2;
  return {
    x: vb.x + (client.x - offsetX) / scale,
    y: vb.y + (client.y - offsetY) / scale,
  };
}

/** Client point → clamped canonical pitch point, or null if the element has no size. */
export function clientToPitch(
  client: Point,
  rect: ClientRectLike,
  orientation: Orientation,
): Point | null {
  const v = clientToViewBox(client, rect, viewBoxFor(orientation));
  return v ? clampPoint(fromView(v, orientation)) : null;
}

/** Grid used by the optional snap: 2.5 m along the length, ~2.8 m across. */
const SNAP_COLUMNS = 42;
const SNAP_ROWS = 24;

export function snapPoint(p: Point): Point {
  return clampPoint({
    x: Math.round(p.x * SNAP_COLUMNS) / SNAP_COLUMNS,
    y: Math.round(p.y * SNAP_ROWS) / SNAP_ROWS,
  });
}

export type Direction = 'up' | 'down' | 'left' | 'right';

/**
 * Moves a point by `metres` in a direction *as seen on screen*, so arrow keys
 * behave the same in landscape and portrait.
 */
export function nudge(p: Point, direction: Direction, metres: number, orientation: Orientation): Point {
  const v = toView(p, orientation);
  const moved = {
    x: v.x + (direction === 'right' ? metres : direction === 'left' ? -metres : 0),
    y: v.y + (direction === 'down' ? metres : direction === 'up' ? -metres : 0),
  };
  return clampPoint(fromView(moved, orientation));
}

export function pointsEqual(a: Point, b: Point, epsilon = 1e-6): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
}

/**
 * Trims a segment (in view units) by `startInset` and `endInset`, so arrows
 * start/end at a marker's edge instead of its centre. Segments too short to
 * trim keep at least 10% of their length.
 */
export function shortenSegment(from: Point, to: Point, startInset: number, endInset: number): [Point, Point] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return [from, to];
  const maxTrim = length * 0.9;
  const scale = Math.min(1, maxTrim / Math.max(startInset + endInset, 1e-9));
  const s = (startInset * scale) / length;
  const e = (endInset * scale) / length;
  return [
    { x: from.x + dx * s, y: from.y + dy * s },
    { x: to.x - dx * e, y: to.y - dy * e },
  ];
}

/** Canonical metres → SVG view coordinates. The view is a rotation of metre space. */
export function metresToView(m: Point, orientation: Orientation): Point {
  return toView(fromMetres(m), orientation);
}
