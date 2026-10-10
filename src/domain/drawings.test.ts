import { describe, expect, it } from 'vitest';
import {
  appendFreehandPoint,
  distanceToDrawingMetres,
  distanceToSegment,
  drawingPolylineMetres,
  hitTestDrawings,
  isDrawingInBounds,
  labelAnchorMetres,
  loftedControl,
  MAX_NOTE_LENGTH,
  quadPoint,
  quadTrimParameter,
  reverseDrawing,
  sanitizeDrawing,
  subQuad,
  translateDrawing,
} from './drawings';
import { distanceMetres, fromMetres, toMetres } from './geometry';
import type { Drawing } from './types';

const arrow = (over: Partial<Drawing> = {}): Drawing => ({
  id: 'd1',
  kind: 'pass',
  from: fromMetres({ x: 20, y: 34 }),
  to: fromMetres({ x: 50, y: 34 }),
  ...over,
});

describe('segment distance', () => {
  it('measures to the nearest point, clamped to the ends', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distanceToSegment({ x: -4, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distanceToSegment({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(Math.SQRT2);
  });
});

describe('lofted curve', () => {
  it('bulges to the left of the direction of travel by 18% of its length', () => {
    // Travelling +x in a y-down frame: left is -y.
    const c = loftedControl({ x: 0, y: 50 }, { x: 100, y: 50 });
    expect(c).toEqual({ x: 50, y: 50 - 18 });
    // Reversed direction bulges the other way.
    expect(loftedControl({ x: 100, y: 50 }, { x: 0, y: 50 }).y).toBe(50 + 18);
  });

  it('sub-curves follow the original curve exactly', () => {
    const p0 = { x: 0, y: 0 };
    const c = { x: 5, y: -6 };
    const p1 = { x: 10, y: 0 };
    const [a, k, b] = subQuad(p0, c, p1, 0.2, 0.7);
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      const onSub = quadPoint(a, k, b, s);
      const onOrig = quadPoint(p0, c, p1, 0.2 + s * 0.5);
      expect(onSub.x).toBeCloseTo(onOrig.x, 9);
      expect(onSub.y).toBeCloseTo(onOrig.y, 9);
    }
  });

  it('finds trim parameters at a given distance from either end', () => {
    const p0 = { x: 0, y: 0 };
    const c = { x: 10, y: 0 };
    const p1 = { x: 20, y: 0 };
    const t = quadTrimParameter(p0, c, p1, 5);
    expect(quadPoint(p0, c, p1, t).x).toBeGreaterThanOrEqual(5);
    expect(quadPoint(p0, c, p1, t).x).toBeLessThan(5.5);
    const te = quadTrimParameter(p0, c, p1, 5, true);
    expect(quadPoint(p0, c, p1, te).x).toBeLessThanOrEqual(15);
    expect(quadTrimParameter(p0, c, p1, 0)).toBe(0);
  });

  it('places the label anchor at the apex of the curve', () => {
    const lofted = arrow({ kind: 'lofted' });
    const anchor = labelAnchorMetres(lofted);
    expect(anchor.x).toBeCloseTo(35, 6);
    expect(anchor.y).toBeLessThan(34); // bulged upward (left of travel)
    expect(drawingPolylineMetres(lofted).length).toBeGreaterThan(2);
  });
});

describe('hit testing', () => {
  it('hits straight arrows within tolerance only', () => {
    const d = arrow();
    expect(distanceToDrawingMetres(d, fromMetres({ x: 35, y: 35 }))).toBeCloseTo(1, 6);
    expect(hitTestDrawings([d], fromMetres({ x: 35, y: 35 }), 1.5)?.id).toBe('d1');
    expect(hitTestDrawings([d], fromMetres({ x: 35, y: 37 }), 1.5)).toBeNull();
  });

  it('hits the curve of a lofted pass, not its chord', () => {
    const d = arrow({ kind: 'lofted' });
    const apex = labelAnchorMetres(d);
    expect(hitTestDrawings([d], fromMetres(apex), 0.5)?.id).toBe('d1');
    // The straight chord midpoint is ~2.7 m from the curve.
    expect(hitTestDrawings([d], fromMetres({ x: 35, y: 34 }), 0.5)).toBeNull();
  });

  it('hits freehand paths along their samples', () => {
    const d: Drawing = {
      id: 'f',
      kind: 'freehand',
      from: fromMetres({ x: 10, y: 10 }),
      to: fromMetres({ x: 30, y: 10 }),
      points: [fromMetres({ x: 10, y: 10 }), fromMetres({ x: 20, y: 20 }), fromMetres({ x: 30, y: 10 })],
    };
    expect(hitTestDrawings([d], fromMetres({ x: 20, y: 19.5 }), 1)?.id).toBe('f');
    expect(hitTestDrawings([d], fromMetres({ x: 20, y: 10 }), 1)).toBeNull();
  });

  it('prefers the nearest drawing, and the top-most on a tie', () => {
    const a = arrow({ id: 'a' });
    const b = arrow({ id: 'b' });
    const c = arrow({ id: 'c', from: fromMetres({ x: 20, y: 36 }), to: fromMetres({ x: 50, y: 36 }) });
    expect(hitTestDrawings([a, b], fromMetres({ x: 30, y: 34 }), 1)?.id).toBe('b');
    expect(hitTestDrawings([c, a], fromMetres({ x: 30, y: 34.4 }), 3)?.id).toBe('a');
  });
});

describe('editing helpers', () => {
  it('translates the whole drawing, keeping it on the pitch and dropping player hints', () => {
    const d = arrow({ fromPlayerId: 'p1', toPlayerId: 'p2' });
    const moved = translateDrawing(d, { x: 0.1, y: 0 });
    expect(moved.from.x).toBeCloseTo(d.from.x + 0.1);
    expect(moved.fromPlayerId).toBeUndefined();
    expect(moved.toPlayerId).toBeUndefined();
    const pushed = translateDrawing(d, { x: 5, y: -5 });
    expect(isDrawingInBounds(pushed)).toBe(true);
    expect(Math.max(pushed.from.x, pushed.to.x)).toBeCloseTo(1);
    expect(distanceMetres(pushed.from, pushed.to)).toBeCloseTo(30, 6); // shape intact
  });

  it('reverses direction and swaps player hints', () => {
    const r = reverseDrawing(arrow({ fromPlayerId: 'p1' }));
    expect(toMetres(r.from).x).toBeCloseTo(50);
    expect(r.toPlayerId).toBe('p1');
    expect(r.fromPlayerId).toBeUndefined();
  });

  it('samples freehand points no closer than the spacing', () => {
    let pts = appendFreehandPoint([], fromMetres({ x: 10, y: 10 }));
    pts = appendFreehandPoint(pts, fromMetres({ x: 10.2, y: 10 }));
    expect(pts).toHaveLength(1);
    pts = appendFreehandPoint(pts, fromMetres({ x: 11, y: 10 }));
    expect(pts).toHaveLength(2);
  });
});

describe('sanitizeDrawing', () => {
  it('clamps coordinates and keeps optional fields only when set', () => {
    const d = sanitizeDrawing(arrow({ to: { x: 1.4, y: -0.2 }, note: '  near post  ', fromPlayerId: undefined }))!;
    expect(d.to).toEqual({ x: 1, y: 0 });
    expect(d.note).toBe('near post');
    expect('fromPlayerId' in d).toBe(false);
  });

  it('rejects too-short arrows, malformed points and unknown kinds', () => {
    expect(sanitizeDrawing(arrow({ to: fromMetres({ x: 20.5, y: 34 }) }))).toBeNull();
    expect(sanitizeDrawing(arrow({ from: { x: Number.NaN, y: 0 } }))).toBeNull();
    // @ts-expect-error deliberately invalid
    expect(sanitizeDrawing(arrow({ kind: 'cross' }))).toBeNull();
  });

  it('derives freehand endpoints from points and requires a minimum length', () => {
    const pts = [fromMetres({ x: 10, y: 10 }), fromMetres({ x: 15, y: 12 })];
    const d = sanitizeDrawing({ id: 'f', kind: 'freehand', from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, points: pts })!;
    expect(d.from).toEqual(pts[0]);
    expect(d.to).toEqual(pts[1]);
    expect(
      sanitizeDrawing({ id: 'f', kind: 'freehand', from: pts[0], to: pts[0], points: [pts[0], pts[0]] }),
    ).toBeNull();
  });

  it('limits note length', () => {
    expect(sanitizeDrawing(arrow({ note: 'x'.repeat(200) }))!.note).toHaveLength(MAX_NOTE_LENGTH);
  });
});
