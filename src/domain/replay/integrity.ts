import type { Id, TacticalReplay, TeamSide } from '../types';
import { clampReplayPoint } from './coords';
import { validateTracking } from '../tracking/build';
import { trackSide } from '../tracking/sample';
import {
  MAX_ACTORS,
  MAX_ANNOTATIONS,
  MAX_KEYFRAMES,
  MAX_PATHS,
  MAX_REPLAY_SECONDS,
  MAX_TITLE,
} from './limits';

const finite = (n: number) => Number.isFinite(n);
const inPitch = (n: number) => finite(n) && n >= 0 && n <= 100;

/** Reasons a replay must not be saved as it is. An empty list means it can be saved. */
export function validateReplay(replay: TacticalReplay): string[] {
  const errors: string[] = [];
  if (replay.title.trim() === '') errors.push('Give the replay a title.');
  if (replay.title.length > MAX_TITLE) errors.push(`The title is longer than ${MAX_TITLE} characters.`);
  if (replay.actors.length > MAX_ACTORS) errors.push(`A replay can have at most ${MAX_ACTORS} players and one ball.`);
  if (replay.keyframes.length > MAX_KEYFRAMES) errors.push(`A replay can have at most ${MAX_KEYFRAMES} keyframes.`);
  if (replay.paths.length > MAX_PATHS) errors.push(`A replay can have at most ${MAX_PATHS} arrows.`);
  if (replay.annotations.length > MAX_ANNOTATIONS) errors.push(`A replay can have at most ${MAX_ANNOTATIONS} labels.`);
  if (replay.actors.filter((a) => a.kind === 'ball').length > 1) errors.push('A replay can have only one ball.');

  const unique = (label: string, ids: Id[]) => {
    if (new Set(ids).size !== ids.length) errors.push(`${label} ids must be unique.`);
  };
  unique('Player', replay.actors.map((a) => a.id));
  unique('Keyframe', replay.keyframes.map((k) => k.id));
  unique('Arrow', replay.paths.map((p) => p.id));
  unique('Label', replay.annotations.map((a) => a.id));

  const actorIds = new Set(replay.actors.map((a) => a.id));
  for (const k of replay.keyframes) {
    if (!finite(k.t) || k.t < 0 || k.t > MAX_REPLAY_SECONDS) errors.push(`A keyframe time is outside 0–${MAX_REPLAY_SECONDS} seconds.`);
    for (const [actorId, p] of Object.entries(k.positions)) {
      if (!actorIds.has(actorId)) errors.push('A keyframe places a player that is not in the replay.');
      if (!inPitch(p.x) || !inPitch(p.y)) errors.push('A position is outside the pitch.');
    }
  }
  for (const p of replay.paths) {
    if (!finite(p.startT) || !finite(p.endT) || p.startT < 0 || p.endT < p.startT || p.endT > MAX_REPLAY_SECONDS) {
      errors.push('An arrow has an invalid start or end time.');
    }
    if (![p.from.x, p.from.y, p.to.x, p.to.y].every(inPitch)) errors.push('An arrow end is outside the pitch.');
  }
  if (!(replay.event.endSeconds >= replay.event.startSeconds)) errors.push('The event ends before it starts.');
  if (replay.origin === 'tracking') {
    if (!replay.tracking) errors.push('A tracked replay needs its tracking data.');
    else errors.push(...validateTracking(replay.tracking));
  } else if (replay.tracking) {
    errors.push('Only tracked replays carry tracking data.');
  }
  return [...new Set(errors)];
}

/**
 * Loss-free repairs for data that is structurally valid but refers to things
 * that no longer exist (a removed squad player, a deleted actor). Reported as
 * warnings; nothing the user can see is changed beyond the dangling link.
 */
export function repairReplay(
  replay: TacticalReplay,
  squads: Record<TeamSide, ReadonlySet<Id>>,
): { replay: TacticalReplay; warnings: string[] } {
  let unlinked = 0;
  let dropped = 0;
  const actorIds = new Set(replay.actors.map((a) => a.id));

  const actors = replay.actors.map((a) => {
    if (a.playerId !== null && (a.side === null || !squads[a.side].has(a.playerId))) {
      unlinked += 1;
      return { ...a, playerId: null };
    }
    return a;
  });

  const keyframes = replay.keyframes
    .map((k) => {
      const positions = Object.fromEntries(
        Object.entries(k.positions).filter(([id]) => {
          const keep = actorIds.has(id);
          if (!keep) dropped += 1;
          return keep;
        }),
      );
      return {
        ...k,
        positions: Object.fromEntries(Object.entries(positions).map(([id, p]) => [id, { ...p, ...clampReplayPoint(p) }])),
      };
    })
    .sort((a, b) => a.t - b.t);

  const paths = replay.paths.map((p) => ({
    ...p,
    fromActorId: p.fromActorId !== null && actorIds.has(p.fromActorId) ? p.fromActorId : null,
    toActorId: p.toActorId !== null && actorIds.has(p.toActorId) ? p.toActorId : null,
  }));

  let tracking = replay.tracking;
  if (tracking) {
    const t = tracking;
    const linkOk = (track: (typeof t.tracks)[number]) => {
      if (track.playerId === null) return true;
      const side = trackSide(t, track);
      return side ? squads[side].has(track.playerId) : squads.home.has(track.playerId) || squads.away.has(track.playerId);
    };
    if (!t.tracks.every(linkOk)) {
      tracking = {
        ...t,
        tracks: t.tracks.map((track) => {
          if (linkOk(track)) return track;
          unlinked += 1;
          return { ...track, playerId: null };
        }),
      };
    }
  }

  const warnings: string[] = [];
  if (unlinked > 0) warnings.push(`Replay "${replay.title}": ${unlinked} player link${unlinked === 1 ? '' : 's'} to the squad no longer match and were cleared.`);
  if (dropped > 0) warnings.push(`Replay "${replay.title}": ${dropped} position${dropped === 1 ? '' : 's'} for unknown players were removed.`);
  return { replay: { ...replay, actors, keyframes, paths, tracking }, warnings };
}
