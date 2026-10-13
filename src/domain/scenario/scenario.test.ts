import { describe, expect, it } from 'vitest';
import { fullTeam } from '../fixtures';
import { distanceM } from './geometry';
import { applyPattern, getPattern, PATTERNS } from '../patterns';
import { samplePositions } from '../replay/interpolate';
import { validateReplay } from '../replay/integrity';
import { buildScenario, markingAt, spacesAt, stageAt, visibleReplayAt } from './build';
import type { ScenarioSelection } from './build';
import { OVERLAP_SCENARIO as S } from './overlapFullBack';
import { evaluateSpaces, SPACE_THRESHOLDS } from './spaces';
import type { Positions } from './spaces';
const OUTCOME_IDS = Object.keys(S.outcomes);
const OPTION_IDS = Object.keys(S.options);
import type { OptionId, OutcomeId } from './types';

const left = { side: 'home', flank: 'left' } as const;
const build = (outcome: OutcomeId, option: OptionId | null, ctx: { side: 'home' | 'away'; flank: 'left' | 'right' } = left) =>
  buildScenario(S, { outcome, option }, ctx);
const at = (b: ReturnType<typeof build>, t: number) => samplePositions(b.author, t);
const grid = (end: number, step = 0.1) => Array.from({ length: Math.floor(end / step) + 1 }, (_, i) => Math.round(i * step * 100) / 100);
const d = (a: { x: number; y: number }, b: { x: number; y: number }) => distanceM(a, b);

describe('the overlap entry is upgraded, not duplicated', () => {
  it('keeps one Overlapping full-back pattern and the twelve patterns', () => {
    expect(PATTERNS).toHaveLength(12);
    expect(PATTERNS.filter((p) => p.name === 'Overlapping full-back')).toHaveLength(1);
    expect(PATTERNS.filter((p) => p.id === 'overlap')).toHaveLength(1);
    expect(PATTERNS.filter((p) => p.scenario).map((p) => p.id)).toEqual(['overlap', 'wide-overload']);
    expect(getPattern('overlap').scenario).toBe(S);
  });

  it('still applies the static pattern: arrows tagged with the pattern, slots moved', () => {
    const team = fullTeam('home');
    const result = applyPattern(team, 'home', 'overlap', [], 'seed');
    expect(result.drawings.length).toBeGreaterThan(0);
    expect(result.drawings.every((x) => x.source?.patternId === 'overlap')).toBe(true);
    expect(result.team.slots).toHaveLength(11);
  });
});

describe('stages', () => {
  it.each(OUTCOME_IDS)('outcome %s: stages follow one another from 0 to the decision point', (outcome) => {
    const b = build(outcome, null);
    const spans = b.stages.map((s) => [s.start, s.end] as const);
    expect(b.stages.map((s) => s.id)).toEqual(['carry', 'receive', 'overlap', 'release', 'decision']);
    expect(spans[0][0]).toBe(0);
    for (let i = 1; i < spans.length; i++) expect(spans[i][0]).toBe(spans[i - 1][1]);
    expect(b.stages[3].end).toBe(S.decisionT);
    expect(b.stages[4].start).toBe(S.decisionT);
    expect(b.duration).toBe(S.decisionT);
  });

  it('reports the stage for a time, and the decision stage at the pause', () => {
    const b = build('A', null);
    expect(stageAt(b, 0).id).toBe('carry');
    expect(stageAt(b, 5).id).toBe('receive');
    expect(stageAt(b, 7.5).id).toBe('overlap');
    expect(stageAt(b, 10).id).toBe('release');
    expect(stageAt(b, b.duration).id).toBe('decision');
  });

  it('puts the release pass later in outcome B, where the overlap stage lasts longer', () => {
    const a = build('A', null).stages.find((s) => s.id === 'overlap')!;
    const bB = build('B', null).stages.find((s) => s.id === 'overlap')!;
    expect(bB.end).toBeGreaterThan(a.end);
  });
});

describe('authored data is consistent', () => {
  it.each(OUTCOME_IDS)('outcome %s: every role has a position at the fork and the decision, in order, on the pitch', (outcome) => {
    const b = build(outcome, null);
    for (const role of S.roles) {
      const keys = b.author.keyframes
        .filter((k) => k.positions[role.id])
        .map((k) => ({ t: k.t, p: k.positions[role.id] }));
      expect(keys.some((k) => k.t === S.forkT), `${role.id} @ fork`).toBe(true);
      expect(keys.some((k) => k.t === S.decisionT), `${role.id} @ decision`).toBe(true);
      for (const k of keys) {
        expect(k.p.x).toBeGreaterThanOrEqual(0);
        expect(k.p.x).toBeLessThanOrEqual(100);
        expect(k.p.y).toBeGreaterThanOrEqual(0);
        expect(k.p.y).toBeLessThanOrEqual(100);
      }
    }
  });

  it('shows only the roles the tactic needs: 5 attackers, 5 defenders, the ball', () => {
    const b = build('A', null);
    expect(b.replay.actors.filter((a) => a.kind === 'player')).toHaveLength(10);
    expect(b.replay.actors.filter((a) => a.kind === 'ball')).toHaveLength(1);
    expect(S.roles.filter((r) => r.team === 'attack')).toHaveLength(5);
    expect(S.roles.filter((r) => r.team === 'defence').map((r) => r.id)).toEqual(['b-wg', 'b-fb', 'b-cb', 'b-cb2', 'b-dm']);
    // No opposing striker or goalkeeper is on the pitch.
    expect(b.replay.actors.some((a) => /striker|keeper|goalkeeper|forward/i.test(a.label))).toBe(false);
  });

  it('never stacks two players on top of each other (markers are 5.2 m across)', () => {
    const ids = S.roles.map((r) => r.id);
    for (const outcome of OUTCOME_IDS) {
      for (const option of [null, ...OPTION_IDS]) {
        const b = build(outcome, option);
        for (const t of grid(b.duration)) {
          const p = at(b, t);
          for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
              expect(d(p[ids[i]], p[ids[j]]), `${outcome}/${option} t=${t} ${ids[i]}~${ids[j]}`).toBeGreaterThanOrEqual(4);
            }
          }
        }
      }
    }
  });

  it('keeps the ball clear of its carrier’s marker but never far from him', () => {
    const b = build('A', null);
    for (const t of [0.5, 2, 5.5, 8, 10.5, 12]) {
      const p = at(b, t);
      const holder = t < 3.4 ? 'a-fb' : t < 8.2 ? 'a-wg' : 'a-fb';
      const gap = d(p.ball, p[holder]);
      expect(gap, `t=${t}`).toBeGreaterThan(2.6); // outside the 2.6 m marker
      expect(gap, `t=${t}`).toBeLessThan(4);
    }
  });

  it('keeps identity and role labels for the whole sequence', () => {
    for (const option of [null, ...OPTION_IDS]) {
      const b = build('A', option);
      for (const role of S.roles) {
        const actor = b.replay.actors.find((a) => a.id === role.id)!;
        expect(actor.label.length).toBeGreaterThan(0);
        expect(actor.label.length).toBeLessThanOrEqual(14);
        expect(b.badges[role.id].length).toBeGreaterThan(0);
        expect(b.badges[role.id].length).toBeLessThanOrEqual(2);
      }
    }
  });

  it('is a valid replay apart from the editor-only keyframe cap', () => {
    for (const outcome of OUTCOME_IDS) {
      for (const option of [null, ...OPTION_IDS]) {
        const errors = validateReplay(build(outcome, option).replay).filter((e) => !/keyframes/.test(e));
        expect(errors).toEqual([]);
      }
    }
  });
});

describe('ball synchronisation', () => {
  it.each(OUTCOME_IDS.flatMap((o) => [null, ...OPTION_IDS].map((opt) => [o, opt] as const)))(
    'outcome %s / option %s: the ball is with its holder or on its way between players',
    (outcome, option) => {
      const b = build(outcome, option);
      const passes = b.author.paths.filter((p) => p.kind !== 'movement').sort((x, y) => x.startT - y.startT);
      for (const t of grid(b.duration)) {
        const pos = at(b, t);
        const flight = passes.find((p) => t >= p.startT && t <= p.endT);
        if (flight) {
          const from = pos[flight.fromActorId as string];
          const to = flight.toActorId ? pos[flight.toActorId] : flight.to;
          // On the line between passer and receiver (the ball keeps a 3-unit lead, clear of the marker).
          const A = { x: from.x + 3, y: from.y };
          const B = { x: to.x + (flight.toActorId ? 3 : 0), y: to.y };
          const lerp = (s: number) => ({ x: A.x + (B.x - A.x) * s, y: A.y + (B.y - A.y) * s });
          const len = d(A, B) || 1;
          const s = Math.min(1, Math.max(0, d(A, pos.ball) / len));
          expect(d(pos.ball, lerp(s)), `t=${t}`).toBeLessThan(2.5);
          continue;
        }
        const landed = [...passes].reverse().find((p) => p.endT <= t);
        const holderId = landed ? landed.toActorId : 'a-fb';
        if (!holderId) continue; // a cross has landed in space: nobody holds it
        expect(d(pos.ball, pos[holderId]), `t=${t} holder ${holderId}`).toBeLessThan(4);
      }
    },
  );

  it('passes arrive exactly when the receiver is there (arrow end attached to the receiver)', () => {
    const b = build('A', null);
    const passes = b.replay.paths.filter((p) => p.kind === 'pass');
    expect(passes.map((p) => [p.fromActorId, p.toActorId])).toEqual([
      ['a-fb', 'a-wg'],
      ['a-wg', 'a-fb'],
    ]);
  });
});

describe('defensive reactions', () => {
  it('Team B’s winger presses the full-back, closing the distance, then drops off once the ball goes inside', () => {
    const b = build('A', null);
    expect(d(at(b, 3.4)['b-wg'], at(b, 3.4)['a-fb'])).toBeLessThan(d(at(b, 0)['b-wg'], at(b, 0)['a-fb']));
    expect(d(at(b, 3.4)['b-wg'], at(b, 3.4)['a-fb'])).toBeLessThan(6);
  });

  it('Team B’s full-back closes the winger as he carries inside', () => {
    const b = build('A', null);
    expect(d(at(b, 7)['b-fb'], at(b, 7)['a-wg'])).toBeLessThan(d(at(b, 4.4)['b-fb'], at(b, 4.4)['a-wg']));
  });

  it('outcome A: the winger follows the ball; outcome B: he follows the runner', () => {
    const A = build('A', null);
    const B = build('B', null);
    const t = 9.4;
    expect(d(at(A, t)['b-wg'], at(A, t)['a-wg'])).toBeLessThan(d(at(A, t)['b-wg'], at(A, t)['a-fb']));
    expect(d(at(B, t)['b-wg'], at(B, t)['a-fb'])).toBeLessThan(d(at(B, t)['b-wg'], at(B, t)['a-wg']));
    // The runner has less time under B: the defender is much closer when he receives.
    expect(d(at(B, 9.8)['b-wg'], at(B, 9.8)['a-fb'])).toBeLessThan(d(at(A, 9.4)['b-wg'], at(A, 9.4)['a-fb']) / 2);
  });

  it('the centre-back shifts toward the flank but stays in the box, and the other takes the striker', () => {
    const b = build('A', null);
    const before = at(b, 7);
    const after = at(b, b.decisionT);
    expect(d(before['b-cb'], before['a-9'])).toBeLessThan(d(before['b-cb2'], before['a-9']));
    expect(after['b-cb'].y).toBeLessThan(before['b-cb'].y - 6); // toward the full-back's flank
    expect(after['b-cb'].x).toBeGreaterThan(84); // still inside the penalty-area depth
    expect(d(after['b-cb2'], after['a-9'])).toBeLessThan(d(after['b-cb'], after['a-9']));
    expect(d(after['b-cb2'], after['a-9'])).toBeLessThan(SPACE_THRESHOLDS.marked);
  });

  it('under B the centre-back shifts less, because the full-back is not yet a threat to advance', () => {
    const A = at(build('A', null), S.decisionT);
    const B = at(build('B', null), S.decisionT);
    expect(B['b-cb'].y).toBeGreaterThan(A['b-cb'].y);
  });
});

describe('Team A responsibilities', () => {
  it.each(OUTCOME_IDS)('outcome %s: the 6 stays deeper and central, the 9 stays high, the 8 ends at the box edge', (outcome) => {
    const b = build(outcome, null);
    for (const t of grid(b.duration, 0.2)) {
      const p = at(b, t);
      expect(p['a-6'].x, `t=${t}`).toBeLessThan(p['a-8'].x - 10);
      expect(p['a-6'].x).toBeLessThan(65);
      expect(Math.abs(p['a-6'].y - 50)).toBeLessThan(15);
      expect(p['a-9'].x).toBeGreaterThanOrEqual(80);
    }
    const end = at(b, b.decisionT);
    expect(end['a-8'].x).toBeGreaterThan(80);
    expect(end['a-8'].x).toBeLessThan(86); // box edge is x ≈ 84.3
    expect(end['a-fb'].x).toBeGreaterThan(80); // the full-back is in the attacking third, wide
    expect(end['a-fb'].y).toBeLessThan(20);
  });

  it('the winger carries diagonally inward (toward the half-space) before the release', () => {
    const b = build('A', null);
    expect(at(b, 7)['a-wg'].y).toBeGreaterThan(at(b, 4.4)['a-wg'].y + 5);
    expect(at(b, 7)['a-wg'].x).toBeGreaterThan(at(b, 4.4)['a-wg'].x);
  });

  it('the full-back runs around the outside: ahead of the winger and nearer the touchline', () => {
    const b = build('A', null);
    expect(at(b, 8.2)['a-fb'].x).toBeGreaterThan(at(b, 8.2)['a-wg'].x);
    expect(at(b, 8.2)['a-fb'].y).toBeLessThan(at(b, 8.2)['a-wg'].y);
  });

  it('players do not all move at the same time or speed', () => {
    const b = build('A', null);
    const first = (id: string) => b.author.keyframes.find((k) => k.positions[id] && k.t > 0 && d(k.positions[id], b.author.keyframes[0].positions[id]) > 0.5)!.t;
    const starts = ['a-fb', 'a-wg', 'b-wg', 'b-fb', 'a-9'].map(first);
    expect(new Set(starts).size).toBeGreaterThan(2);
    const speed = (id: string, t0: number, t1: number) => d(at(b, t0)[id], at(b, t1)[id]) / (t1 - t0);
    expect(speed('a-fb', 8, 9)).toBeGreaterThan(speed('a-wg', 5, 7) * 1.2);
  });
});

describe('space highlights are computed from positions', () => {
  const sel = (outcome: OutcomeId, option: OptionId | null): ScenarioSelection => ({ outcome, option });
  const base: Positions = {
    ball: { x: 91, y: 10 },
    'a-fb': { x: 90, y: 10 },
    'a-wg': { x: 77, y: 22 },
    'a-9': { x: 91, y: 46 },
    'a-8': { x: 83, y: 27 },
    'a-6': { x: 62, y: 42 },
    'b-wg': { x: 80, y: 20 },
    'b-fb': { x: 78, y: 33 },
    'b-cb': { x: 91, y: 31 },
    'b-cb2': { x: 92.5, y: 48.5 },
    'b-dm': { x: 78, y: 40 },
  };
  const find = (id: string, positions: Positions, t = 12, option: OptionId | null = null) =>
    evaluateSpaces(S, sel('A', option), positions, t).find((h) => h.id === id);

  it('shows the outside channel when nobody is in it and drops it when a defender steps into it', () => {
    const open = find('channel', { ...base, 'a-fb': { x: 72, y: 5 }, 'b-wg': { x: 60, y: 24 } }, 8.5);
    expect(open?.status).toBe('open');
    const inside = find('channel', { ...base, 'a-fb': { x: 72, y: 5 }, 'b-wg': { x: 80, y: 8 } }, 8.5);
    expect(inside).toBeUndefined();
  });

  it('marks the channel contested when the winger is close behind the runner', () => {
    const tracked = find('channel', { ...base, 'a-fb': { x: 76, y: 5 }, 'b-wg': { x: 71, y: 8 } }, 8.5);
    expect(tracked?.status).toBe('contested');
    expect(tracked?.label).toMatch(/contested/);
  });

  it('opens the lane to the 8 only while no defender sits on it, and updates when one closes it', () => {
    const clear = find('lane-8', { ...base, 'b-wg': { x: 70, y: 30 }, 'b-dm': { x: 70, y: 45 }, 'b-fb': { x: 70, y: 38 } });
    expect(clear?.status).toBe('open');
    const nearby = find('lane-8', { ...base, 'b-dm': { x: 87, y: 12 } });
    expect(nearby).toBeDefined();
    expect(nearby?.status).not.toBe('open');
    const closed = find('lane-8', { ...base, 'b-dm': { x: 87, y: 18.5 }, 'b-wg': { x: 70, y: 30 } });
    expect(closed).toBeUndefined();
  });

  it('does not call the striker unmarked while a defender is within reach', () => {
    const marked = find('cb-gap', base);
    expect(marked?.status).toBe('contested');
    expect(marked?.detail).toMatch(/still marked/);
    const loose = find('cb-gap', { ...base, 'b-cb2': { x: 88, y: 66 }, 'b-dm': { x: 70, y: 40 } });
    expect(loose?.status).toBe('open');
    expect(loose?.detail).not.toMatch(/unmarked/i);
  });

  it('shows no centre-back gap when the centre-backs stay together', () => {
    expect(find('cb-gap', { ...base, 'b-cb': { x: 90, y: 44 } })).toBeUndefined();
  });

  it('only shows the target zone for the cross, and the winger’s room only for the return pass', () => {
    expect(find('cross-target', base, 13, null)).toBeUndefined();
    expect(find('cross-target', base, 13, 'cross')).toBeDefined();
    expect(find('winger-pocket', base, 13, 'cutback')).toBeUndefined();
  });

  it('always shows the number 6’s cover, and the space left behind once the full-back is high', () => {
    for (const outcome of OUTCOME_IDS) {
      const b = build(outcome, null);
      for (const t of grid(b.duration, 0.5)) expect(spacesAt(b, t).some((h) => h.id === 'cover-six'), `t=${t}`).toBe(true);
      expect(spacesAt(b, 3).some((h) => h.id === 'behind-fb')).toBe(false);
      expect(spacesAt(b, b.decisionT).some((h) => h.id === 'behind-fb')).toBe(true);
    }
  });

  it('has the outside channel open under A and contested under B by the time the ball is released', () => {
    const a = spacesAt(build('A', null), 9.4).find((h) => h.id === 'channel');
    const bb = spacesAt(build('B', null), 9.8).find((h) => h.id === 'channel');
    expect(a?.status).toBe('open');
    expect(bb?.status).toBe('contested');
  });

  it('draws the cross corridor and the 8’s lane at the decision point in outcome A', () => {
    const ids = spacesAt(build('A', null), S.decisionT).map((h) => h.id);
    expect(ids).toEqual(expect.arrayContaining(['cross-lane', 'lane-8', 'cb-gap', 'cover-six', 'behind-fb']));
  });

  it('does not make claims it cannot support', () => {
    for (const outcome of OUTCOME_IDS) {
      for (const option of [null, ...OPTION_IDS]) {
        const b = build(outcome, option);
        const text = [
          ...b.replay.annotations.map((a) => a.label),
          ...grid(b.duration, 0.5).flatMap((t) => spacesAt(b, t).flatMap((h) => [h.label, h.detail ?? ''])),
        ].join('\n');
        expect(text).not.toMatch(/unmarked|always|never|guarantee(?!d? a shot)|will score|goal!/i);
      }
    }
  });

  it('draws marking lines that hand the striker from one centre-back to the other', () => {
    const b = build('A', null);
    expect(markingAt(b, 5).some((m) => m.id === 'cb-marks-9')).toBe(true);
    expect(markingAt(b, 12).some((m) => m.id === 'cb-marks-9')).toBe(false);
    expect(markingAt(b, 12).some((m) => m.id === 'cb2-marks-9-a')).toBe(true);
  });
});

describe('the three options', () => {
  const options = OPTION_IDS.map((o) => [o, build('A', o)] as const);

  it('all start from exactly the same decision state and share the same prefix', () => {
    const none = build('A', null);
    for (const [, b] of options) {
      for (let t = 0; t <= S.decisionT + 1e-9; t += 0.1) {
        const p = at(b, t);
        const q = at(none, t);
        for (const id of Object.keys(q)) expect(d(p[id], q[id]), `${id} @ ${t.toFixed(1)}`).toBeLessThan(0.01);
      }
    }
  });

  it('each plays exactly its own pass and none of the others', () => {
    const decisionPasses = (b: ReturnType<typeof build>) =>
      b.replay.paths.filter((p) => p.kind !== 'movement' && p.startT >= S.decisionT).map((p) => [p.kind, p.fromActorId, p.toActorId]);
    expect(decisionPasses(build('A', 'cross'))).toEqual([['lofted', 'a-fb', null]]);
    expect(decisionPasses(build('A', 'combine'))).toEqual([['pass', 'a-fb', 'a-wg']]);
    expect(decisionPasses(build('A', 'cutback'))).toEqual([['pass', 'a-fb', 'a-8']]);
    expect(decisionPasses(build('A', null))).toEqual([]);
  });

  it('end where they say they end, with a verdict at the landing', () => {
    for (const [option, b] of options) {
      expect(b.duration).toBe(S.options[option].end);
      const verdict = b.author.annotations.find((a) => a.id === 'verdict');
      expect(verdict?.label.length).toBeGreaterThan(20);
    }
  });

  it('never awards a shot or a goal', () => {
    for (const outcome of OUTCOME_IDS) {
      for (const option of OPTION_IDS) {
        const b = build(outcome, option);
        expect(b.replay.paths.some((p) => p.kind === 'shot')).toBe(false);
        expect(b.replay.event.type).not.toBe('goal');
      }
    }
  });

  it('cross: the 9 attacks the delivery zone while a centre-back arrives; combine: the winger receives; cutback: the 8 receives', () => {
    const cross = options.find(([o]) => o === 'cross')![1];
    const end = at(cross, 13.7);
    const target = { x: 92.5, y: 44 };
    expect(d(end['a-9'], target)).toBeLessThan(2.5);
    expect(d(end['b-cb2'], target)).toBeLessThan(SPACE_THRESHOLDS.withinReach + 0.1);
    expect(d(end.ball, target)).toBeLessThan(1);

    const combine = options.find(([o]) => o === 'combine')![1];
    expect(d(at(combine, 13.4).ball, at(combine, 13.4)['a-wg'])).toBeLessThan(4);
    // A genuinely different pass: backwards and inward, not the original inside pass repeated.
    const start = at(combine, S.decisionT).ball;
    const landing = at(combine, 13.4).ball;
    expect(landing.x).toBeLessThan(start.x);
    expect(landing.y).toBeGreaterThan(start.y);

    const cutback = options.find(([o]) => o === 'cutback')![1];
    expect(d(at(cutback, 13.4).ball, at(cutback, 13.4)['a-8'])).toBeLessThan(4);
  });

  it('defenders react after the pass is played, not before', () => {
    const cutback = options.find(([o]) => o === 'cutback')![1];
    const before = at(cutback, S.decisionT);
    const after = at(cutback, 13.4);
    expect(d(after['b-dm'], after['a-8'])).toBeLessThan(d(before['b-dm'], before['a-8']));
    expect(d(after['b-fb'], after['a-8'])).toBeLessThan(d(before['b-fb'], before['a-8']));
  });

  it('outcome B shows the cross hurried by the recovering winger', () => {
    const b = build('B', 'cross');
    const text = b.author.annotations.find((a) => a.id === 'verdict')!.label;
    expect(text).toMatch(/under pressure/i);
    const a = build('A', 'cross');
    expect(a.author.annotations.find((x) => x.id === 'verdict')!.label).toMatch(/with time/i);
  });
});

describe('orientation, flank and determinism', () => {
  it('is deterministic: the same inputs give the same replay', () => {
    expect(JSON.stringify(build('A', 'cross').replay)).toBe(JSON.stringify(build('A', 'cross').replay));
  });

  it('mirrors to the right flank (y flips) and rotates for the away side (x and y flip)', () => {
    const l = build('A', null, { side: 'home', flank: 'left' });
    const r = build('A', null, { side: 'home', flank: 'right' });
    const away = build('A', null, { side: 'away', flank: 'left' });
    const k = (b: ReturnType<typeof build>) => b.replay.keyframes.find((x) => x.t === 0)!.positions['a-fb'];
    expect(k(l)).toMatchObject({ x: 46, y: 8 });
    expect(k(r)).toMatchObject({ x: 46, y: 92 });
    expect(k(away)).toMatchObject({ x: 54, y: 92 });
    expect(r.replay.actors.find((a) => a.id === 'a-fb')!.label).toBe('Right back');
    expect(l.replay.actors.find((a) => a.id === 'a-fb')!.label).toBe('Left back');
  });

  it('assigns Team A to the chosen side and Team B to the other', () => {
    const away = build('A', null, { side: 'away', flank: 'left' });
    expect(away.replay.actors.find((a) => a.id === 'a-9')!.side).toBe('away');
    expect(away.replay.actors.find((a) => a.id === 'b-cb')!.side).toBe('home');
    expect(away.replay.attackingSide).toBe('away');
  });

  it('highlights follow the mirrored frame: the channel sits on the same flank as the runner', () => {
    const r = build('A', null, { side: 'home', flank: 'right' });
    const channel = spacesAt(r, 9)!.find((h) => h.id === 'channel')!;
    const runner = r.replay.keyframes.find((k) => k.t === 9)?.positions['a-fb'] ?? samplePositions(r.replay, 9)['a-fb'];
    expect(channel.points.every((p) => p.y > 50)).toBe(true);
    expect(runner.y).toBeGreaterThan(50);
  });

  it('visibleReplayAt drops arrows that are no longer current but keeps every player and caption', () => {
    const b = build('A', null);
    const early = visibleReplayAt(b, 0.2);
    const late = visibleReplayAt(b, 12);
    expect(early.actors).toHaveLength(b.replay.actors.length);
    expect(early.annotations).toBe(b.replay.annotations);
    expect(late.paths.length).toBeLessThan(b.replay.paths.length);
    expect(late.paths.some((p) => p.note === 'Presses')).toBe(false);
    expect(late.paths.some((p) => p.note === 'Overlap run')).toBe(true);
  });
});
