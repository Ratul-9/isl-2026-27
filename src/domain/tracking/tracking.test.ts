import { describe, expect, it } from 'vitest';
import realResult from '@/tracking/__fixtures__/real-result-147s.json';
import { asServiceResult, trackingResultSchema } from '@/tracking/schema';
import { replayFromTracking, trackingFromServiceResult, TrackingImportError, validateTracking, checkServiceResult } from './build';
import { assignPlayer, clearEdit, mergeTracks, rejectObservation, setAutoCalibrationRejected, setClusterSide, setManualCalibration, setPosition } from './edit';
import { H_10PX, track, trackingFixture } from './fixtures';
import { applyH, estimateHomography, fitCalibration, invert, multiply } from './homography';
import type { Mat3, Vec2 } from './homography';
import { LANDMARKS } from './landmarks';
import { containRect, frameBoxes, observationIndex, projectedPitchLines } from './overlay';
import { ballTrail, effectivePoints, frameAt, frameCalibrationSource, manualSolver, sampleTracking, trackSide } from './sample';
import { validateReplay } from '../replay/integrity';

const NOW = '2026-10-12T10:00:00.000Z';
const H_TRUE: Mat3 = [0.08, 0.01, -5, 0.002, 0.15, -20, 0.00001, 0.0011, 1]; // a broadcast-like perspective (image -> metres)
const inv = invert(H_TRUE)!;
const toImage = (m: Vec2) => applyH(inv, m) as Vec2;

describe('homography maths', () => {
  it('inverts and composes', () => {
    const I = multiply(H_TRUE, inv);
    I.forEach((v, i) => expect(v / I[8]).toBeCloseTo([1, 0, 0, 0, 1, 0, 0, 0, 1][i], 9));
  });

  it('recovers a known perspective from 4 and from many correspondences', () => {
    const pitch: Vec2[] = [[52.5, 0], [52.5, 68], [36, 13.84], [36, 54.16], [52.5, 34], [43.35, 34], [61.65, 34]];
    for (const k of [4, 7]) {
      const H = estimateHomography(pitch.slice(0, k).map(toImage), pitch.slice(0, k))!;
      const probe = toImage([70, 40]);
      const p = applyH(H, probe)!;
      expect(p[0]).toBeCloseTo(70, 6);
      expect(p[1]).toBeCloseTo(40, 6);
    }
  });

  it('reports a leave-one-out error and refuses degenerate input', () => {
    const pitch: Vec2[] = [[52.5, 0], [52.5, 68], [36, 13.84], [36, 54.16], [43.35, 34]];
    expect(fitCalibration(pitch.map(toImage), pitch).errorM).toBeLessThan(1e-6);
    const noisy = pitch.map(toImage).map(([x, y], i) => [x + (i === 2 ? 25 : 0), y] as Vec2);
    expect(fitCalibration(noisy, pitch).errorM!).toBeGreaterThan(0.3); // a mis-clicked point shows up
    expect(() => fitCalibration(pitch.slice(0, 3).map(toImage), pitch.slice(0, 3))).toThrow(/At least 4/);
    const line: Vec2[] = [[0, 0], [0, 10], [0, 20], [0, 30]];
    expect(() => fitCalibration(line.map(toImage), line)).toThrow(/one line/);
  });

  it('has a unique id and a position on the template for every landmark', () => {
    expect(new Set(LANDMARKS.map((l) => l.id)).size).toBe(LANDMARKS.length);
    for (const l of LANDMARKS) {
      expect(l.pitchM[0]).toBeGreaterThanOrEqual(0);
      expect(l.pitchM[0]).toBeLessThanOrEqual(105);
      expect(l.pitchM[1]).toBeGreaterThanOrEqual(0);
      expect(l.pitchM[1]).toBeLessThanOrEqual(68);
    }
  });
});

describe('real cv-service output', () => {
  it('passes the transport schema and becomes valid tracking data with the same positions', () => {
    const parsed = trackingResultSchema.parse(realResult);
    const tracking = trackingFromServiceResult(asServiceResult(parsed), 'test_clip.mp4');
    expect(validateTracking(tracking)).toEqual([]);
    expect(tracking.segment.processedFrames).toBe(50);
    expect(tracking.tracks.length).toBe(parsed.tracks.length);
    const t = tracking.tracks.find((x) => x.obs.pitch.some(Boolean))!;
    const i = t.obs.pitch.findIndex(Boolean);
    expect(t.obs.pitch[i]).toEqual({ x: parsed.tracks.find((x) => x.trackId === t.id)!.observations.pitch[i]![0], y: expect.any(Number) });
    // Nothing is linked to the squad or given a side automatically.
    expect(tracking.tracks.every((x) => x.playerId === null && x.side === null)).toBe(true);
    expect(tracking.teams.sideOf).toEqual({ A: null, B: null });
    const replay = replayFromTracking(tracking, { id: 'r1', now: NOW });
    expect(validateReplay(replay)).toEqual([]);
    expect(replay.origin).toBe('tracking');
  });

  it('rejects inconsistent results with a readable error', () => {
    const parsed = asServiceResult(trackingResultSchema.parse(realResult));
    const broken = { ...parsed, frames: { tMs: parsed.frames.tMs.slice(1) } };
    expect(() => checkServiceResult(broken)).toThrow(TrackingImportError);
    const badTrack = structuredClone(parsed);
    badTrack.tracks[0].observations.frame = [...badTrack.tracks[0].observations.frame].reverse();
    expect(() => checkServiceResult(badTrack)).toThrow(/increase/);
    expect(trackingResultSchema.safeParse({ ...realResult, schemaVersion: 2 }).success).toBe(false);
  });
});

describe('sampling tracks at a time', () => {
  // Player moves 1 m per frame along x; frames 0-9 seen, 10-24 missing (0.6 s gap), 25-30 seen again.
  const frames = [...Array.from({ length: 10 }, (_, i) => i), ...Array.from({ length: 6 }, (_, i) => 25 + i)];
  const t1 = track('t1', frames, (f) => [20 + f, 30]);
  const tracking = trackingFixture(50, 25, [t1]);
  const solve = manualSolver(tracking);

  it('shows detections exactly, interpolates short gaps as inferred, and leaves long gaps empty', () => {
    expect(frameAt(tracking, 0)).toBe(0);
    expect(frameAt(tracking, 81)).toBe(2);
    const exact = sampleTracking(tracking, 80, solve).visible[0];
    expect(exact.point.x).toBeCloseTo(((20 + 2) / 105) * 100, 5);
    expect(exact.inferred).toBe(false);
    const between = sampleTracking(tracking, 100, solve).visible[0]; // between consecutive frames 2 and 3: smoothing only
    expect(between.inferred).toBe(false);
    expect(between.point.x).toBeCloseTo(((20 + 2.5) / 105) * 100, 5);
    const short = rejectObservation(tracking, 't1', 5, NOW); // frames 4 -> 6: one frame missing
    const guessed = sampleTracking(short, 200, manualSolver(short)).visible[0];
    expect(guessed).toMatchObject({ inferred: true, kind: 'interpolated' });
    const gap = sampleTracking(tracking, 600, solve); // frame 15: inside the 0.6 s gap
    expect(gap.visible).toHaveLength(0);
    expect(gap.inGap.map((t) => t.id)).toEqual(['t1']);
  });

  it('applies edits: a rejected observation is skipped; a manual position wins', () => {
    let t = rejectObservation(tracking, 't1', 3, NOW);
    expect(effectivePoints(t, t.tracks[0], manualSolver(t)).some((p) => p.frame === 3)).toBe(false);
    t = setPosition(t, 't1', 4, { x: 10, y: 10 }, NOW);
    const p = effectivePoints(t, t.tracks[0], manualSolver(t)).find((q) => q.frame === 4)!;
    expect(p).toEqual({ frame: 4, point: { x: 10, y: 10 }, kind: 'manual' });
    t = setPosition(t, 't1', 15, { x: 50, y: 50 }, NOW); // a manual point inside the gap
    expect(sampleTracking(t, 600, manualSolver(t)).visible[0].kind).toBe('manual');
    t = clearEdit(t, 't1', 4);
    expect(effectivePoints(t, t.tracks[0], manualSolver(t)).find((q) => q.frame === 4)!.kind).toBe('detected');
    expect(rejectObservation(tracking, 't1', 12, NOW)).toBe(tracking); // no observation there: refused
  });

  it('a rejected automatic calibration yields no positions; image tracking stays', () => {
    const t = setAutoCalibrationRejected(tracking, true);
    expect(effectivePoints(t, t.tracks[0], manualSolver(t))).toHaveLength(0);
    expect(frameCalibrationSource(t, 0)).toBe('rejected');
    expect(t.tracks[0].obs.bbox).toHaveLength(frames.length);
  });

  it('hidden tracks are not drawn and the ball trail breaks at gaps', () => {
    const ball = track('ball', [0, 1, 2, 3, 20, 21], (f) => [50 + f, 34], { objectType: 'ball', team: null, trackerId: null });
    let t = trackingFixture(50, 25, [t1, ball]);
    const segments = ballTrail(t, 900, 1000, manualSolver(t));
    expect(segments.map((s) => s.length)).toEqual([4, 2]);
    t = { ...t, tracks: t.tracks.map((x) => (x.id === 't1' ? { ...x, hidden: true } : x)) };
    expect(sampleTracking(t, 0, manualSolver(t)).visible.map((v) => v.track.id)).toEqual(['ball']);
  });
});

describe('manual calibration', () => {
  it('maps foot points through the clicked landmarks and follows the camera across a pan', () => {
    // Frame 10 is panned 100 px to the right of frame 0 (camera motion: frame -> first frame of the shot).
    const n = 20;
    const base = trackingFixture(n, 25, []);
    const motion = Array.from({ length: n }, (_, f) => [1, 0, f >= 10 ? 100 : 0, 0, 1, 0, 0, 0, 1]);
    const H_frame0 = H_TRUE; // image of frame 0 -> metres
    const toImg0 = (m: Vec2) => applyH(invert(H_frame0)!, m) as Vec2;
    const at10 = (m: Vec2): Vec2 => {
      const p = toImg0(m);
      return [p[0] - 100, p[1]];
    };
    const ids = ['halfway-far', 'halfway-near', 'Left-box-far', 'Left-box-near', 'centre-spot'];
    const points = ids.map((id) => {
      const l = LANDMARKS.find((x) => x.id === id)!;
      return { landmark: id, pitchM: l.pitchM, image: at10(l.pitchM) };
    });
    const player = track('t7', [10, 12], () => [0, 0]);
    player.obs.foot = [at10([60, 40]), toImg0([61, 41]).map((v, i) => (i === 0 ? v - 100 : v)) as [number, number]];
    let t = { ...base, calibration: { ...base.calibration, cameraMotion: motion, autoRejected: true }, tracks: [player] };
    t = setManualCalibration(t, 10, points);
    expect(t.calibration.manual['0'].errorM).toBeLessThan(1e-6);
    const pts = effectivePoints(t, t.tracks[0], manualSolver(t));
    expect(pts[0].point.x).toBeCloseTo((60 / 105) * 100, 2); // positions are stored to 1/100 of a unit
    expect(pts[0].point.y).toBeCloseTo((40 / 68) * 100, 2);
    expect(frameCalibrationSource(t, 3)).toBe('manual'); // same shot, earlier frame, via camera motion
    expect(() => setManualCalibration(t, 10, [...points.slice(0, 3), points[0]])).toThrow(/once/);
  });
});

describe('editing tracks', () => {
  const a = track('t1', [0, 1, 2], (f) => [10 + f, 10]);
  const b = track('t2', [5, 6], (f) => [15 + f, 10], { trackerId: 2 });
  const c = track('t3', [2, 3], (f) => [30 + f, 30], { trackerId: 3 });
  const ball = track('ball', [0, 4], () => [50, 34], { objectType: 'ball', team: null, trackerId: null });
  const base = trackingFixture(10, 25, [a, b, c, ball]);

  it('merges a fragment that does not overlap and records provenance', () => {
    const { tracking, error } = mergeTracks(base, 't1', 't2');
    expect(error).toBeNull();
    const merged = tracking.tracks.find((t) => t.id === 't1')!;
    expect(merged.obs.frame).toEqual([0, 1, 2, 5, 6]);
    expect(merged.mergedFrom).toEqual([2]);
    expect(tracking.tracks.some((t) => t.id === 't2')).toBe(false);
  });

  it('refuses merges of overlapping tracks and of the ball with a person', () => {
    expect(mergeTracks(base, 't1', 't3').error).toMatch(/same time/);
    expect(mergeTracks(base, 't1', 'ball').error).toMatch(/ball/);
    expect(mergeTracks(base, 't1', 't1').error).toBeTruthy();
  });

  it('maps colour clusters to sides one-to-one and links a squad player to one track only', () => {
    let t = setClusterSide(base, 'A', 'home');
    t = setClusterSide(t, 'B', 'home');
    expect(t.teams.sideOf).toEqual({ A: 'away', B: 'home' });
    expect(trackSide(t, t.tracks[0])).toBe('away');
    expect(trackSide(t, t.tracks.find((x) => x.objectType === 'ball')!)).toBeNull();
    t = assignPlayer(t, 't1', 'p9');
    t = assignPlayer(t, 't3', 'p9');
    expect(t.tracks.find((x) => x.id === 't1')!.playerId).toBeNull();
    expect(t.tracks.find((x) => x.id === 't3')!.playerId).toBe('p9');
  });

  it('clamps manual positions to the pitch and ignores frames outside the clip', () => {
    const t = setPosition(base, 't1', 1, { x: 140, y: -5 }, NOW);
    expect(t.tracks[0].edits['1']).toEqual({ kind: 'position', point: { x: 100, y: 0 }, at: NOW });
    expect(setPosition(base, 't1', 99, { x: 1, y: 1 }, NOW)).toBe(base);
  });

  it('validation catches corrupted data', () => {
    const bad = { ...base, tracks: [{ ...a, obs: { ...a.obs, frame: [0, 2, 1] } }] };
    expect(validateTracking(bad).join(' ')).toMatch(/invalid frame/);
    const badEdit = { ...base, tracks: [{ ...a, edits: { '99': { kind: 'rejected' as const, point: null, at: NOW } } }] };
    expect(validateTracking(badEdit).join(' ')).toMatch(/outside the clip/);
  });

  it('the fixture camera maps 10 px to 1 m', () => {
    expect(applyH(H_10PX, [525, 340])).toEqual([52.5, 34]);
  });
});

describe('video overlay geometry', () => {
  it('letterboxes like object-fit: contain', () => {
    expect(containRect(854, 480, 854, 600)).toEqual({ x: 0, y: 60, scale: 1 });
    expect(containRect(1280, 720, 640, 640)).toEqual({ x: 0, y: 140, scale: 0.5 });
  });

  it('projects the pitch markings into the image with the inverse of the calibration', () => {
    const lines = projectedPitchLines(H_TRUE, 1280, 720);
    expect(lines.length).toBeGreaterThan(5);
    // The halfway line's ends land where the known camera puts them.
    const far = toImage([52.5, 0]);
    expect(lines.flat().some((p) => Math.hypot(p[0] - far[0], p[1] - far[1]) < 1e-6)).toBe(true);
  });

  it('lists the boxes at a frame with their correction state', () => {
    const a = track('t1', [0, 1, 2], (f) => [10 + f, 10]);
    let t = trackingFixture(5, 25, [a, track('t2', [1], () => [20, 20], { hidden: true })]);
    t = rejectObservation(t, 't1', 1, NOW);
    const boxes = frameBoxes(t, 1);
    expect(boxes.map((b) => [b.track.id, b.rejected])).toEqual([['t1', true]]);
    expect(observationIndex(a, 2)).toBe(2);
    expect(observationIndex(a, 3)).toBe(-1);
  });
});
