'use client';

import { Pause, Play, RotateCcw, SkipBack, SkipForward, StepBack, StepForward } from 'lucide-react';
import { PLAYBACK_SPEEDS } from '@/domain/replay/clock';
import type { PlaybackSpeed } from '@/domain/replay/clock';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import type { ReplayPlayback } from './useReplayClock';

const format = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;

/** Transport controls for a replay: play, pause, reset, replay, scrub, speed, step. Never touches match data. */
export function ReplayControls({ playback, stepUnit = 'keyframe', seekStep = 0.05 }: { playback: ReplayPlayback; stepUnit?: 'keyframe' | 'frame' | 'stage'; seekStep?: number }) {
  const { time, duration, playing, speed } = playback;
  const atEnd = duration > 0 && time >= duration;
  const empty = !(duration > 0);

  return (
    <div role="group" aria-label="Replay controls" className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => playback.step(-1)} disabled={empty} aria-label={`Previous ${stepUnit}`} title={`Previous ${stepUnit}`}>
          <StepBack size={15} aria-hidden />
        </Button>
        {playing ? (
          <Button size="sm" variant="primary" onClick={playback.pause} aria-label="Pause" title="Pause">
            <Pause size={15} aria-hidden /> <span className="hidden sm:inline">Pause</span>
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={playback.play} disabled={empty} aria-label={atEnd ? 'Play again' : 'Play'} title="Play">
            <Play size={15} aria-hidden /> <span className="hidden sm:inline">{atEnd ? 'Play again' : 'Play'}</span>
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => playback.step(1)} disabled={empty} aria-label={`Next ${stepUnit}`} title={`Next ${stepUnit}`}>
          <StepForward size={15} aria-hidden />
        </Button>
        <Button size="sm" onClick={playback.reset} disabled={empty} aria-label="Reset to start" title="Reset to the first frame">
          <SkipBack size={14} aria-hidden /> <span className="hidden sm:inline">Reset</span>
        </Button>
        <Button size="sm" onClick={playback.replay} disabled={empty} aria-label="Replay from the beginning" title="Replay from the beginning">
          <RotateCcw size={14} aria-hidden /> <span className="hidden sm:inline">Replay</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={() => playback.seek(duration)} disabled={empty} aria-label="Jump to end" title="Jump to the last frame">
          <SkipForward size={14} aria-hidden />
        </Button>
        <div role="group" aria-label="Playback speed" className="ml-auto flex gap-1 rounded-md bg-zinc-900 p-1">
          {PLAYBACK_SPEEDS.map((s: PlaybackSpeed) => (
            <button
              key={s}
              type="button"
              aria-pressed={speed === s}
              onClick={() => playback.setSpeed(s)}
              className={cn(
                'rounded px-2 py-1 text-xs font-medium tabular-nums',
                speed === s ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-100',
              )}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          aria-label="Replay position"
          min={0}
          max={Math.max(duration, 0.001)}
          step={seekStep}
          value={Math.min(time, Math.max(duration, 0.001))}
          disabled={empty}
          onChange={(e) => playback.seek(Number(e.target.value))}
          className="h-2 min-w-0 flex-1 accent-emerald-500"
        />
        <span className="shrink-0 text-xs tabular-nums text-zinc-300" aria-live="off">
          <span className="sr-only">Elapsed </span>
          {format(time)} <span className="text-zinc-400">/ {format(duration)}</span>
        </span>
      </div>
    </div>
  );
}
