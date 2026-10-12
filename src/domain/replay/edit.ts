import type {
  Id,
  ReplayActor,
  ReplayAnnotation,
  ReplayEvent,
  ReplayKeyframe,
  ReplayPath,
  ReplayPoint,
  TacticalReplay,
  TeamSide,
} from '../types';
import { clampReplayPoint, rotateReplayPoint } from './coords';
import { samplePositions } from './interpolate';
import { KEYFRAME_EPSILON_SECONDS, MAX_ACTORS, MAX_ANNOTATIONS, MAX_KEYFRAMES, MAX_PATHS } from './limits';

/**
 * Pure editing operations. Each returns a new replay (or the same object when
 * the edit is refused), never mutates, and never touches `original`.
 */

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const clampT = (t: number) => (Number.isFinite(t) ? Math.max(0, round3(t)) : 0);

function sortFrames(frames: ReplayKeyframe[]): ReplayKeyframe[] {
  return [...frames].sort((a, b) => a.t - b.t);
}

export function setTitle(replay: TacticalReplay, title: string): TacticalReplay {
  return { ...replay, title };
}

export function setNotes(replay: TacticalReplay, notes: string): TacticalReplay {
  return { ...replay, notes };
}

export function updateEvent(replay: TacticalReplay, patch: Partial<ReplayEvent>): TacticalReplay {
  const event = { ...replay.event, ...patch };
  event.startSeconds = clampT(event.startSeconds);
  event.endSeconds = Math.max(event.startSeconds, clampT(event.endSeconds));
  return { ...replay, event };
}

/**
 * Which team's attack this is. Changing it turns every stored position and
 * path 180° so the same play is shown attacking the other end.
 */
export function setAttackingSide(replay: TacticalReplay, side: TeamSide): TacticalReplay {
  if (side === replay.attackingSide) return { ...replay, attackingSideAssumed: false };
  const flip = (p: ReplayPoint) => rotateReplayPoint(p);
  const swap = (s: TeamSide | null): TeamSide | null => (s === null ? null : s === 'home' ? 'away' : 'home');
  return {
    ...replay,
    attackingSide: side,
    attackingSideAssumed: false,
    actors: replay.actors.map((a) => ({ ...a, side: swap(a.side), playerId: null })),
    keyframes: replay.keyframes.map((k) => ({
      ...k,
      positions: Object.fromEntries(Object.entries(k.positions).map(([id, p]) => [id, { ...p, ...flip(p) }])),
    })),
    paths: replay.paths.map((p) => ({ ...p, from: flip(p.from), to: flip(p.to) })),
    annotations: replay.annotations.map((a) => ({ ...a, point: a.point ? flip(a.point) : null })),
  };
}

// --- actors ------------------------------------------------------------------------

export function addActor(replay: TacticalReplay, actor: ReplayActor): TacticalReplay {
  if (replay.actors.length >= MAX_ACTORS) return replay;
  if (actor.kind === 'ball' && replay.actors.some((a) => a.kind === 'ball')) return replay;
  return { ...replay, actors: [...replay.actors, actor] };
}

export function updateActor(replay: TacticalReplay, id: Id, patch: Partial<Omit<ReplayActor, 'id' | 'kind'>>): TacticalReplay {
  if (!replay.actors.some((a) => a.id === id)) return replay;
  return { ...replay, actors: replay.actors.map((a) => (a.id === id ? { ...a, ...patch } : a)) };
}

/** Removes an actor with its positions; paths attached to it keep their fixed end points. */
export function removeActor(replay: TacticalReplay, id: Id): TacticalReplay {
  if (!replay.actors.some((a) => a.id === id)) return replay;
  return {
    ...replay,
    actors: replay.actors.filter((a) => a.id !== id),
    keyframes: replay.keyframes
      .map((k) => {
        const { [id]: _removed, ...rest } = k.positions;
        void _removed;
        return { ...k, positions: rest };
      })
      .filter((k) => Object.keys(k.positions).length > 0),
    paths: replay.paths.map((p) => ({
      ...p,
      fromActorId: p.fromActorId === id ? null : p.fromActorId,
      toActorId: p.toActorId === id ? null : p.toActorId,
    })),
  };
}

// --- keyframes ---------------------------------------------------------------------

/**
 * Ensures a keyframe exists at `t`. A new one is seeded with every actor's
 * current (interpolated) position so adding it changes nothing visually.
 */
export function ensureKeyframe(replay: TacticalReplay, t: number, newId: (prefix: string) => Id): { replay: TacticalReplay; keyframeId: Id } {
  const time = clampT(t);
  const near = replay.keyframes.find((k) => Math.abs(k.t - time) < KEYFRAME_EPSILON_SECONDS);
  if (near) return { replay, keyframeId: near.id };
  if (replay.keyframes.length >= MAX_KEYFRAMES) {
    const closest = [...replay.keyframes].sort((a, b) => Math.abs(a.t - time) - Math.abs(b.t - time))[0];
    return { replay, keyframeId: closest?.id ?? '' };
  }
  const sampled = samplePositions(replay, time);
  const positions: ReplayKeyframe['positions'] = {};
  for (const [actorId, p] of Object.entries(sampled)) positions[actorId] = { ...p, confidence: null, source: 'user' };
  const frame: ReplayKeyframe = { id: newId('kf'), t: time, positions };
  return { replay: { ...replay, keyframes: sortFrames([...replay.keyframes, frame]) }, keyframeId: frame.id };
}

/** Places an actor at `point` at time `t`, creating the keyframe if needed. Marks the position as the user's. */
export function moveActor(
  replay: TacticalReplay,
  actorId: Id,
  t: number,
  point: ReplayPoint,
  newId: (prefix: string) => Id,
): TacticalReplay {
  if (!replay.actors.some((a) => a.id === actorId)) return replay;
  const ensured = ensureKeyframe(replay, t, newId);
  const target = clampReplayPoint(point);
  return {
    ...ensured.replay,
    keyframes: ensured.replay.keyframes.map((k) =>
      k.id === ensured.keyframeId ? { ...k, positions: { ...k.positions, [actorId]: { ...target, confidence: null, source: 'user' } } } : k,
    ),
  };
}

export function removeKeyframe(replay: TacticalReplay, id: Id): TacticalReplay {
  const keyframes = replay.keyframes.filter((k) => k.id !== id);
  return keyframes.length === replay.keyframes.length ? replay : { ...replay, keyframes };
}

export function setKeyframeTime(replay: TacticalReplay, id: Id, t: number): TacticalReplay {
  if (!replay.keyframes.some((k) => k.id === id)) return replay;
  const time = clampT(t);
  if (replay.keyframes.some((k) => k.id !== id && Math.abs(k.t - time) < KEYFRAME_EPSILON_SECONDS)) return replay;
  return { ...replay, keyframes: sortFrames(replay.keyframes.map((k) => (k.id === id ? { ...k, t: time } : k))) };
}

// --- paths -------------------------------------------------------------------------

export function addPath(replay: TacticalReplay, path: ReplayPath): TacticalReplay {
  if (replay.paths.length >= MAX_PATHS) return replay;
  return { ...replay, paths: [...replay.paths, normalizePath(path)] };
}

export function updatePath(replay: TacticalReplay, id: Id, patch: Partial<Omit<ReplayPath, 'id'>>): TacticalReplay {
  if (!replay.paths.some((p) => p.id === id)) return replay;
  return { ...replay, paths: replay.paths.map((p) => (p.id === id ? normalizePath({ ...p, ...patch, source: 'user' }) : p)) };
}

export function removePath(replay: TacticalReplay, id: Id): TacticalReplay {
  const paths = replay.paths.filter((p) => p.id !== id);
  return paths.length === replay.paths.length ? replay : { ...replay, paths };
}

function normalizePath(path: ReplayPath): ReplayPath {
  const startT = clampT(path.startT);
  return { ...path, startT, endT: Math.max(startT, clampT(path.endT)), from: clampReplayPoint(path.from), to: clampReplayPoint(path.to) };
}

// --- annotations -------------------------------------------------------------------

export function addAnnotation(replay: TacticalReplay, annotation: ReplayAnnotation): TacticalReplay {
  if (replay.annotations.length >= MAX_ANNOTATIONS) return replay;
  const next = { ...annotation, t: clampT(annotation.t), point: annotation.point ? clampReplayPoint(annotation.point) : null };
  return { ...replay, annotations: [...replay.annotations, next].sort((a, b) => a.t - b.t) };
}

export function updateAnnotation(replay: TacticalReplay, id: Id, patch: Partial<Omit<ReplayAnnotation, 'id'>>): TacticalReplay {
  if (!replay.annotations.some((a) => a.id === id)) return replay;
  return {
    ...replay,
    annotations: replay.annotations
      .map((a) => (a.id === id ? { ...a, ...patch, t: clampT(patch.t ?? a.t) } : a))
      .sort((a, b) => a.t - b.t),
  };
}

export function removeAnnotation(replay: TacticalReplay, id: Id): TacticalReplay {
  const annotations = replay.annotations.filter((a) => a.id !== id);
  return annotations.length === replay.annotations.length ? replay : { ...replay, annotations };
}
