import { describe, expect, it } from 'vitest';
import { PITCH_LENGTH, PITCH_WIDTH, toView } from '../geometry';
import type { TacticalReplay } from '../types';
import { replayFromAnalysis, emptyReplay, mapClipTime } from './build';
import * as clock from './clock';
import {
  canonicalToReplay,
  clampReplayPoint,
  replayToCanonical,
  replayToView,
  rotateReplayPoint,
  teamFrameToReplay,
  viewToReplay,
} from './coords';
import {
  addActor,
  addPath,
  ensureKeyframe,
  moveActor,
  removeActor,
  removeKeyframe,
  setAttackingSide,
  setKeyframeTime,
  updateEvent,
  updatePath,
} from './edit';
import { counterIds, sampleAnalysis, sampleReplay, SAMPLE_SOURCE } from './fixtures';
import { repairReplay, validateReplay } from './integrity';
import {
  activeAnnotation,
  interpolateTrack,
  pathProgress,
  replayDuration,
  resolvePathEnd,
  samplePositions,
} from './interpolate';
import { MAX_KEYFRAMES } from './limits';

const ids = counterIds;

describe('coordinates', () => {
  it('maps replay 0–100 to the app’s normalised frame and back', () => {
    expect(replayToCanonical({ x: 50, y: 25 })).toEqual({ x: 0.5, y: 0.25 });
    expect(canonicalToReplay({ x: 0.2, y: 0.9 })).toEqual({ x: 20, y: 90 });
  });

  it('clamps out-of-range and non-finite values to the pitch', () => {
    expect(clampReplayPoint({ x: -5, y: 140 })).toEqual({ x: 0, y: 100 });
    expect(clampReplayPoint({ x: Number.NaN, y: Infinity })).toEqual({ x: 50, y: 50 });
  });

  it('keeps a home attack as is and turns an away attack 180°', () => {
    const p = { x: 82, y: 30 };
    expect(teamFrameToReplay(p, 'home')).toEqual(p);
    expect(teamFrameToReplay(p, 'away')).toEqual({ x: 18, y: 70 });
    expect(rotateReplayPoint(rotateReplayPoint(p))).toEqual(p);
  });

  it('round-trips through view units in both orientations and agrees with the board mapping', () => {
    for (const o of ['landscape', 'portrait'] as const) {
      for (const p of [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 33.3, y: 71.2 }]) {
        const back = viewToReplay(replayToView(p, o), o);
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);
      }
    }
    // Same metres as a board marker at the same canonical point.
    expect(replayToView({ x: 100, y: 100 }, 'landscape')).toEqual(toView({ x: 1, y: 1 }, 'landscape'));
    expect(replayToView({ x: 100, y: 100 }, 'landscape')).toEqual({ x: PITCH_LENGTH, y: PITCH_WIDTH });
  });
});

describe('interpolation', () => {
  const keys = [
    { t: 0, p: { x: 10, y: 10 } },
    { t: 2, p: { x: 50, y: 30 } },
    { t: 6, p: { x: 90, y: 70 } },
  ];

  it('passes exactly through every key and holds outside the range', () => {
    for (const k of keys) expect(interpolateTrack(keys, k.t)).toEqual(k.p);
    expect(interpolateTrack(keys, -3)).toEqual(keys[0].p);
    expect(interpolateTrack(keys, 99)).toEqual(keys[2].p);
    expect(interpolateTrack([], 1)).toBeNull();
    expect(interpolateTrack([keys[1]], 5)).toEqual(keys[1].p);
  });

  it('moves monotonically through intermediate times and is deterministic', () => {
    const a = interpolateTrack(keys, 1);
    const b = interpolateTrack(keys, 1);
    expect(a).toEqual(b);
    expect(a!.x).toBeGreaterThan(10);
    expect(a!.x).toBeLessThan(50);
  });

  it('never leaves the pitch even with sharp turns between far keys', () => {
    const wild = [
      { t: 0, p: { x: 0, y: 0 } },
      { t: 0.1, p: { x: 100, y: 100 } },
      { t: 0.2, p: { x: 0, y: 0 } },
      { t: 5, p: { x: 100, y: 0 } },
    ];
    for (let t = 0; t <= 5; t += 0.05) {
      const p = interpolateTrack(wild, t)!;
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(100);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(100);
    }
  });
});

describe('timestamp mapping and building a replay from an analysis', () => {
  it('maps clip seconds onto the replay timeline relative to the event start', () => {
    expect(mapClipTime(7.5, 4)).toBe(3.5);
    expect(mapClipTime(4, 4)).toBe(0);
    expect(mapClipTime(2, 4)).toBe(0); // before the event: clamped, never negative
    expect(mapClipTime(Number.NaN, 4)).toBe(0);
  });

  it('builds a replay whose timeline starts at the event and keeps the AI output untouched', () => {
    const analysis = sampleAnalysis();
    const before = JSON.stringify(analysis);
    const r = replayFromAnalysis(analysis, { id: 'rpl-x', newId: ids(), now: 'T', source: SAMPLE_SOURCE, attackingSide: 'home' });
    expect(JSON.stringify(analysis)).toBe(before);
    expect(r.original).toEqual(analysis);
    expect(r.keyframes.map((k) => k.t)).toEqual([0, 2, 5]);
    expect(r.paths.map((p) => [p.kind, p.startT, p.endT])).toEqual([
      ['pass', 1, 2],
      ['shot', 3.5, 5],
    ]);
    expect(r.annotations.map((a) => [a.t, a.label])).toEqual([[1, 'Through ball'], [3.5, 'Shot'], [5, 'Save']]);
    expect(r.event.startSeconds).toBe(4);
    expect(replayDuration(r)).toBeGreaterThanOrEqual(5);
    expect(r.title).toBe("Shot on target · 67:12");
    expect(r.origin).toBe('ai');
  });

  it('does not carry a name or shirt number the model was not sure of', () => {
    const r = sampleReplay();
    const byLabel = Object.fromEntries(r.actors.map((a) => [a.label, a]));
    expect(byLabel['Attacker 1']).toMatchObject({ name: 'Number Eight', shirtNumber: 8 });
    expect(byLabel['Attacker 2']).toMatchObject({ name: '', shirtNumber: null }); // 0.3 confidence, no evidence
    expect(byLabel['Defender 1']).toMatchObject({ name: '', shirtNumber: null });
    // The original text is still on record.
    expect(r.original!.actors[1].name).toBe('Guess Name');
  });

  it('assigns sides and rotates an away attack onto the correct end of the pitch', () => {
    const home = sampleReplay({ attackingSide: 'home' });
    const away = sampleReplay({ attackingSide: 'away' });
    const att = (r: TacticalReplay) => r.actors.find((a) => a.label === 'Attacker 1')!;
    const def = (r: TacticalReplay) => r.actors.find((a) => a.label === 'Defender 1')!;
    expect([att(home).side, def(home).side]).toEqual(['home', 'away']);
    expect([att(away).side, def(away).side]).toEqual(['away', 'home']);
    const ball = (r: TacticalReplay) => r.actors.find((a) => a.kind === 'ball')!;
    expect(ball(home).side).toBeNull();
    expect(home.keyframes[0].positions[att(home).id]).toMatchObject({ x: 55, y: 50 });
    expect(away.keyframes[0].positions[att(away).id]).toMatchObject({ x: 45, y: 50 });
    expect(away.attackingSideAssumed).toBe(false);
  });

  it('flags the attacking side as assumed when it was not provided', () => {
    const r = replayFromAnalysis(sampleAnalysis(), { id: 'r', newId: ids(), now: 'T', source: null });
    expect(r.attackingSide).toBe('home');
    expect(r.attackingSideAssumed).toBe(true);
  });

  it('makes an uncertain, empty replay when no event was recognised', () => {
    const a = { ...sampleAnalysis(), primaryEvent: null, keyframes: [], trajectories: [], timeline: [], summary: 'Crowd shot.' };
    const r = replayFromAnalysis(a, { id: 'r', newId: ids(), now: 'T', source: SAMPLE_SOURCE });
    expect(r.event.type).toBe('uncertain');
    expect(r.event.uncertainty[0]).toMatch(/No football event/);
    expect(validateReplay(r)).toEqual([]);
  });

  it('merges keyframes that land on the same replay time', () => {
    const a = sampleAnalysis();
    a.keyframes.push({ timeSeconds: 6.01, note: null, positions: [{ actorId: 'd1', x: 80, y: 50, confidence: 0.4, basis: 'estimated' }] });
    const r = replayFromAnalysis(a, { id: 'r', newId: ids(), now: 'T', source: null, attackingSide: 'home' });
    // 6.01s in the clip is the same moment as 6s (replay 2s): one keyframe, positions merged.
    expect(r.keyframes.map((k) => k.t)).toEqual([0, 2, 5]);
    const defender = r.actors.find((x) => x.label === 'Defender 1')!;
    expect(r.keyframes[1].positions[defender.id]).toMatchObject({ x: 80 }); // the later value wins
  });
});

describe('sampling a replay', () => {
  const r = sampleReplay();
  const ball = r.actors.find((a) => a.kind === 'ball')!;
  const attacker2 = r.actors.find((a) => a.label === 'Attacker 2')!;

  it('puts every actor with a recorded position on the pitch and the ball on its keyframe', () => {
    const at0 = samplePositions(r, 0);
    expect(at0[ball.id]).toEqual({ x: 55, y: 50 });
    expect(Object.keys(at0)).toHaveLength(5);
    expect(samplePositions(r, 2)[ball.id]).toEqual({ x: 82, y: 46 });
  });

  it('holds an actor’s last known position when later keyframes omit it', () => {
    expect(samplePositions(r, 5)[attacker2.id]).toEqual({ x: 82, y: 46 });
  });

  it('is deterministic and independent of calling order', () => {
    const forward = [0, 1, 2, 3, 4, 5].map((t) => samplePositions(r, t));
    const backward = [5, 4, 3, 2, 1, 0].map((t) => samplePositions(r, t)).reverse();
    expect(backward).toEqual(forward);
  });

  it('path progress and attached ends follow the actors', () => {
    const pass = r.paths[0];
    expect(pathProgress(pass, 0)).toBe(0);
    expect(pathProgress(pass, 1.5)).toBeCloseTo(0.5);
    expect(pathProgress(pass, 9)).toBe(1);
    expect(resolvePathEnd(r, pass, 'from')).toMatchObject({ x: expect.any(Number) });
    const moved = moveActor(r, pass.fromActorId!, pass.startT, { x: 40, y: 20 }, ids());
    expect(resolvePathEnd(moved, pass, 'from')).toEqual({ x: 40, y: 20 });
  });

  it('shows the latest annotation at or before the time', () => {
    expect(activeAnnotation(r, 0)).toBeNull();
    expect(activeAnnotation(r, 1.2)!.label).toBe('Through ball');
    expect(activeAnnotation(r, 4)!.label).toBe('Shot');
  });
});

describe('playback clock', () => {
  const D = 10;
  it('plays at the chosen speed, stops at the end (no loop) and can replay', () => {
    let c = clock.play(clock.INITIAL_CLOCK, D);
    expect(c.playing).toBe(true);
    c = clock.tick(c, 2000, D);
    expect(c.time).toBeCloseTo(2);
    c = clock.tick(clock.setSpeed(c, 2), 1000, D);
    expect(c.time).toBeCloseTo(4);
    c = clock.tick(c, 60_000, D);
    expect(c).toMatchObject({ time: D, playing: false });
    expect(clock.play(c, D)).toMatchObject({ time: 0, playing: true }); // play at the end restarts
    expect(clock.replay(c, D)).toMatchObject({ time: 0, playing: true });
  });

  it('pauses, resets and seeks without ever leaving the timeline', () => {
    let c = clock.play(clock.INITIAL_CLOCK, D);
    c = clock.tick(c, 3000, D);
    const paused = clock.pause(c);
    expect(clock.tick(paused, 5000, D)).toBe(paused); // paused clocks do not move
    expect(clock.reset(c)).toEqual({ time: 0, playing: false, speed: 1 });
    expect(clock.seek(c, 99, D).time).toBe(D);
    expect(clock.seek(c, -4, D).time).toBe(0);
    expect(clock.seek(c, Number.NaN, D).time).toBe(0);
    expect(clock.play(clock.INITIAL_CLOCK, 0).playing).toBe(false);
  });

  it('steps between keyframes and the ends, pausing', () => {
    const marks = [1, 4];
    let c = clock.seek(clock.INITIAL_CLOCK, 0, D);
    c = clock.step(c, 1, marks, D);
    expect(c.time).toBe(1);
    c = clock.step(c, 1, marks, D);
    expect(c.time).toBe(4);
    c = clock.step(c, 1, marks, D);
    expect(c.time).toBe(D);
    c = clock.step(c, -1, marks, D);
    expect(c.time).toBe(4);
    expect(clock.step(clock.INITIAL_CLOCK, -1, marks, D).time).toBe(0);
    expect(clock.step({ ...c, playing: true }, 1, marks, D).playing).toBe(false);
  });
});

describe('editing', () => {
  it('moving a player creates a seeded keyframe and marks the position as the user’s', () => {
    const r = sampleReplay();
    const a = r.actors.find((x) => x.label === 'Attacker 1')!;
    const next = moveActor(r, a.id, 3, { x: 61, y: 33 }, ids());
    expect(next.keyframes).toHaveLength(r.keyframes.length + 1);
    const created = next.keyframes.find((k) => k.t === 3)!;
    expect(created.positions[a.id]).toMatchObject({ x: 61, y: 33, source: 'user' });
    // Everyone else is held exactly where they already were at t=3.
    const before = samplePositions(r, 3);
    for (const other of r.actors.filter((x) => x.id !== a.id)) {
      expect(created.positions[other.id]).toMatchObject(before[other.id]);
    }
    expect(next.original).toBe(r.original);
    expect(r.keyframes).toHaveLength(3); // input untouched
  });

  it('reuses a keyframe at (almost) the same time and clamps to the pitch', () => {
    const r = sampleReplay();
    const a = r.actors[0];
    const { replay, keyframeId } = ensureKeyframe(r, 2.01, ids());
    expect(replay).toBe(r);
    expect(keyframeId).toBe(r.keyframes[1].id);
    const moved = moveActor(r, a.id, 2, { x: 500, y: -30 }, ids());
    expect(moved.keyframes[1].positions[a.id]).toMatchObject({ x: 100, y: 0 });
  });

  it('refuses to exceed the keyframe limit and edits to unknown ids are no-ops', () => {
    let r = sampleReplay();
    const next = ids();
    for (let i = 0; i < MAX_KEYFRAMES + 5; i++) r = ensureKeyframe(r, 20 + i, next).replay;
    expect(r.keyframes.length).toBe(MAX_KEYFRAMES);
    const base = sampleReplay();
    expect(moveActor(base, 'nope', 1, { x: 1, y: 1 }, ids())).toBe(base);
    expect(removeKeyframe(base, 'nope')).toBe(base);
    expect(setKeyframeTime(base, base.keyframes[0].id, 2)).toBe(base); // collides with the keyframe at t=2
  });

  it('removing an actor drops its positions and detaches arrows', () => {
    const r = sampleReplay();
    const a = r.actors.find((x) => x.label === 'Attacker 1')!;
    const next = removeActor(r, a.id);
    expect(next.actors.some((x) => x.id === a.id)).toBe(false);
    expect(next.keyframes.every((k) => !(a.id in k.positions))).toBe(true);
    expect(next.paths[0].fromActorId).toBeNull();
    expect(validateReplay(next)).toEqual([]);
  });

  it('flipping the attacking side twice restores every position', () => {
    const r = sampleReplay();
    const once = setAttackingSide(r, 'away');
    expect(once.attackingSide).toBe('away');
    expect(once.keyframes[0].positions[r.actors[0].id]).toMatchObject({ x: 45, y: 50 });
    const twice = setAttackingSide(once, 'home');
    expect(twice.keyframes).toEqual(r.keyframes);
    expect(twice.paths.map((p) => [p.from, p.to])).toEqual(r.paths.map((p) => [p.from, p.to]));
  });

  it('keeps paths and the event consistent when edited', () => {
    const r = sampleReplay();
    const p = updatePath(r, r.paths[0].id, { startT: 4, endT: 1, to: { x: 120, y: -2 } });
    expect(p.paths[0]).toMatchObject({ startT: 4, endT: 4, to: { x: 100, y: 0 }, source: 'user' });
    const e = updateEvent(r, { startSeconds: 9, endSeconds: 2 });
    expect(e.event.endSeconds).toBe(9);
    const added = addPath(r, { ...r.paths[0], id: 'new' });
    expect(added.paths).toHaveLength(r.paths.length + 1);
  });

  it('allows only one ball', () => {
    const r = emptyReplay({ id: 'r', newId: ids(), now: 'T' });
    const second = addActor(r, { id: 'b2', kind: 'ball', side: null, label: 'Ball', shirtNumber: null, name: '', playerId: null, confidence: null, evidence: '' });
    expect(second).toBe(r);
    expect(validateReplay(r)).toEqual([]);
  });
});

describe('integrity', () => {
  it('flags invalid replays with readable reasons', () => {
    const r = sampleReplay();
    const bad: TacticalReplay = {
      ...r,
      title: '  ',
      keyframes: [{ ...r.keyframes[0], positions: { ghost: { x: 140, y: 5, confidence: null, source: 'ai' } } }],
      paths: [{ ...r.paths[0], startT: 5, endT: 1 }],
    };
    const errors = validateReplay(bad);
    expect(errors).toEqual(
      expect.arrayContaining([
        'Give the replay a title.',
        'A keyframe places a player that is not in the replay.',
        'A position is outside the pitch.',
        'An arrow has an invalid start or end time.',
      ]),
    );
  });

  it('clears dangling squad links and positions of unknown actors without touching anything else', () => {
    const r = sampleReplay();
    const linked = { ...r, actors: r.actors.map((a, i) => (i === 0 ? { ...a, playerId: 'gone' } : a)) };
    const withGhost = { ...linked, keyframes: linked.keyframes.map((k, i) => (i === 0 ? { ...k, positions: { ...k.positions, ghost: { x: 1, y: 1, confidence: null, source: 'ai' as const } } } : k)) };
    const { replay, warnings } = repairReplay(withGhost, { home: new Set(['p1']), away: new Set() });
    expect(replay.actors[0].playerId).toBeNull();
    expect('ghost' in replay.keyframes[0].positions).toBe(false);
    expect(warnings).toHaveLength(2);
    expect(replay.title).toBe(r.title);
  });
});
