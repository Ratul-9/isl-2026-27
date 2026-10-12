import type { Id, ReplayEvent, TacticalReplay, TrackingData, TrackingTrack } from '../types';
import { MAX_OBSERVATIONS, MAX_TRACKING_FRAMES, MAX_TRACKS } from './limits';

/** The cv-service result (schemaVersion 1) as far as DizPitch uses it. Validated by `src/tracking/schema.ts`. */
export interface TrackingServiceResult {
  schemaVersion: 1;
  source: { fileName: string | null; width: number; height: number; fps: number; durationS: number };
  segment: { startMs: number; endMs: number; frameStride: number; processedFrames: number };
  models: { role: string; name: string; licence: string }[];
  device: string;
  frames: { tMs: number[] };
  calibration: {
    status: 'calibrated' | 'partial' | 'unavailable';
    method: string;
    perFrame: { source: ('keypoints' | 'propagated' | 'manual' | 'none')[]; errorM: (number | null)[]; shot: number[] };
    homography: (number[] | null)[];
    cameraMotion: number[][];
    notes: string[];
  };
  teams: { clusters: { id: 'A' | 'B'; colorHex: string }[] };
  tracks: {
    trackId: string;
    trackerId: number | null;
    objectType: 'player' | 'goalkeeper' | 'referee' | 'ball';
    team: 'A' | 'B' | 'unknown' | null;
    mergedFrom: number[];
    observations: {
      frame: number[];
      bbox: number[][];
      foot: number[][];
      pitch: (number[] | null)[];
      confidence: (number | null)[];
      source: ('detected' | 'interpolated')[];
    };
  }[];
  warnings: string[];
}

export class TrackingImportError extends Error {}

/** Checks limits and internal consistency the schema cannot express. Throws TrackingImportError. */
export function checkServiceResult(r: TrackingServiceResult): void {
  const n = r.segment.processedFrames;
  if (n !== r.frames.tMs.length) throw new TrackingImportError('Frame count does not match the frame timestamps.');
  if (n > MAX_TRACKING_FRAMES) throw new TrackingImportError(`The analysis has ${n} frames; DizPitch keeps at most ${MAX_TRACKING_FRAMES}.`);
  if (r.tracks.length > MAX_TRACKS) throw new TrackingImportError(`The analysis has ${r.tracks.length} tracks; DizPitch keeps at most ${MAX_TRACKS}.`);
  const perFrame = [r.calibration.perFrame.source, r.calibration.perFrame.errorM, r.calibration.perFrame.shot, r.calibration.homography, r.calibration.cameraMotion];
  if (perFrame.some((a) => a.length !== n)) throw new TrackingImportError('Calibration data does not cover every frame.');
  let total = 0;
  const ids = new Set<string>();
  for (const t of r.tracks) {
    if (ids.has(t.trackId)) throw new TrackingImportError(`Track id "${t.trackId}" appears twice.`);
    ids.add(t.trackId);
    const o = t.observations;
    if (![o.bbox, o.foot, o.pitch, o.confidence, o.source].every((a) => a.length === o.frame.length)) {
      throw new TrackingImportError(`Track ${t.trackId}: observation arrays differ in length.`);
    }
    for (let i = 0; i < o.frame.length; i++) {
      if (o.frame[i] < 0 || o.frame[i] >= n || (i > 0 && o.frame[i] <= o.frame[i - 1])) {
        throw new TrackingImportError(`Track ${t.trackId}: frame indices must increase and lie inside the clip.`);
      }
    }
    total += o.frame.length;
  }
  if (total > MAX_OBSERVATIONS) throw new TrackingImportError(`The analysis has ${total} observations; DizPitch keeps at most ${MAX_OBSERVATIONS}.`);
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function trackingFromServiceResult(r: TrackingServiceResult, fileName: string): TrackingData {
  checkServiceResult(r);
  const tracks: TrackingTrack[] = r.tracks.map((t) => ({
    id: t.trackId,
    trackerId: t.trackerId,
    objectType: t.objectType,
    team: t.team,
    side: null,
    playerId: null,
    hidden: false,
    mergedFrom: [...t.mergedFrom],
    obs: {
      frame: [...t.observations.frame],
      bbox: t.observations.bbox.map((b) => [b[0], b[1], b[2], b[3]] as [number, number, number, number]),
      foot: t.observations.foot.map((f) => [f[0], f[1]] as [number, number]),
      pitch: t.observations.pitch.map((p) => (p ? { x: p[0], y: p[1] } : null)),
      confidence: [...t.observations.confidence],
      source: [...t.observations.source],
    },
    edits: {},
  }));
  return {
    schemaVersion: 1,
    source: { fileName: (r.source.fileName ?? fileName).slice(0, 120), width: r.source.width, height: r.source.height, fps: r.source.fps, durationS: r.source.durationS },
    segment: { ...r.segment },
    frameTimesMs: [...r.frames.tMs],
    calibration: {
      status: r.calibration.status,
      method: r.calibration.method,
      perFrame: { source: [...r.calibration.perFrame.source], errorM: [...r.calibration.perFrame.errorM], shot: [...r.calibration.perFrame.shot] },
      homography: r.calibration.homography.map((h) => (h ? [...h] : null)),
      cameraMotion: r.calibration.cameraMotion.map((m) => [...m]),
      notes: [...r.calibration.notes],
      autoRejected: false,
      manual: {},
    },
    // Which kit is home is the user's call; the clusters are only colours until then.
    teams: { clusters: r.teams.clusters.map((c) => ({ ...c })), sideOf: { A: null, B: null } },
    tracks,
    models: r.models.map((m) => ({ role: m.role, name: m.name, licence: m.licence })),
    device: r.device,
    warnings: [...r.warnings],
  };
}

export function replayFromTracking(tracking: TrackingData, ctx: { id: Id; now: string }): TacticalReplay {
  const { startMs, endMs } = tracking.segment;
  const event: ReplayEvent = {
    type: 'other',
    description: '',
    startSeconds: Math.round(startMs) / 1000,
    endSeconds: Math.round(endMs) / 1000,
    matchClock: '',
    period: '',
    outcome: '',
    confidence: null,
    evidence: [],
    uncertainty: [...tracking.warnings],
  };
  return {
    id: ctx.id,
    title: `Tracked clip ${mmss(startMs)}–${mmss(endMs)}`.slice(0, 80),
    createdAt: ctx.now,
    updatedAt: ctx.now,
    origin: 'tracking',
    tracking,
    attackingSide: 'home',
    attackingSideAssumed: true,
    source: null,
    original: null,
    event,
    actors: [],
    keyframes: [],
    paths: [],
    annotations: [],
    notes: '',
  };
}

/** Problems that make tracking data unusable (for save/load). Empty = fine. */
export function validateTracking(t: TrackingData): string[] {
  const errors: string[] = [];
  const n = t.segment.processedFrames;
  if (t.frameTimesMs.length !== n) errors.push('Tracking: frame times do not match the frame count.');
  const pf = t.calibration.perFrame;
  if ([pf.source, pf.errorM, pf.shot, t.calibration.homography, t.calibration.cameraMotion].some((a) => a.length !== n)) {
    errors.push('Tracking: calibration data does not cover every frame.');
  }
  const ids = new Set<string>();
  for (const track of t.tracks) {
    if (ids.has(track.id)) errors.push(`Tracking: track id "${track.id}" is used twice.`);
    ids.add(track.id);
    const o = track.obs;
    if (![o.bbox, o.foot, o.pitch, o.confidence, o.source].every((a) => a.length === o.frame.length)) errors.push(`Tracking: track ${track.id} has misaligned observations.`);
    if (o.frame.some((f, i) => f < 0 || f >= n || (i > 0 && f <= o.frame[i - 1]))) errors.push(`Tracking: track ${track.id} has invalid frame indices.`);
    if (Object.keys(track.edits).some((k) => !/^\d+$/.test(k) || Number(k) >= n)) errors.push(`Tracking: track ${track.id} has a correction outside the clip.`);
  }
  for (const [shot, m] of Object.entries(t.calibration.manual)) {
    if (m.referenceFrame < 0 || m.referenceFrame >= n || String(pf.shot[m.referenceFrame]) !== shot) errors.push('Tracking: a manual calibration refers to the wrong frame.');
  }
  return [...new Set(errors)];
}
