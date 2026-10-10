import { describe, expect, it } from 'vitest';
import { fullTeam } from './fixtures';
import { FORMATIONS, getFormation } from './formations';
import { isInBounds, toTeamFrame } from './geometry';
import { applyTemplate } from './layout';
import { applyPattern, getPattern, PATTERNS } from './patterns';
import type { PatternId } from './patterns';
import { validateSquadIntegrity } from './squad';
import type { Team, TeamSide } from './types';

const REQUIRED: PatternId[] = [
  'high-press',
  'mid-block',
  'low-block',
  'build-up',
  'overlap',
  'underlap',
  'wide-overload',
  'central-overload',
  'counterattack',
  'counter-press',
  'rotations',
  'set-piece',
];

const sides: TeamSide[] = ['home', 'away'];
const avgOutfieldX = (team: Team, side: TeamSide) => {
  const xs = team.slots.filter((s) => s.position !== 'GK').map((s) => toTeamFrame(s, side).x);
  return xs.reduce((a, b) => a + b, 0) / xs.length;
};

describe('pattern library', () => {
  it('provides all twelve required patterns with names and descriptions', () => {
    expect(PATTERNS.map((p) => p.id)).toEqual(REQUIRED);
    for (const p of PATTERNS) {
      expect(p.name.length).toBeGreaterThan(3);
      expect(p.description.length).toBeGreaterThan(20);
    }
  });

  it('produces valid, deterministic output for every pattern × formation × side', () => {
    for (const side of sides) {
      for (const f of FORMATIONS) {
        const base = applyTemplate(fullTeam(side), f.slots, side, { kind: 'preset', id: f.id });
        for (const p of PATTERNS) {
          const a = applyPattern(base, side, p.id, [], 'seed');
          const b = applyPattern(base, side, p.id, [], 'seed');
          expect(a).toEqual(b);
          expect(a.team.slots.every(isInBounds)).toBe(true);
          expect(validateSquadIntegrity(a.team)).toEqual([]);
          // Identity and membership untouched; formation reference kept for reset.
          expect(a.team.slots.map((s) => [s.id, s.playerId])).toEqual(base.slots.map((s) => [s.id, s.playerId]));
          expect(a.team.formation).toEqual(base.formation);
          expect(a.drawings.length).toBeGreaterThan(0);
          for (const d of a.drawings) {
            expect(isInBounds(d.from) && isInBounds(d.to)).toBe(true);
            expect(d.source).toEqual({ patternId: p.id, teamId: base.id });
            expect(d.id.startsWith('seed-')).toBe(true);
            // Arrows start where a real player now stands.
            const starter = a.team.slots.find((s) => s.playerId === d.fromPlayerId);
            expect(starter).toBeDefined();
            expect(starter!.x).toBeCloseTo(d.from.x, 9);
            expect(starter!.y).toBeCloseTo(d.from.y, 9);
          }
          expect(new Set(a.drawings.map((d) => d.id)).size).toBe(a.drawings.length);
        }
      }
    }
  });

  it('pushes the block up for a high press and drops it for a low block', () => {
    for (const side of sides) {
      const base = fullTeam(side);
      const baseline = avgOutfieldX(base, side);
      expect(avgOutfieldX(applyPattern(base, side, 'high-press', [], 's').team, side)).toBeGreaterThan(baseline + 0.2);
      expect(avgOutfieldX(applyPattern(base, side, 'low-block', [], 's').team, side)).toBeLessThan(baseline);
      const mid = avgOutfieldX(applyPattern(base, side, 'mid-block', [], 's').team, side);
      expect(mid).toBeGreaterThan(avgOutfieldX(applyPattern(base, side, 'low-block', [], 's').team, side));
    }
  });

  it('sends the left back around the outside on an overlap and inside on an underlap', () => {
    for (const side of sides) {
      const base = fullTeam(side);
      const over = applyPattern(base, side, 'overlap', [], 's').drawings.find(
        (d) => d.kind === 'movement' && d.fromPlayerId === `${side}-p1`,
      )!;
      const under = applyPattern(base, side, 'underlap', [], 's').drawings.find(
        (d) => d.kind === 'movement' && d.fromPlayerId === `${side}-p1`,
      )!;
      expect(toTeamFrame(over.to, side).y).toBeLessThan(0.1);
      expect(toTeamFrame(under.to, side).y).toBeGreaterThan(0.2);
      expect(toTeamFrame(over.to, side).x).toBeGreaterThan(0.7);
    }
  });

  it('puts the corner taker at the corner flag and the goalkeeper at home', () => {
    for (const side of sides) {
      const { team, drawings } = applyPattern(fullTeam(side), side, 'set-piece', [], 's');
      const taker = team.slots.find((s) => s.playerId === `${side}-p8`)!; // left winger
      expect(toTeamFrame(taker, side)).toEqual({ x: 1, y: 0 });
      const gk = team.slots.find((s) => s.position === 'GK')!;
      expect(toTeamFrame(gk, side).x).toBeLessThan(0.1);
      expect(drawings.some((d) => d.kind === 'pass' && d.fromPlayerId === `${side}-p8`)).toBe(true);
    }
  });

  it('starts from formation defaults, so applying twice does not compound', () => {
    const base = fullTeam();
    const once = applyPattern(base, 'home', 'high-press', [], 's').team;
    const twice = applyPattern(once, 'home', 'high-press', [], 's').team;
    expect(twice.slots).toEqual(once.slots);
  });

  it('only draws arrows for filled slots', () => {
    const team = applyTemplate(fullTeam('home', 4, 0), getFormation('4-3-3').slots, 'home', { kind: 'preset', id: '4-3-3' });
    for (const p of PATTERNS) {
      for (const d of applyPattern(team, 'home', p.id, [], 's').drawings) {
        expect(d.fromPlayerId).toBeDefined();
      }
    }
  });

  it('throws for an unknown pattern', () => {
    // @ts-expect-error deliberately invalid
    expect(() => getPattern('tiki-taka')).toThrow();
  });
});
