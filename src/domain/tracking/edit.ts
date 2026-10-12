import type { Id, ManualCalibration, ReplayPoint, TeamClusterId, TeamSide, TrackingData, TrackingTrack } from '../types';
import { clampReplayPoint } from '../replay/coords';
import { fitCalibration } from './homography';
import type { Vec2 } from './homography';
import { MAX_MANUAL_POINTS } from './limits';

/** Pure edits of tracking data. Each returns a new object (or the same one when refused) and never mutates. */

export function setClusterSide(t: TrackingData, cluster: TeamClusterId, side: TeamSide | null): TrackingData {
  const sideOf = { ...t.teams.sideOf, [cluster]: side };
  // One cluster per side: giving a side to A takes it away from B.
  const other: TeamClusterId = cluster === 'A' ? 'B' : 'A';
  if (side !== null && sideOf[other] === side) sideOf[other] = side === 'home' ? 'away' : 'home';
  return { ...t, teams: { ...t.teams, sideOf } };
}

function mapTrack(t: TrackingData, id: string, fn: (track: TrackingTrack) => TrackingTrack): TrackingData {
  if (!t.tracks.some((x) => x.id === id)) return t;
  return { ...t, tracks: t.tracks.map((x) => (x.id === id ? fn(x) : x)) };
}

export function updateTrack(t: TrackingData, id: string, patch: Partial<Pick<TrackingTrack, 'side' | 'playerId' | 'hidden'>>): TrackingData {
  return mapTrack(t, id, (x) => {
    const next = { ...x, ...patch };
    // A link to a squad player is only meaningful for that player's side.
    if (patch.side !== undefined && patch.side !== x.side && patch.playerId === undefined) next.playerId = null;
    return next;
  });
}

/** Linking a squad player to one track removes that player from any other track (one player, one track). */
export function assignPlayer(t: TrackingData, id: string, playerId: Id | null): TrackingData {
  if (!t.tracks.some((x) => x.id === id)) return t;
  return {
    ...t,
    tracks: t.tracks.map((x) => (x.id === id ? { ...x, playerId } : playerId && x.playerId === playerId ? { ...x, playerId: null } : x)),
  };
}

function frames(track: TrackingTrack): Set<number> {
  return new Set([...track.obs.frame, ...Object.keys(track.edits).map(Number)]);
}

/** Joins `other` into `keep` (an identity split by the tracker). Refused when they overlap in time or mix the ball with people. */
export function mergeTracks(t: TrackingData, keepId: string, otherId: string): { tracking: TrackingData; error: string | null } {
  const keep = t.tracks.find((x) => x.id === keepId);
  const other = t.tracks.find((x) => x.id === otherId);
  if (!keep || !other || keepId === otherId) return { tracking: t, error: 'Choose two different tracks.' };
  if ((keep.objectType === 'ball') !== (other.objectType === 'ball')) return { tracking: t, error: 'The ball cannot be merged with a person.' };
  const a = frames(keep);
  if ([...frames(other)].some((f) => a.has(f))) {
    return { tracking: t, error: 'These tracks are visible at the same time, so they are different people.' };
  }
  const order = [...keep.obs.frame.map((f, i) => ({ f, src: keep, i })), ...other.obs.frame.map((f, i) => ({ f, src: other, i }))].sort((x, y) => x.f - y.f);
  const merged: TrackingTrack = {
    ...keep,
    playerId: keep.playerId ?? other.playerId,
    side: keep.side ?? other.side,
    mergedFrom: [...keep.mergedFrom, ...(other.trackerId !== null ? [other.trackerId] : []), ...other.mergedFrom],
    obs: {
      frame: order.map((o) => o.f),
      bbox: order.map((o) => o.src.obs.bbox[o.i]),
      foot: order.map((o) => o.src.obs.foot[o.i]),
      pitch: order.map((o) => o.src.obs.pitch[o.i]),
      confidence: order.map((o) => o.src.obs.confidence[o.i]),
      source: order.map((o) => o.src.obs.source[o.i]),
    },
    edits: { ...keep.edits, ...other.edits },
  };
  return { tracking: { ...t, tracks: t.tracks.filter((x) => x.id !== otherId).map((x) => (x.id === keepId ? merged : x)) }, error: null };
}

/** Places a track at a pitch position at one frame (a manual observation, distinct from detections). */
export function setPosition(t: TrackingData, id: string, frame: number, point: ReplayPoint, now: string): TrackingData {
  if (frame < 0 || frame >= t.segment.processedFrames) return t;
  const p = clampReplayPoint(point);
  return mapTrack(t, id, (x) => ({ ...x, edits: { ...x.edits, [String(frame)]: { kind: 'position', point: { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 }, at: now } } }));
}

/** Marks a track's observation at one frame as wrong (it is then ignored everywhere). */
export function rejectObservation(t: TrackingData, id: string, frame: number, now: string): TrackingData {
  const track = t.tracks.find((x) => x.id === id);
  if (!track || !track.obs.frame.includes(frame)) return t;
  return mapTrack(t, id, (x) => ({ ...x, edits: { ...x.edits, [String(frame)]: { kind: 'rejected', point: null, at: now } } }));
}

export function clearEdit(t: TrackingData, id: string, frame: number): TrackingData {
  return mapTrack(t, id, (x) => {
    if (!(String(frame) in x.edits)) return x;
    const edits = { ...x.edits };
    delete edits[String(frame)];
    return { ...x, edits };
  });
}

export function setAutoCalibrationRejected(t: TrackingData, rejected: boolean): TrackingData {
  return { ...t, calibration: { ...t.calibration, autoRejected: rejected } };
}

/** Validates and stores a manual calibration for the reference frame's shot. Throws a readable Error. */
export function setManualCalibration(t: TrackingData, referenceFrame: number, points: ManualCalibration['points']): TrackingData {
  if (referenceFrame < 0 || referenceFrame >= t.segment.processedFrames) throw new Error('That frame is outside the clip.');
  if (points.length > MAX_MANUAL_POINTS) throw new Error(`At most ${MAX_MANUAL_POINTS} landmarks.`);
  const ids = new Set(points.map((p) => p.landmark));
  if (ids.size !== points.length) throw new Error('Each landmark can be used only once.');
  const fit = fitCalibration(points.map((p) => p.image as Vec2), points.map((p) => p.pitchM as Vec2));
  const shot = t.calibration.perFrame.shot[referenceFrame];
  const manual = { ...t.calibration.manual, [String(shot)]: { referenceFrame, points, errorM: fit.errorM === null ? null : Math.round(fit.errorM * 1000) / 1000 } };
  return { ...t, calibration: { ...t.calibration, manual } };
}

export function clearManualCalibration(t: TrackingData, shot: number): TrackingData {
  if (!(String(shot) in t.calibration.manual)) return t;
  const manual = { ...t.calibration.manual };
  delete manual[String(shot)];
  return { ...t, calibration: { ...t.calibration, manual } };
}
