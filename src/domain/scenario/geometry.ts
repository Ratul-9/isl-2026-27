import { PITCH_LENGTH, PITCH_WIDTH } from '../geometry';
import type { ReplayPoint } from '../types';

/**
 * Pure helpers for scenario highlights. Positions are replay units (0–100 per
 * axis); the pitch is not isotropic, so every distance goes through metres.
 */

const M_PER_X = PITCH_LENGTH / 100;
const M_PER_Y = PITCH_WIDTH / 100;

type P = ReplayPoint;

export function toMetres(p: P): P {
  return { x: p.x * M_PER_X, y: p.y * M_PER_Y };
}

function fromMetres(p: P): P {
  return { x: p.x / M_PER_X, y: p.y / M_PER_Y };
}

export function distanceM(a: P, b: P): number {
  const dx = (a.x - b.x) * M_PER_X;
  const dy = (a.y - b.y) * M_PER_Y;
  return Math.hypot(dx, dy);
}

/** Shortest distance (metres) from `p` to the segment a→b. */
export function distanceToSegmentM(p: P, a: P, b: P): number {
  const A = toMetres(a);
  const B = toMetres(b);
  const Q = toMetres(p);
  const vx = B.x - A.x;
  const vy = B.y - A.y;
  const len2 = vx * vx + vy * vy;
  const s = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((Q.x - A.x) * vx + (Q.y - A.y) * vy) / len2));
  return Math.hypot(Q.x - (A.x + s * vx), Q.y - (A.y + s * vy));
}

export function lerp(a: P, b: P, s: number): P {
  return { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s };
}

export function rect(x0: number, x1: number, y0: number, y1: number): P[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/** A strip of half-width `halfWidthM` along a→b. */
export function corridor(a: P, b: P, halfWidthM: number): P[] {
  const A = toMetres(a);
  const B = toMetres(b);
  const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
  const nx = (-(B.y - A.y) / len) * halfWidthM;
  const ny = ((B.x - A.x) / len) * halfWidthM;
  return [
    { x: A.x + nx, y: A.y + ny },
    { x: B.x + nx, y: B.y + ny },
    { x: B.x - nx, y: B.y - ny },
    { x: A.x - nx, y: A.y - ny },
  ].map(fromMetres);
}

export function ellipse(centre: P, rxM: number, ryM: number, steps = 20): P[] {
  const c = toMetres(centre);
  return Array.from({ length: steps }, (_, i) => {
    const a = (i / steps) * Math.PI * 2;
    return fromMetres({ x: c.x + Math.cos(a) * rxM, y: c.y + Math.sin(a) * ryM });
  });
}

export function pointInPolygon(p: P, polygon: readonly P[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function centroid(polygon: readonly P[]): P {
  const n = polygon.length || 1;
  return { x: polygon.reduce((s, p) => s + p.x, 0) / n, y: polygon.reduce((s, p) => s + p.y, 0) / n };
}

export const clampUnit = (n: number) => Math.min(100, Math.max(0, n));

/**
 * Picks a label spot inside each shape that is as far as possible from every
 * player/ball and from labels already placed (shapes are placed in order, so
 * list the most important first). Falls back to the centroid.
 */
export function placeLabels(shapes: readonly { id: string; points: readonly P[] }[], obstacles: readonly P[]): Record<string, P> {
  const placed: P[] = [];
  const out: Record<string, P> = {};
  for (const shape of shapes) {
    const c = centroid(shape.points);
    const xs = shape.points.map((p) => p.x);
    const ys = shape.points.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const candidates: P[] = [c];
    // Small shapes (a player's pocket) cannot hold a label clear of the player: also try just outside them.
    const above = (y0 * M_PER_Y - 2.2) / M_PER_Y;
    const below = (y1 * M_PER_Y + 2.2) / M_PER_Y;
    candidates.push({ x: c.x, y: above }, { x: c.x, y: below });
    for (let i = 0; i <= 8; i++) {
      for (let j = 0; j <= 6; j++) {
        const p = { x: x0 + ((x1 - x0) * i) / 8, y: y0 + ((y1 - y0) * j) / 6 };
        if (pointInPolygon(p, shape.points)) candidates.push(p);
      }
    }
    let best = c;
    let bestScore = -Infinity;
    for (const cand of candidates) {
      const others = [...obstacles, ...placed.map((p) => ({ x: p.x, y: p.y }))];
      const clearance = others.length === 0 ? 99 : Math.min(...others.map((o) => distanceM(cand, o)));
      // Prefer room, then the middle of the shape.
      const outside = pointInPolygon(cand, shape.points) ? 0 : 0.8;
      const score = Math.min(clearance, 9) - distanceM(cand, c) * 0.05 - outside;
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    out[shape.id] = best;
    placed.push(best);
  }
  return out;
}
