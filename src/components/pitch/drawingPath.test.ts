import { describe, expect, it } from 'vitest';
import { fromMetres } from '@/domain/geometry';
import type { Drawing } from '@/domain/types';
import { drawingGeometry, END_INSET, START_INSET } from './drawingPath';

const base: Drawing = { id: 'd', kind: 'pass', from: fromMetres({ x: 20, y: 34 }), to: fromMetres({ x: 50, y: 34 }) };
const nums = (path: string) => path.match(/-?\d+(\.\d+)?/g)!.map(Number);

describe('drawingGeometry', () => {
  it('draws straight arrows in metres and trims at player markers', () => {
    expect(nums(drawingGeometry(base, 'landscape').path)).toEqual([20, 34, 50, 34]);
    const attached = drawingGeometry({ ...base, fromPlayerId: 'a', toPlayerId: 'b' }, 'landscape');
    const [x1, , x2] = nums(attached.path);
    expect(x1).toBeCloseTo(20 + START_INSET, 2);
    expect(x2).toBeCloseTo(50 - END_INSET, 2);
  });

  it('rotates with the board in portrait', () => {
    // Portrait: view = (y_m, 105 - x_m).
    expect(nums(drawingGeometry(base, 'portrait').path)).toEqual([34, 85, 34, 55]);
  });

  it('draws lofted passes as a quadratic curve with the label at its apex', () => {
    const g = drawingGeometry({ ...base, kind: 'lofted' }, 'landscape');
    expect(g.path).toMatch(/^M [\d.]+ [\d.]+ Q /);
    expect(g.label.x).toBeCloseTo(35, 3);
    expect(g.label.y).toBeLessThan(34);
  });

  it('keeps the lofted bulge on the same side of travel in portrait', () => {
    const land = drawingGeometry({ ...base, kind: 'lofted' }, 'landscape').label;
    const port = drawingGeometry({ ...base, kind: 'lofted' }, 'portrait').label;
    // Landscape bulge is toward smaller y (metres); portrait maps y_m → view x.
    expect(port.x).toBeCloseTo(land.y, 6);
  });

  it('draws freehand as a polyline', () => {
    const f: Drawing = {
      id: 'f',
      kind: 'freehand',
      from: fromMetres({ x: 10, y: 10 }),
      to: fromMetres({ x: 30, y: 10 }),
      points: [fromMetres({ x: 10, y: 10 }), fromMetres({ x: 20, y: 20 }), fromMetres({ x: 30, y: 10 })],
    };
    expect(drawingGeometry(f, 'landscape').path).toBe('M 10 10 L 20 20 L 30 10');
  });
});
