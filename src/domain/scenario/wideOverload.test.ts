import { describe, expect, it } from 'vitest';
import { fullTeam } from '../fixtures';
import { applyPattern, getPattern, PATTERNS } from '../patterns';
import { validateReplay } from '../replay/integrity';
import { samplePositions } from '../replay/interpolate';
import { buildScenario, spacesAt, stageAt, visibleReplayAt } from './build';
import type { ScenarioBuild } from './build';
import { distanceM } from './geometry';
import { OVERLAP_SCENARIO } from './overlapFullBack';
import { ROLE_NUMBERS } from './roles';
import { evaluateSpaces, laneStatus } from './spaces';
import type { Positions } from './spaces';
import { byFlank } from './types';
import type { Flank } from './types';
import { WIDE_OVERLOAD_SCENARIO as S } from './wideOverload';

const OUTCOMES = Object.keys(S.outcomes);
const OPTIONS = Object.keys(S.options);
const ctx = { side: 'home', flank: 'left' } as const;
const build = (outcome: string, option: string | null, c: { side: 'home' | 'away'; flank: Flank } = ctx) =>
  buildScenario(S, { outcome, option }, c);
const at = (b: ScenarioBuild, t: number) => samplePositions(b.author, t);
const d = (a: { x: number; y: number }, b: { x: number; y: number }) => distanceM(a, b);
const grid = (end: number, step = 0.1) => Array.from({ length: Math.floor(end / step) + 1 }, (_, i) => Math.round(i * step * 100) / 100);
const numberOf = (id: string, flank: Flank) => {
  const r = S.roles.find((x) => x.id === id)!;
  return r.number === undefined ? null : byFlank(r.number, flank);
};
const firstPass = (b: ScenarioBuild) =>
  b.replay.paths.filter((p) => p.kind !== 'movement' && p.startT >= S.decisionT).sort((a, c) => a.startT - c.startT)[0];

describe('Wide overload: pattern entry', () => {
  it('upgrades the existing pattern without duplicating it or touching the others', () => {
    expect(PATTERNS).toHaveLength(12);
    expect(PATTERNS.filter((p) => p.name === 'Wide overload')).toHaveLength(1);
    expect(getPattern('wide-overload').scenario).toBe(S);
    expect(getPattern('overlap').scenario).toBe(OVERLAP_SCENARIO);
    expect(PATTERNS.filter((p) => p.scenario).map((p) => p.id)).toEqual(['overlap', 'wide-overload']);
  });

  it('still applies the static pattern', () => {
    const r = applyPattern(fullTeam('home'), 'home', 'wide-overload', [], 'seed');
    expect(r.drawings.length).toBeGreaterThan(0);
    expect(r.drawings.every((x) => x.source?.patternId === 'wide-overload')).toBe(true);
    expect(r.team.slots).toHaveLength(11);
  });

  it('is a valid scenario: ids are unique and every outcome and option is self-consistent', () => {
    expect(new Set(S.roles.map((r) => r.id)).size).toBe(S.roles.length);
    expect(S.defaultOutcome).toBe(OUTCOMES[0]);
    for (const outcome of OUTCOMES) {
      for (const option of [null, ...OPTIONS]) {
        const b = build(outcome, option);
        expect(validateReplay(b.replay).filter((e) => !/keyframes/.test(e))).toEqual([]);
        for (const role of S.roles) {
          const times = b.author.keyframes.filter((k) => k.positions[role.id]).map((k) => k.t);
          expect(times, `${role.id} @ fork`).toContain(S.forkT);
          expect(times, `${role.id} @ decision`).toContain(S.decisionT);
        }
      }
    }
  });
});

describe('Wide overload: shirt-number role mapping', () => {
  it('uses only the fixed numbers and keeps each number in its own role group', () => {
    const groupOfRole: Record<string, string> = {
      'a-fb': 'fullBack',
      'a-far-fb': 'fullBack',
      'b-fb': 'fullBack',
      'b-far-fb': 'fullBack',
      'a-cb-n': 'centreBack',
      'a-cb-f': 'centreBack',
      'b-cb-n': 'centreBack',
      'b-cb-f': 'centreBack',
      'a-6': 'defensiveMidfielder',
      'b-6': 'defensiveMidfielder',
      'a-8': 'centralMidfielder',
      'b-8': 'centralMidfielder',
      'a-10': 'attackingMidfielder',
      'a-wg': 'winger',
      'a-far-wg': 'winger',
      'b-wg': 'winger',
      'a-9': 'striker',
    };
    expect(Object.keys(groupOfRole).sort()).toEqual(S.roles.map((r) => r.id).sort());
    for (const flank of ['left', 'right'] as const) {
      for (const role of S.roles) {
        const n = numberOf(role.id, flank)!;
        expect(ROLE_NUMBERS[n], `${role.id} ${flank} → #${n}`).toBeDefined();
        expect(ROLE_NUMBERS[n].group).toBe(groupOfRole[role.id]);
      }
    }
  });

  it('never repeats a number within a team and never uses the goalkeeper', () => {
    for (const flank of ['left', 'right'] as const) {
      for (const team of ['attack', 'defence'] as const) {
        const nums = S.roles.filter((r) => r.team === team).map((r) => numberOf(r.id, flank));
        expect(new Set(nums).size).toBe(nums.length);
        expect(nums).not.toContain(1);
      }
    }
  });

  it('puts every number on its own side of the pitch, on either flank (numbers are not swapped)', () => {
    for (const flank of ['left', 'right'] as const) {
      const b = build('shift', null, { side: 'home', flank });
      const p = samplePositions(b.replay, 0);
      for (const role of S.roles.filter((r) => r.team === 'attack')) {
        const info = ROLE_NUMBERS[numberOf(role.id, flank)!];
        // Home attacks toward x = 100; its left touchline is y = 0.
        if (info.side === 'left') expect(p[role.id].y, `${role.id} #${numberOf(role.id, flank)} ${flank}`).toBeLessThan(50);
        if (info.side === 'right') expect(p[role.id].y, `${role.id} #${numberOf(role.id, flank)} ${flank}`).toBeGreaterThan(50);
      }
      // Team B faces the other way: its right is the pitch's left from Team A's view.
      for (const role of S.roles.filter((r) => r.team === 'defence')) {
        const info = ROLE_NUMBERS[numberOf(role.id, flank)!];
        if (info.side === 'right') expect(p[role.id].y, `${role.id} ${flank}`).toBeLessThan(50);
        if (info.side === 'left') expect(p[role.id].y, `${role.id} ${flank}`).toBeGreaterThan(50);
      }
    }
  });

  it('overloads with 11 and 3 on the left and with 7 and 2 on the right; the far-side winger is the other one', () => {
    expect([numberOf('a-wg', 'left'), numberOf('a-fb', 'left'), numberOf('a-far-wg', 'left')]).toEqual([11, 3, 7]);
    expect([numberOf('a-wg', 'right'), numberOf('a-fb', 'right'), numberOf('a-far-wg', 'right')]).toEqual([7, 2, 11]);
    for (const flank of ['left', 'right'] as const) {
      expect([numberOf('a-8', flank), numberOf('a-10', flank), numberOf('a-6', flank), numberOf('a-9', flank)]).toEqual([8, 10, 6, 9]);
      const b = build('shift', null, { side: 'home', flank });
      expect(b.badges['a-wg']).toBe(String(numberOf('a-wg', flank)));
      expect(b.replay.actors.find((a) => a.id === 'a-wg')!.label).toMatch(new RegExp(`^${numberOf('a-wg', flank)} `));
    }
  });
});

describe('Wide overload: stages and playback structure', () => {
  it.each(OUTCOMES)('outcome %s: seven stages in order, contiguous, resolve stage unreachable until an option is chosen', (outcome) => {
    const none = build(outcome, null);
    expect(none.stages.map((s) => s.label)).toEqual(['Stage 1', 'Stage 2', 'Stage 3', 'Stage 4', 'Stage 5', 'Stage 6', 'Stage 7']);
    expect(none.stages.map((s) => s.title)).toEqual([
      'Initial structure',
      'Establish the overload',
      'Create the numerical advantage',
      'Defensive responses',
      'Protect against transitions',
      'Exploit the opening',
      'Resolve the action',
    ]);
    expect(none.stages[6].available).toBe(false);
    expect(none.duration).toBe(S.decisionT);
    expect(stageAt(none, none.duration).title).toBe('Exploit the opening');
    expect(none.stepMarks).not.toContain(none.stages[6].start === none.duration ? -1 : none.stages[6].start + 99);

    for (const option of OPTIONS) {
      const b = build(outcome, option);
      expect(b.stages.every((s) => s.available)).toBe(true);
      for (let i = 1; i < b.stages.length; i++) expect(b.stages[i].start).toBe(b.stages[i - 1].end);
      expect(b.stages[0].start).toBe(0);
      expect(b.stages[6].end).toBe(b.duration);
      // The resolve stage begins exactly when the first pass lands.
      expect(b.stages[6].start).toBeCloseTo(firstPass(b).endT, 5);
      expect(stageAt(b, S.decisionT + 0.1).title).toBe('Exploit the opening');
      expect(stageAt(b, b.duration).title).toBe('Resolve the action');
    }
  });

  it('resolves each stage at the times the brief orders them', () => {
    const b = build('shift', null);
    const titles = [0, 3, 6, 10, 12.5, 13.6].map((t) => stageAt(b, t).title);
    expect(titles).toEqual([
      'Initial structure',
      'Establish the overload',
      'Create the numerical advantage',
      'Defensive responses',
      'Protect against transitions',
      'Exploit the opening',
    ]);
  });
});

describe('Wide overload: ball and movement', () => {
  it.each(OUTCOMES.flatMap((o) => [null, ...OPTIONS].map((opt) => [o, opt] as const)))(
    'outcome %s / option %s: the ball is with its holder or on a straight pass between players',
    (outcome, option) => {
      const b = build(outcome, option);
      const passes = b.author.paths.filter((p) => p.kind !== 'movement').sort((x, y) => x.startT - y.startT);
      for (const t of grid(b.duration)) {
        const pos = at(b, t);
        const flight = passes.find((p) => t >= p.startT && t <= p.endT);
        if (flight) {
          const from = pos[flight.fromActorId as string];
          const to = flight.toActorId ? pos[flight.toActorId] : flight.to;
          const A = { x: from.x + 3, y: from.y };
          const B = { x: to.x + (flight.toActorId ? 3 : 0), y: to.y };
          const len = d(A, B) || 1;
          const s = Math.min(1, Math.max(0, d(A, pos.ball) / len));
          const on = { x: A.x + (B.x - A.x) * s, y: A.y + (B.y - A.y) * s };
          expect(d(pos.ball, on), `t=${t}`).toBeLessThan(2.5);
          continue;
        }
        const landed = [...passes].reverse().find((p) => p.endT <= t);
        const holder = landed ? landed.toActorId : 'a-6';
        expect(d(pos.ball, pos[holder as string]), `t=${t} holder ${holder}`).toBeLessThan(4);
      }
    },
  );

  it('passes through the group in the order 6 → full-back → winger → No. 10 → No. 8', () => {
    const b = build('shift', null);
    expect(b.replay.paths.filter((p) => p.kind === 'pass').map((p) => `${p.fromActorId}>${p.toActorId}`)).toEqual([
      'a-6>a-fb',
      'a-fb>a-wg',
      'a-wg>a-10',
      'a-10>a-8',
    ]);
  });

  it('no two players are ever stacked: at least 4 m apart on every frame of every line', () => {
    const ids = S.roles.map((r) => r.id);
    for (const outcome of OUTCOMES) {
      for (const option of [null, ...OPTIONS]) {
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

  it('players do not all start together or move at the same speed', () => {
    const b = build('shift', null);
    const first = (id: string) => b.author.keyframes.find((k) => k.positions[id] && k.t > 0 && d(k.positions[id], b.author.keyframes[0].positions[id]) > 0.5)!.t;
    expect(new Set(['a-fb', 'a-10', 'a-8', 'b-wg', 'b-8'].map(first)).size).toBeGreaterThan(1);
    const speed = (id: string, t0: number, t1: number) => d(at(b, t0)[id], at(b, t1)[id]) / (t1 - t0);
    expect(speed('a-fb', 5.4, 6.2)).not.toBeCloseTo(speed('a-10', 5.4, 6.2), 1);
  });

  it('is deterministic and mirrors on the right flank without moving numbers', () => {
    expect(JSON.stringify(build('press', 'switch').replay)).toBe(JSON.stringify(build('press', 'switch').replay));
    const l = build('shift', null, { side: 'home', flank: 'left' });
    const r = build('shift', null, { side: 'home', flank: 'right' });
    const k = (b: ScenarioBuild, id: string) => b.replay.keyframes.find((x) => x.t === 0)!.positions[id];
    expect(k(r, 'a-fb').y).toBeCloseTo(100 - k(l, 'a-fb').y, 3);
    expect(k(r, 'a-fb').x).toBeCloseTo(k(l, 'a-fb').x, 3);
    expect(r.replay.actors.find((a) => a.id === 'a-far-wg')!.label).toBe('11 Left winger');
    const away = build('shift', null, { side: 'away', flank: 'left' });
    expect(away.replay.actors.find((a) => a.id === 'a-9')!.side).toBe('away');
    expect(away.replay.actors.find((a) => a.id === 'b-6')!.side).toBe('home');
  });
});

describe('Wide overload: players shown and structure', () => {
  it('shows ten attackers and seven defenders, no goalkeeper, nobody else', () => {
    const b = build('shift', null);
    expect(S.roles.filter((r) => r.team === 'attack')).toHaveLength(10);
    expect(S.roles.filter((r) => r.team === 'defence')).toHaveLength(7);
    expect(b.replay.actors.filter((a) => a.kind === 'player')).toHaveLength(17);
    expect(b.replay.actors.some((a) => /keeper|^1 /i.test(a.label))).toBe(false);
  });

  it('keeps the far-side winger wide and high enough to threaten the switch, until the decision', () => {
    for (const outcome of OUTCOMES) {
      const b = build(outcome, null);
      for (const t of grid(b.duration, 0.2)) {
        const p = at(b, t)['a-far-wg'];
        expect(p.y, `t=${t}`).toBeGreaterThanOrEqual(88);
        expect(p.x, `t=${t}`).toBeGreaterThanOrEqual(70);
      }
    }
  });

  it('has the No. 6 drop across behind and inside the advancing full-back, with a rest-defence shape left', () => {
    for (const outcome of OUTCOMES) {
      const b = build(outcome, null);
      const start = at(b, 0);
      const end = at(b, b.decisionT);
      expect(end['a-fb'].x).toBeGreaterThan(start['a-fb'].x + 15); // the full-back has advanced
      expect(end['a-6'].x).toBeLessThan(end['a-fb'].x); // behind him
      expect(end['a-6'].y).toBeGreaterThan(end['a-fb'].y); // and inside him
      expect(end['a-6'].y).toBeLessThan(start['a-6'].y - 10); // having come across from the middle
      expect(d(end['a-6'], end['a-fb'])).toBeLessThan(22);
      // Rest defence: two centre-backs and the far-side full-back stay deep and spread, with the No. 6 in front.
      for (const id of ['a-cb-n', 'a-cb-f', 'a-far-fb']) expect(end[id].x, id).toBeLessThan(56);
      expect(Math.abs(end['a-cb-n'].y - end['a-cb-f'].y)).toBeGreaterThan(12);
    }
  });

  it('keeps the No. 9 high and the No. 8 and No. 10 at different heights and angles from the winger and full-back', () => {
    const b = build('shift', null);
    const p = at(b, 9);
    const heights = ['a-wg', 'a-fb', 'a-10', 'a-8'].map((id) => Math.round(p[id].x));
    expect(new Set(heights).size).toBe(4);
    expect(p['a-9'].x).toBeGreaterThan(p['a-10'].x);
    expect(p['a-wg'].y).toBeLessThan(p['a-10'].y);
    expect(p['a-10'].y).toBeLessThan(p['a-6'].y);
  });
});

describe('Wide overload: highlights come from the positions', () => {
  const sel = (option: string | null = null) => ({ outcome: 'shift', option });
  const base: Positions = {
    ball: { x: 72, y: 34 },
    'a-wg': { x: 78, y: 8 },
    'a-fb': { x: 70, y: 20 },
    'a-8': { x: 58, y: 28 },
    'a-10': { x: 72, y: 34 },
    'a-9': { x: 82, y: 46 },
    'a-far-wg': { x: 72, y: 92 },
    'a-6': { x: 52, y: 38 },
    'b-wg': { x: 77, y: 18 },
    'b-fb': { x: 82, y: 14 },
    'b-8': { x: 70, y: 56 },
    'b-6': { x: 70, y: 62 },
    'b-cb-n': { x: 88, y: 40 },
    'b-cb-f': { x: 88, y: 58 },
    'b-far-fb': { x: 86, y: 82 },
  };
  const find = (id: string, p: Positions, t: number, option: string | null = null) =>
    evaluateSpaces(S, sel(option), p, t).find((h) => h.id === id);

  it('counts attackers against the defenders actually in the zone, and says so', () => {
    const two = find('overload', base, 9);
    expect(two?.label).toBe('4v2 overload');
    expect(two?.status).toBe('open');
    const three = find('overload', { ...base, 'b-8': { x: 74, y: 30 } }, 9);
    expect(three?.label).toBe('4v3 overload');
    const four = find('overload', { ...base, 'b-8': { x: 74, y: 30 }, 'b-6': { x: 66, y: 26 } }, 9);
    expect(four?.label).toBe('4v4, no overload');
    expect(four?.status).toBe('contested');
    // A defender far from the zone changes nothing.
    expect(find('overload', { ...base, 'b-cb-n': { x: 99, y: 90 } }, 9)?.label).toBe('4v2 overload');
  });

  it('only shows the overload while the stage that builds it is running', () => {
    expect(find('overload', base, 3)).toBeUndefined();
    expect(find('overload', base, 12)).toBeUndefined();
  });

  it('shows central space only when no defender is in or near it, and drops it when one steps in', () => {
    // Midfield pair is in the middle: nothing to show.
    expect(find('central-space', { ...base, 'b-8': { x: 73, y: 46 } }, 12)).toBeUndefined();
    // Both pulled away and the back line holds: open space between the lines.
    const open = find('central-space', { ...base, 'b-8': { x: 66, y: 30 }, 'b-6': { x: 66, y: 46 } }, 12);
    expect(open?.status).toBe('open');
    // A centre-back close to the edge makes it contested, not open.
    const near = find('central-space', { ...base, 'b-8': { x: 66, y: 30 }, 'b-6': { x: 66, y: 46 }, 'b-cb-n': { x: 87, y: 50 } }, 12);
    expect(near?.status).toBe('contested');
  });

  it('shows far-side space only while the far-side full-back has left it', () => {
    expect(find('far-space', base, 12)).toBeUndefined(); // he is right there
    expect(find('far-space', { ...base, 'b-far-fb': { x: 86, y: 70 } }, 12)?.status).toBe('open');
  });

  it('closes the switch lane when a defender gets in front of the kicker or the receiver, but not when one is mid-flight', () => {
    const open = { ...base, ball: { x: 67, y: 36 }, 'b-8': { x: 74, y: 41 }, 'b-6': { x: 73, y: 47 }, 'b-far-fb': { x: 86, y: 70 } };
    expect(find('switch-lane', open, 12)?.status).toBe('open');
    const blockedNear = { ...open, 'b-6': { x: 68, y: 44 } };
    expect(find('switch-lane', blockedNear, 12)).toBeUndefined();
    const blockedAtReceiver = { ...open, 'b-far-fb': { x: 73, y: 90 } };
    expect(find('switch-lane', blockedAtReceiver, 12)).toBeUndefined();
    // A lofted ball passes over a defender standing in the middle of the pitch.
    const midFlight = { ...open, 'b-cb-f': { x: 70, y: 64 } };
    expect(find('switch-lane', midFlight, 12)?.status).toBe('open');
  });

  it('never claims more than the geometry: no guarantees, no "unmarked"', () => {
    for (const outcome of OUTCOMES) {
      for (const option of [null, ...OPTIONS]) {
        const b = build(outcome, option);
        const text = [
          ...b.replay.annotations.map((a) => a.label),
          ...grid(b.duration, 0.5).flatMap((t) => spacesAt(b, t).flatMap((h) => [h.label, h.detail ?? ''])),
        ].join('\n');
        expect(text).not.toMatch(/unmarked|guarantee(?!d? a shot)|will score|always|never|goal!/i);
      }
    }
  });
});

describe('Wide overload: defensive responses and what they open', () => {
  it('shift: the central pair and the far-side full-back come across, so the near-side count grows and the far side loosens', () => {
    const b = build('shift', null);
    expect(d(at(b, 11.4)['b-8'], at(b, 11.4)['a-10'])).toBeLessThan(d(at(b, 9)['b-8'], at(b, 9)['a-10']));
    expect(at(b, S.decisionT)['b-far-fb'].y).toBeLessThan(at(b, 9)['b-far-fb'].y - 8);
    const label = (t: number) => spacesAt(b, t).find((h) => h.id === 'overload')!.label;
    expect(label(9)).toBe('4v2 overload');
    expect(label(10.4)).toBe('4v3 overload');
    const ids = spacesAt(b, S.decisionT).map((h) => h.id);
    expect(ids).toContain('far-space');
    expect(ids).not.toContain('central-space');
  });

  it('press: the No. 6 steps out and the No. 8 tracks, the back line and far-side full-back hold their width', () => {
    const b = build('press', null);
    expect(d(at(b, 11.4)['b-6'], at(b, 11.4).ball)).toBeLessThan(d(at(b, 9)['b-6'], at(b, 9).ball));
    expect(at(b, S.decisionT)['b-far-fb'].y).toBeGreaterThanOrEqual(78);
    expect(Math.abs(at(b, S.decisionT)['b-cb-n'].y - at(b, 9)['b-cb-n'].y)).toBeLessThan(3);
    const ids = spacesAt(b, S.decisionT).map((h) => h.id);
    expect(ids).toContain('central-space');
    expect(ids).not.toContain('far-space');
  });

  it('attackers adapt to the response rather than repeat the same movement', () => {
    const s = at(build('shift', null), S.decisionT);
    const p = at(build('press', null), S.decisionT);
    expect(p['a-9'].x).toBeLessThan(s['a-9'].x - 2); // drops into the space behind the presser
    expect(d(p['a-10'], s['a-10'])).toBeGreaterThan(4);
    expect(d(p['a-8'], s['a-8'])).toBeGreaterThan(4);
  });
});

describe('Wide overload: the three options', () => {
  it('all start from the same decision state and share the same prefix', () => {
    for (const outcome of OUTCOMES) {
      const none = build(outcome, null);
      for (const option of OPTIONS) {
        const b = build(outcome, option);
        for (const t of grid(S.decisionT, 0.2)) {
          const p = at(b, t);
          const q = at(none, t);
          // Same frames up to the decision (a few tenths of a millimetre of rounding at most).
          for (const id of Object.keys(q)) expect(d(p[id], q[id]), `${outcome}/${option} ${id} @ ${t}`).toBeLessThan(0.01);
        }
      }
    }
  });

  it('plays only the chosen option’s passes from the decision point', () => {
    const passes = (b: ScenarioBuild) =>
      b.replay.paths.filter((p) => p.kind !== 'movement' && p.startT >= S.decisionT).map((p) => `${p.fromActorId}>${p.toActorId}`);
    expect(passes(build('press', 'break'))).toEqual(['a-8>a-9']);
    expect(passes(build('shift', 'switch'))).toEqual(['a-8>a-far-wg']);
    expect(passes(build('shift', 'recycle'))).toEqual(['a-8>a-6', 'a-6>a-cb-f']);
    expect(passes(build('shift', null))).toEqual([]);
  });

  it('the intended pass is played only where its lane is not closed; otherwise the ball is kept', () => {
    const intended: Record<string, { to: string; mode: 'ground' | 'lofted' }> = {
      break: { to: 'a-9', mode: 'ground' },
      switch: { to: 'a-far-wg', mode: 'lofted' },
    };
    for (const outcome of OUTCOMES) {
      for (const option of Object.keys(intended)) {
        const b = build(outcome, option);
        const pos = at(b, S.decisionT);
        const lane = laneStatus(S, pos, pos.ball, pos[intended[option].to], intended[option].mode);
        const played = firstPass(b).toActorId;
        if (lane.status === 'closed') {
          expect(played, `${outcome}/${option}`).toBe('a-6');
          expect(b.author.annotations.find((a) => a.id === 'verdict')!.label).toMatch(/is closed at this moment/);
        } else {
          expect(played, `${outcome}/${option}`).toBe(intended[option].to);
        }
      }
    }
    // The two outcomes really do differ: each option is on in exactly one.
    const on = (o: string, opt: string) => firstPass(build(o, opt)).toActorId === intended[opt].to;
    expect([on('shift', 'break'), on('press', 'break')]).toEqual([false, true]);
    expect([on('shift', 'switch'), on('press', 'switch')]).toEqual([true, false]);
  });

  it('the receiver then carries or recycles: a resolve action follows every pass', () => {
    for (const outcome of OUTCOMES) {
      for (const option of OPTIONS) {
        const b = build(outcome, option);
        expect(b.duration).toBeGreaterThan(firstPass(b).endT + 0.5);
        const verdict = b.author.annotations.find((a) => a.id === 'verdict')!;
        expect(verdict.t).toBeCloseTo(firstPass(b).endT, 5);
        expect(verdict.label.length).toBeGreaterThan(30);
        expect(b.replay.paths.some((p) => p.kind === 'shot')).toBe(false);
      }
    }
  });

  it('the switch reaches the winger with the full-back far away when it is on, and the winger carries forward', () => {
    const b = build('shift', 'switch');
    const arrive = firstPass(b).endT;
    const p = at(b, arrive);
    expect(d(p.ball, p['a-far-wg'])).toBeLessThan(4);
    expect(d(p['b-far-fb'], p['a-far-wg'])).toBeGreaterThan(8);
    expect(at(b, b.duration)['a-far-wg'].x).toBeGreaterThan(p['a-far-wg'].x + 5);
    expect(b.author.annotations.find((a) => a.id === 'verdict')!.label).toMatch(/carry forward/);
  });

  it('the line-breaking pass reaches the No. 9 between the lines when it is on', () => {
    const b = build('press', 'break');
    const p = at(b, firstPass(b).endT);
    expect(d(p.ball, p['a-9'])).toBeLessThan(4);
    expect(p['a-9'].x).toBeGreaterThan(p['b-6'].x); // beyond the midfield screen
    expect(p['a-9'].x).toBeLessThan(p['b-cb-n'].x); // in front of the back line
  });

  it('does not print a caption on an arrow too short to carry it', () => {
    for (const outcome of OUTCOMES) {
      for (const option of [null, ...OPTIONS]) {
        const { replay, author } = build(outcome, option);
        const length = (p: (typeof author.paths)[number]) => d(p.from, p.to);
        for (const p of author.paths) if (p.note) expect(length(p), p.id).toBeGreaterThanOrEqual(S.minNoteLengthM!);
        // The arrows themselves are still there.
        expect(replay.paths.length).toBe(author.paths.length);
      }
    }
    // Only this scenario opts in.
    expect(OVERLAP_SCENARIO.minNoteLengthM).toBeUndefined();
  });

  it('visibleReplayAt drops spent arrows but keeps every player', () => {
    const b = build('shift', null);
    expect(visibleReplayAt(b, 13.6).actors).toHaveLength(b.replay.actors.length);
    expect(visibleReplayAt(b, 13.6).paths.length).toBeLessThan(b.replay.paths.length);
  });
});
