import { describe, expect, it } from 'vitest';
import { FORMATIONS, getFormation, isFormationId } from './formations';
import { isPositionCode } from './positions';

const REQUIRED = ['4-3-3', '4-2-3-1', '4-4-2', '4-1-4-1', '4-3-2-1', '3-5-2', '3-4-3', '3-4-2-1', '5-3-2', '5-4-1'];

describe('formation presets', () => {
  it('includes every required formation', () => {
    expect(FORMATIONS.map((f) => f.id).sort()).toEqual([...REQUIRED].sort());
    for (const id of REQUIRED) expect(isFormationId(id)).toBe(true);
  });

  it.each(FORMATIONS.map((f) => [f.id, f] as const))('%s has 11 valid slots and one goalkeeper', (id, f) => {
    expect(f.slots).toHaveLength(11);
    expect(f.slots.filter((s) => s.position === 'GK')).toHaveLength(1);
    expect(f.slots.every((s) => isPositionCode(s.position))).toBe(true);
    // Outfield count matches the name: 4-2-3-1 → 10 outfield players.
    expect(id.split('-').map(Number).reduce((a, b) => a + b, 0)).toBe(10);
  });

  it.each(FORMATIONS.map((f) => [f.id, f] as const))('%s sits in its own half with no overlapping players', (_id, f) => {
    for (const s of f.slots) {
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(0.5);
      expect(s.y).toBeGreaterThan(0);
      expect(s.y).toBeLessThan(1);
    }
    const keys = new Set(f.slots.map((s) => `${s.x.toFixed(3)},${s.y.toFixed(3)}`));
    expect(keys.size).toBe(11);
  });

  it.each(FORMATIONS.map((f) => [f.id, f] as const))('%s has its lines in the stated order', (id, f) => {
    // The number of players in the deepest outfield line equals the first digit.
    const outfield = f.slots.filter((s) => s.position !== 'GK');
    const minX = Math.min(...outfield.map((s) => s.x));
    // Wing-backs in a back five are staggered slightly higher, hence 0.06.
    const backLine = outfield.filter((s) => s.x - minX < 0.06);
    expect(backLine).toHaveLength(Number(id.split('-')[0]));
    // The most advanced line's size equals the last digit.
    const maxX = Math.max(...outfield.map((s) => s.x));
    const front = outfield.filter((s) => maxX - s.x < 0.025);
    expect(front).toHaveLength(Number(id.split('-').at(-1)));
  });

  it('is symmetric left/right', () => {
    for (const f of FORMATIONS) {
      const ys = f.slots.map((s) => s.y);
      const mirrored = ys.map((y) => 1 - y).sort();
      expect(mirrored.map((y) => y.toFixed(3))).toEqual([...ys].sort().map((y) => y.toFixed(3)));
    }
  });

  it('throws for an unknown id', () => {
    // @ts-expect-error deliberately invalid
    expect(() => getFormation('2-3-5')).toThrow();
  });
});
