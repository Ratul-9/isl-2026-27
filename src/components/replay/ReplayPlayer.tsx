'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Orientation } from '@/domain/geometry';
import { activeAnnotation } from '@/domain/replay/interpolate';
import type { TacticalReplay } from '@/domain/types';
import { cn } from '@/lib/cn';
import { ReplayControls } from './ReplayControls';
import { ReplayPitch } from './ReplayPitch';
import type { ReplayPitchEditing } from './ReplayPitch';
import type { ReplayPlayback } from './useReplayClock';

function initialOrientation(): Orientation {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 639px)').matches
    ? 'portrait'
    : 'landscape';
}

/** The replay on the pitch with its controls and the current caption. Used by the viewer and the editor. */
export function ReplayPlayer({
  replay,
  playback,
  teamNames,
  editing,
  underlay,
  badges,
  stepUnit,
  labels,
}: {
  replay: TacticalReplay;
  playback: ReplayPlayback;
  teamNames: { home: string; away: string };
  editing?: ReplayPitchEditing;
  /** Highlights drawn under the arrows; given the pitch orientation the player is showing. */
  underlay?: (orientation: Orientation) => ReactNode;
  badges?: Readonly<Record<string, string>>;
  stepUnit?: 'keyframe' | 'frame' | 'stage';
  labels?: boolean;
}) {
  const [orientation, setOrientation] = useState<Orientation>(initialOrientation);
  const note = activeAnnotation(replay, playback.time);
  const estimated = replay.origin === 'ai';

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Pitch orientation" className="flex gap-1 rounded-md bg-zinc-900 p-1">
          {(['landscape', 'portrait'] as const).map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={orientation === o}
              onClick={() => setOrientation(o)}
              className={cn(
                'rounded px-3 py-1.5 text-xs font-medium capitalize',
                orientation === o ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-100',
              )}
            >
              {o}
            </button>
          ))}
        </div>
        {estimated ? (
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200">
            Estimated reconstruction — not tracking data. Dashed markers are AI estimates; solid ones were placed by you.
          </span>
        ) : null}
      </div>

      <div className="flex min-h-0 justify-center rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
        <ReplayPitch
          replay={replay}
          time={playback.time}
          orientation={orientation}
          teamNames={teamNames}
          editing={editing}
          underlay={underlay?.(orientation)}
          badges={badges}
          labels={labels}
        />
      </div>

      <p className="min-h-5 text-sm text-zinc-200" aria-live="polite" data-testid="replay-caption">
        {note ? note.label : <span className="text-zinc-400">{replay.event.description || 'No description yet.'}</span>}
      </p>

      <ReplayControls playback={playback} stepUnit={stepUnit} />
    </div>
  );
}
