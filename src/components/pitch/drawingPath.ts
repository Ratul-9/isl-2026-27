import {
  drawingPolylineMetres,
  labelAnchorMetres,
  loftedControl,
  quadTrimParameter,
  subQuad,
} from '@/domain/drawings';
import { metresToView, shortenSegment, toMetres, toView } from '@/domain/geometry';
import type { Orientation } from '@/domain/geometry';
import type { Drawing, Point } from '@/domain/types';
import { MARKER_RADIUS } from './pitchTheme';

/** Gap left between an arrow and a player marker it starts/ends on (view units = metres). */
export const START_INSET = MARKER_RADIUS + 0.3;
export const END_INSET = MARKER_RADIUS + 0.6;

export interface DrawingGeometry {
  /** SVG path data in view units. */
  path: string;
  /** Where the LD badge / note label sits, in view units. */
  label: Point;
}

const fmt = (n: number) => Number(n.toFixed(3));
const pt = (p: Point) => `${fmt(p.x)} ${fmt(p.y)}`;

/**
 * SVG geometry for a drawing in the given orientation. Arrows that start or
 * end on a player are trimmed so the arrowhead stays visible next to the
 * marker; lofted passes are a quadratic curve trimmed along the curve itself.
 */
export function drawingGeometry(d: Drawing, orientation: Orientation): DrawingGeometry {
  const label = metresToView(labelAnchorMetres(d), orientation);
  const startInset = d.fromPlayerId ? START_INSET : 0;
  const endInset = d.toPlayerId ? END_INSET : 0;

  if (d.kind === 'freehand') {
    const points = drawingPolylineMetres(d).map((m) => metresToView(m, orientation));
    return { path: `M ${points.map(pt).join(' L ')}`, label };
  }

  if (d.kind === 'lofted') {
    // The view is a rotation of metre space, so the control point maps exactly.
    const a = toMetres(d.from);
    const b = toMetres(d.to);
    const [p0, c, p1] = [a, loftedControl(a, b), b].map((m) => metresToView(m, orientation));
    const t0 = quadTrimParameter(p0, c, p1, startInset);
    const t1 = quadTrimParameter(p0, c, p1, endInset, true);
    const [s, k, e] = t1 > t0 ? subQuad(p0, c, p1, t0, t1) : [p0, c, p1];
    return { path: `M ${pt(s)} Q ${pt(k)} ${pt(e)}`, label };
  }

  const [from, to] = shortenSegment(toView(d.from, orientation), toView(d.to, orientation), startInset, endInset);
  return { path: `M ${pt(from)} L ${pt(to)}`, label };
}
