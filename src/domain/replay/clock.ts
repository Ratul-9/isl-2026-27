/**
 * The replay's playback clock as a pure state machine. The UI feeds it frame
 * deltas from ONE requestAnimationFrame loop; there is no per-actor timer.
 */

export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export interface ReplayClock {
  /** Seconds from the start of the replay. */
  time: number;
  playing: boolean;
  speed: PlaybackSpeed;
}

export const INITIAL_CLOCK: ReplayClock = { time: 0, playing: false, speed: 1 };

const clampTime = (t: number, duration: number) => (Number.isFinite(t) ? Math.min(Math.max(0, t), Math.max(0, duration)) : 0);

/** Advances by `deltaMs` of wall time when playing; stops (not loops) at the end. */
export function tick(clock: ReplayClock, deltaMs: number, duration: number): ReplayClock {
  if (!clock.playing || !(deltaMs > 0)) return clock;
  const next = clock.time + (deltaMs / 1000) * clock.speed;
  if (next >= duration) return { ...clock, time: Math.max(0, duration), playing: false };
  return { ...clock, time: next };
}

/** Play; from the very end this restarts from the beginning. */
export function play(clock: ReplayClock, duration: number): ReplayClock {
  if (!(duration > 0)) return { ...clock, time: 0, playing: false };
  const time = clock.time >= duration ? 0 : clock.time;
  return { ...clock, time, playing: true };
}

export function pause(clock: ReplayClock): ReplayClock {
  return clock.playing ? { ...clock, playing: false } : clock;
}

/** Back to the initial frame, stopped. */
export function reset(clock: ReplayClock): ReplayClock {
  return { ...clock, time: 0, playing: false };
}

/** Back to the start and playing straight away. */
export function replay(clock: ReplayClock, duration: number): ReplayClock {
  return play({ ...clock, time: 0 }, duration);
}

export function seek(clock: ReplayClock, time: number, duration: number): ReplayClock {
  return { ...clock, time: clampTime(time, duration) };
}

export function setSpeed(clock: ReplayClock, speed: PlaybackSpeed): ReplayClock {
  return { ...clock, speed };
}

/** Jumps to the previous/next keyframe time (pausing), or to the ends of the timeline. */
export function step(clock: ReplayClock, direction: 1 | -1, keyframeTimes: readonly number[], duration: number): ReplayClock {
  const EPS = 1e-6;
  const marks = [...new Set([0, ...keyframeTimes.map((t) => clampTime(t, duration)), Math.max(0, duration)])].sort((a, b) => a - b);
  const target =
    direction === 1
      ? (marks.find((t) => t > clock.time + EPS) ?? marks[marks.length - 1])
      : ([...marks].reverse().find((t) => t < clock.time - EPS) ?? marks[0]);
  return { ...clock, time: target, playing: false };
}
