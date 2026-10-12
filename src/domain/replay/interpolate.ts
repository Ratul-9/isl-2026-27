import type { ReplayAnnotation, ReplayPath, ReplayPoint, TacticalReplay } from '../types';
import { clampReplayPoint } from './coords';

/**
 * Deterministic sampling of a replay at a time `t` (seconds from replay start).
 * Same replay + same t ⇒ same result; nothing here reads the clock or state.
 */

interface Key {
  t: number;
  p: ReplayPoint;
}

/** Cubic Hermite through the keys with finite-difference tangents (C¹, passes exactly through every key). */
export function interpolateTrack(keys: readonly Key[], t: number): ReplayPoint | null {
  if (keys.length === 0) return null;
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (keys.length === 1 || t <= first.t) return { ...first.p };
  if (t >= last.t) return { ...last.p };

  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i += 1;
  const k0 = keys[i];
  const k1 = keys[i + 1];
  const h = k1.t - k0.t;
  const s = (t - k0.t) / h;

  const tangent = (index: number, axis: 'x' | 'y'): number => {
    const prev = keys[Math.max(0, index - 1)];
    const next = keys[Math.min(keys.length - 1, index + 1)];
    const dt = next.t - prev.t;
    return dt > 0 ? (next.p[axis] - prev.p[axis]) / dt : 0;
  };

  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  const at = (axis: 'x' | 'y') =>
    h00 * k0.p[axis] + h10 * h * tangent(i, axis) + h01 * k1.p[axis] + h11 * h * tangent(i + 1, axis);
  // Hermite can overshoot a little between far-apart keys; the pitch bounds always hold.
  return clampReplayPoint({ x: at('x'), y: at('y') });
}

/** Keys of one actor, in time order (keyframes are kept sorted by `t`). */
function actorTrack(replay: TacticalReplay, actorId: string): Key[] {
  const keys: Key[] = [];
  for (const frame of replay.keyframes) {
    const position = frame.positions[actorId];
    if (position) keys.push({ t: frame.t, p: { x: position.x, y: position.y } });
  }
  return keys;
}

/** Where every actor is at `t`; actors with no recorded position are absent. */
export function samplePositions(replay: TacticalReplay, t: number): Record<string, ReplayPoint> {
  const out: Record<string, ReplayPoint> = {};
  for (const actor of replay.actors) {
    const p = interpolateTrack(actorTrack(replay, actor.id), t);
    if (p) out[actor.id] = p;
  }
  return out;
}

/** End point of a path at its start or end, following an attached actor when there is one. */
export function resolvePathEnd(
  replay: TacticalReplay,
  path: ReplayPath,
  which: 'from' | 'to',
): ReplayPoint {
  const actorId = which === 'from' ? path.fromActorId : path.toActorId;
  if (actorId) {
    const p = interpolateTrack(actorTrack(replay, actorId), which === 'from' ? path.startT : path.endT);
    if (p) return p;
  }
  return clampReplayPoint(which === 'from' ? path.from : path.to);
}

/** 0 before the path starts, 1 once it has finished. */
export function pathProgress(path: Pick<ReplayPath, 'startT' | 'endT'>, t: number): number {
  if (t <= path.startT) return 0;
  if (t >= path.endT || path.endT <= path.startT) return 1;
  return (t - path.startT) / (path.endT - path.startT);
}

/** The latest annotation at or before `t`, if any. */
export function activeAnnotation(replay: TacticalReplay, t: number): ReplayAnnotation | null {
  let best: ReplayAnnotation | null = null;
  for (const a of replay.annotations) {
    if (a.t <= t && (best === null || a.t >= best.t)) best = a;
  }
  return best;
}

/** Total length of the replay in seconds: the event's span, never shorter than what was placed on the timeline. */
export function replayDuration(replay: TacticalReplay): number {
  if (replay.tracking) return Math.max(0, (replay.tracking.segment.endMs - replay.tracking.segment.startMs) / 1000);
  const span = Math.max(0, replay.event.endSeconds - replay.event.startSeconds);
  const frames = replay.keyframes.reduce((m, k) => Math.max(m, k.t), 0);
  const paths = replay.paths.reduce((m, p) => Math.max(m, p.endT), 0);
  const notes = replay.annotations.reduce((m, a) => Math.max(m, a.t), 0);
  return Math.max(span, frames, paths, notes);
}
