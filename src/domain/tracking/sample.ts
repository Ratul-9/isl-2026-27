import type { ReplayPoint, TeamSide, TrackingData, TrackingTrack } from '../types';
import { applyH, fitCalibration, invert, multiply } from './homography';
import type { Mat3 } from './homography';
import { PITCH_LENGTH_M, PITCH_WIDTH_M } from './landmarks';
import { HOLD_S, MAX_INTERPOLATION_GAP_S } from './limits';

/**
 * Effective positions of tracks: user edits override detections; manual calibration (when present for the
 * shot) overrides the automatic one; a rejected automatic calibration yields no position. Pure.
 */

type PointKind = 'detected' | 'interpolated' | 'manual';

export interface EffectivePoint {
  frame: number;
  point: ReplayPoint;
  kind: PointKind;
}

const MARGIN = 3 / PITCH_LENGTH_M * 100; // a little past the lines is clamped; further is unmappable

function metresToPitch(p: [number, number] | null): ReplayPoint | null {
  if (!p) return null;
  const x = (p[0] / PITCH_LENGTH_M) * 100;
  const y = (p[1] / PITCH_WIDTH_M) * 100;
  if (x < -MARGIN || x > 100 + MARGIN || y < -MARGIN || y > 100 + MARGIN) return null;
  return { x: Math.round(Math.min(100, Math.max(0, x)) * 100) / 100, y: Math.round(Math.min(100, Math.max(0, y)) * 100) / 100 };
}

/** Image -> pitch-metres homography for a frame from the shot's manual calibration, or null. */
function manualHomography(tracking: TrackingData, frame: number, manualH: (shot: number) => Mat3 | null): Mat3 | null {
  const shot = tracking.calibration.perFrame.shot[frame];
  const calib = tracking.calibration.manual[String(shot)];
  if (!calib) return null;
  const Href = manualH(shot);
  const Tref = tracking.calibration.cameraMotion[calib.referenceFrame];
  const Tf = tracking.calibration.cameraMotion[frame];
  if (!Href || !Tref || !Tf) return null;
  const TrefInv = invert(Tref);
  return TrefInv ? multiply(multiply(Href, TrefInv), Tf) : null;
}

/** How a frame is calibrated for display purposes. */
export function frameCalibrationSource(tracking: TrackingData, frame: number): 'manual' | 'keypoints' | 'propagated' | 'rejected' | 'none' {
  const shot = tracking.calibration.perFrame.shot[frame];
  if (tracking.calibration.manual[String(shot)]) return 'manual';
  const auto = tracking.calibration.perFrame.source[frame];
  if (auto === 'none' || auto === 'manual') return 'none';
  return tracking.calibration.autoRejected ? 'rejected' : auto;
}

/** Image -> pitch metres for a frame (manual first, then automatic unless rejected). */
export function frameHomography(tracking: TrackingData, frame: number, manualH: (shot: number) => Mat3 | null): Mat3 | null {
  const manual = manualHomography(tracking, frame, manualH);
  if (manual) return manual;
  if (tracking.calibration.autoRejected) return null;
  return tracking.calibration.homography[frame] ?? null;
}

export function effectivePoints(tracking: TrackingData, track: TrackingTrack, manualH: (shot: number) => Mat3 | null): EffectivePoint[] {
  const out: EffectivePoint[] = [];
  const seen = new Set<number>();
  track.obs.frame.forEach((frame, i) => {
    seen.add(frame);
    const edit = track.edits[String(frame)];
    if (edit?.kind === 'rejected') return;
    if (edit?.kind === 'position' && edit.point) {
      out.push({ frame, point: edit.point, kind: 'manual' });
      return;
    }
    const shot = tracking.calibration.perFrame.shot[frame];
    let point: ReplayPoint | null;
    if (tracking.calibration.manual[String(shot)]) {
      const H = manualHomography(tracking, frame, manualH);
      point = H ? metresToPitch(applyH(H, track.obs.foot[i])) : null;
    } else {
      point = tracking.calibration.autoRejected ? null : track.obs.pitch[i];
    }
    if (point) out.push({ frame, point, kind: track.obs.source[i] });
  });
  for (const [key, edit] of Object.entries(track.edits)) {
    const frame = Number(key);
    if (!seen.has(frame) && edit.kind === 'position' && edit.point) out.push({ frame, point: edit.point, kind: 'manual' });
  }
  return out.sort((a, b) => a.frame - b.frame);
}

export interface SampledTrack {
  track: TrackingTrack;
  point: ReplayPoint;
  /** Between two observations (drawn as an estimate) or from an interpolated/manual observation. */
  inferred: boolean;
  kind: PointKind;
}

export interface TrackingSample {
  frame: number;
  visible: SampledTrack[];
  /** Tracks that have data before and after this moment but a gap here (not drawn). */
  inGap: TrackingTrack[];
}

/** Index of the last frame at or before `tMs` (0 before the start). */
export function frameAt(tracking: TrackingData, tMs: number): number {
  const times = tracking.frameTimesMs;
  let lo = 0;
  let hi = times.length - 1;
  if (hi < 0 || tMs <= times[0]) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= tMs) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function sampleTracking(
  tracking: TrackingData,
  tMs: number,
  manualH: (shot: number) => Mat3 | null,
  cache?: Map<string, EffectivePoint[]>,
): TrackingSample {
  const times = tracking.frameTimesMs;
  const frame = frameAt(tracking, tMs);
  const maxGapMs = MAX_INTERPOLATION_GAP_S * 1000;
  const visible: SampledTrack[] = [];
  const inGap: TrackingTrack[] = [];
  for (const track of tracking.tracks) {
    if (track.hidden) continue;
    let pts = cache?.get(track.id);
    if (!pts) {
      pts = effectivePoints(tracking, track, manualH);
      cache?.set(track.id, pts);
    }
    if (pts.length === 0) continue;
    // last point at or before tMs, first after
    let lo = -1;
    for (let i = 0; i < pts.length; i++) {
      if (times[pts[i].frame] <= tMs) lo = i;
      else break;
    }
    const a = lo >= 0 ? pts[lo] : null;
    const b = lo + 1 < pts.length ? pts[lo + 1] : null;
    if (a && Math.abs(times[a.frame] - tMs) < 1e-6) {
      visible.push({ track, point: a.point, inferred: a.kind !== 'detected', kind: a.kind });
    } else if (a && b && times[b.frame] - times[a.frame] <= maxGapMs) {
      const u = (tMs - times[a.frame]) / (times[b.frame] - times[a.frame]);
      // Between two consecutive processed frames this is only display smoothing; across missing frames it is a guess.
      const adjacent = b.frame === a.frame + 1;
      const kind: PointKind = a.kind === 'manual' || b.kind === 'manual' ? 'manual' : adjacent && a.kind === 'detected' && b.kind === 'detected' ? 'detected' : 'interpolated';
      visible.push({
        track,
        point: { x: a.point.x + (b.point.x - a.point.x) * u, y: a.point.y + (b.point.y - a.point.y) * u },
        inferred: kind !== 'detected',
        kind,
      });
    } else if (a && tMs - times[a.frame] <= HOLD_S * 1000) {
      visible.push({ track, point: a.point, inferred: a.kind !== 'detected', kind: a.kind });
    } else if (a && b) {
      inGap.push(track);
    }
  }
  return { frame, visible, inGap };
}

/** Recent ball positions (pitch 0-100) up to `tMs`, split where there is a gap. */
export function ballTrail(tracking: TrackingData, tMs: number, windowMs: number, manualH: (shot: number) => Mat3 | null): ReplayPoint[][] {
  const ball = tracking.tracks.find((t) => t.objectType === 'ball' && !t.hidden);
  if (!ball) return [];
  const times = tracking.frameTimesMs;
  const pts = effectivePoints(tracking, ball, manualH).filter((p) => times[p.frame] <= tMs && times[p.frame] >= tMs - windowMs);
  const segments: ReplayPoint[][] = [];
  let current: ReplayPoint[] = [];
  let last: number | null = null;
  for (const p of pts) {
    if (last !== null && times[p.frame] - times[last] > MAX_INTERPOLATION_GAP_S * 1000) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    current.push(p.point);
    last = p.frame;
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

/** The side a track is shown as: user override, else the colour cluster's mapping, else unknown. */
export function trackSide(tracking: TrackingData, track: TrackingTrack): TeamSide | null {
  if (track.side) return track.side;
  if (track.objectType === 'referee' || track.objectType === 'ball') return null;
  if (track.team === 'A' || track.team === 'B') return tracking.teams.sideOf[track.team];
  return null;
}

/** Per-shot manual homographies (image -> pitch metres), solved once per tracking object. */
export function manualSolver(tracking: TrackingData): (shot: number) => Mat3 | null {
  const cache = new Map<number, Mat3 | null>();
  return (shot) => {
    if (!cache.has(shot)) {
      const calib = tracking.calibration.manual[String(shot)];
      let H: Mat3 | null = null;
      if (calib) {
        try {
          H = fitCalibration(calib.points.map((p) => p.image), calib.points.map((p) => p.pitchM)).H;
        } catch {
          H = null;
        }
      }
      cache.set(shot, H);
    }
    return cache.get(shot) ?? null;
  };
}
