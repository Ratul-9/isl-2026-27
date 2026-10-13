'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import * as clockOps from '@/domain/replay/clock';
import type { PlaybackSpeed, ReplayClock } from '@/domain/replay/clock';

/**
 * The replay's playback clock. ONE requestAnimationFrame loop drives
 * everything (players, ball, arrows, captions are all derived from `time`),
 * and it is cancelled when playback stops or the component unmounts.
 */
export function useReplayClock(duration: number, keyframeTimes: readonly number[]) {
  const [clock, setClock] = useState<ReplayClock>(clockOps.INITIAL_CLOCK);

  useEffect(() => {
    if (!clock.playing) return;
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const delta = now - last;
      last = now;
      setClock((c) => clockOps.tick(c, delta, duration));
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [clock.playing, duration]);

  const play = useCallback(() => setClock((c) => clockOps.play(c, duration)), [duration]);
  const pause = useCallback(() => setClock((c) => clockOps.pause(c)), []);
  const reset = useCallback(() => setClock((c) => clockOps.reset(c)), []);
  const replay = useCallback(() => setClock((c) => clockOps.replay(c, duration)), [duration]);
  const seek = useCallback((t: number) => setClock((c) => clockOps.seek(clockOps.pause(c), t, duration)), [duration]);
  /** Seek and play in one step; `length` is for a timeline that was just extended and is not rendered yet. */
  const playFrom = useCallback(
    (t: number, length: number = duration) => setClock((c) => clockOps.play(clockOps.seek(c, t, length), length)),
    [duration],
  );
  const setSpeed = useCallback((s: PlaybackSpeed) => setClock((c) => clockOps.setSpeed(c, s)), []);
  const step = useCallback(
    (direction: 1 | -1) => setClock((c) => clockOps.step(c, direction, keyframeTimes, duration)),
    [duration, keyframeTimes],
  );

  // A shortened replay never leaves the playhead beyond its end.
  const time = Math.min(clock.time, Math.max(0, duration));
  return useMemo(
    () => ({ time, playing: clock.playing, speed: clock.speed, duration, play, pause, reset, replay, seek, playFrom, setSpeed, step }),
    [time, clock.playing, clock.speed, duration, play, pause, reset, replay, seek, playFrom, setSpeed, step],
  );
}

export type ReplayPlayback = ReturnType<typeof useReplayClock>;
