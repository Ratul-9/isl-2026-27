import { describe, expect, it } from 'vitest';
import { fullTeam } from './fixtures';
import { FORMATIONS, getFormation } from './formations';
import { fromTeamFrame } from './geometry';
import {
  applyTemplate,
  captureLayout,
  isLayoutModified,
  moveSlot,
  pickEmptySlot,
  positionMismatch,
  resetToFormation,
  resolveTemplate,
} from './layout';
import { getSquadCounts, validateSquadIntegrity } from './squad';
import type { FormationId, Team, TeamSide } from './types';

const preset = (id: FormationId) => ({ kind: 'preset', id }) as const;
const occupants = (t: Team) => t.slots.map((s) => [s.id, s.playerId] as const).sort();
const sides: TeamSide[] = ['home', 'away'];

function apply(team: Team, id: FormationId, side: TeamSide) {
  return applyTemplate(team, getFormation(id).slots, side, preset(id));
}

describe('applyTemplate (formation switching)', () => {
  it.each(sides)('moves %s slots exactly onto the formation coordinates', (side) => {
    for (const f of FORMATIONS) {
      const team = apply(fullTeam(side), f.id, side);
      const expected = f.slots.map((t) => fromTeamFrame(t, side)).map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`).sort();
      const actual = team.slots.map((s) => `${s.x.toFixed(6)},${s.y.toFixed(6)}`).sort();
      expect(actual).toEqual(expected);
      expect(team.formation).toEqual(preset(f.id));
      // Position labels come from the formation.
      expect(team.slots.map((s) => s.position).sort()).toEqual(f.slots.map((s) => s.position).sort());
    }
  });

  it('never changes slot ids, occupants or starting-XI membership across every formation pair', () => {
    for (const side of sides) {
      const original = fullTeam(side);
      for (const a of FORMATIONS) {
        for (const b of FORMATIONS) {
          const team = apply(apply(original, a.id, side), b.id, side);
          expect(occupants(team)).toEqual(occupants(original));
          expect(team.bench).toEqual(original.bench);
          expect(getSquadCounts(team)).toEqual(getSquadCounts(original));
          expect(validateSquadIntegrity(team)).toEqual([]);
        }
      }
    }
  });

  it('keeps the goalkeeper in the GK slot and full backs on their own flank', () => {
    for (const side of sides) {
      for (const f of FORMATIONS) {
        const team = apply(fullTeam(side), f.id, side);
        const slotOf = (pid: string) => team.slots.find((s) => s.playerId === pid)!;
        expect(slotOf(`${side}-p0`).position).toBe('GK');
        // Left back (p1) stays on the team's left; right back (p4) on the right.
        const leftY = fromTeamFrame(slotOf(`${side}-p1`), side).y;
        const rightY = fromTeamFrame(slotOf(`${side}-p4`), side).y;
        expect(leftY).toBeLessThan(0.5);
        expect(rightY).toBeGreaterThan(0.5);
      }
    }
  });

  it('maps a 4-3-3 left back to the left wing-back in a back three', () => {
    const team = apply(apply(fullTeam(), '4-3-3', 'home'), '3-5-2', 'home');
    expect(team.slots.find((s) => s.playerId === 'home-p1')?.position).toBe('LWB');
  });

  it('places an incomplete XI and leaves unfilled slots empty', () => {
    const team = apply(fullTeam('home', 7, 0), '4-4-2', 'home');
    expect(team.slots.filter((s) => s.playerId).length).toBe(7);
    expect(team.slots).toHaveLength(11);
    expect(validateSquadIntegrity(team)).toEqual([]);
  });

  it('is a no-op for a malformed template', () => {
    const team = fullTeam();
    expect(applyTemplate(team, getFormation('4-3-3').slots.slice(0, 10), 'home', preset('4-3-3'))).toBe(team);
  });
});

describe('reset, modification and moving', () => {
  it('detects a dragged player and restores formation defaults on reset', () => {
    const team = fullTeam();
    expect(isLayoutModified(team, 'home', [])).toBe(false);
    const slot = team.slots.find((s) => s.playerId === 'home-p9')!;
    const dragged = moveSlot(team, slot.id, { x: 0.8, y: 0.2 });
    expect(dragged.slots.find((s) => s.id === slot.id)).toMatchObject({ x: 0.8, y: 0.2, playerId: 'home-p9' });
    expect(isLayoutModified(dragged, 'home', [])).toBe(true);

    const reset = resetToFormation(dragged, 'home', []);
    expect(isLayoutModified(reset, 'home', [])).toBe(false);
    expect(reset.slots.find((s) => s.id === slot.id)).toMatchObject({ x: slot.x, y: slot.y });
    expect(occupants(reset)).toEqual(occupants(team));
  });

  it('treats a manual position-label override as a modification', () => {
    const team = fullTeam();
    const slot = team.slots.find((s) => s.position === 'ST')!;
    const relabelled = { ...team, slots: team.slots.map((s) => (s.id === slot.id ? { ...s, position: 'CF' as const } : s)) };
    expect(isLayoutModified(relabelled, 'home', [])).toBe(true);
  });

  it('clamps moves to the pitch and ignores unknown slots', () => {
    const team = fullTeam();
    const id = team.slots[3].id;
    expect(moveSlot(team, id, { x: 1.4, y: -0.2 }).slots[3]).toMatchObject({ x: 1, y: 0 });
    expect(moveSlot(team, 'nope', { x: 0.5, y: 0.5 })).toBe(team);
  });
});

describe('saved layouts', () => {
  it.each(sides)('round-trips a captured %s arrangement through the team frame', (side) => {
    const original = fullTeam(side);
    const dragged = moveSlot(original, original.slots[5].id, side === 'home' ? { x: 0.42, y: 0.33 } : { x: 0.58, y: 0.67 });
    const captured = captureLayout(dragged, side);
    // Applying the captured layout to a reset team reproduces the arrangement.
    const reapplied = applyTemplate(resetToFormation(dragged, side, []), captured, side, { kind: 'saved', id: 'L' });
    for (const s of dragged.slots) {
      const r = reapplied.slots.find((x) => x.id === s.id)!;
      expect(r.x).toBeCloseTo(s.x, 9);
      expect(r.y).toBeCloseTo(s.y, 9);
    }
  });

  it('applies a layout saved by one team to the other team, mirrored', () => {
    const home = moveSlot(fullTeam('home'), fullTeam('home').slots[9].id, { x: 0.47, y: 0.2 });
    const captured = captureLayout(home, 'home');
    const away = applyTemplate(fullTeam('away'), captured, 'away', { kind: 'saved', id: 'L' });
    const xs = away.slots.map((s) => s.x);
    expect(Math.min(...xs)).toBeGreaterThan(0.5);
    expect(away.slots.some((s) => Math.abs(s.x - 0.53) < 1e-9 && Math.abs(s.y - 0.8) < 1e-9)).toBe(true);
  });

  it('resolves presets and saved layouts, and returns null for a deleted layout', () => {
    expect(resolveTemplate(preset('5-4-1'), [])).toBe(getFormation('5-4-1').slots);
    const layout = { id: 'L', name: 'Mine', baseFormation: '4-3-3' as const, slots: captureLayout(fullTeam(), 'home') };
    expect(resolveTemplate({ kind: 'saved', id: 'L' }, [layout])).toBe(layout.slots);
    expect(resolveTemplate({ kind: 'saved', id: 'gone' }, [layout])).toBeNull();
  });
});

describe('slot choice helpers', () => {
  it('ranks positions sensibly', () => {
    expect(positionMismatch('LB', 'LB')).toBe(0);
    expect(positionMismatch('LB', 'LWB')).toBeLessThan(positionMismatch('LB', 'CB'));
    expect(positionMismatch('LB', 'CB')).toBeLessThan(positionMismatch('LB', 'ST'));
    expect(positionMismatch('ST', 'GK')).toBeGreaterThan(50);
  });

  it('returns null when every slot is filled', () => {
    expect(pickEmptySlot(fullTeam().slots, 'CM')).toBeNull();
  });
});
