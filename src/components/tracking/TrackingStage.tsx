'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Orientation } from '@/domain/geometry';
import type { Vec2 } from '@/domain/tracking/homography';
import { ballTrail, frameAt, manualSolver, sampleTracking } from '@/domain/tracking/sample';
import type { EffectivePoint } from '@/domain/tracking/sample';
import type { TrackingData } from '@/domain/types';
import { cn } from '@/lib/cn';
import { ReplayControls } from '@/components/replay/ReplayControls';
import type { ReplayPlayback } from '@/components/replay/useReplayClock';
import type { OverlayOptions } from './drawOverlay';
import { TrackingPitch } from './TrackingPitch';
import type { TrackingPitchEditing } from './TrackingPitch';
import { TrackingVideo } from './TrackingVideo';
import type { TrackNames } from './trackStyle';

const TRAIL_MS = 2000;

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-zinc-300">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-emerald-600" />
      {label}
    </label>
  );
}

interface TrackingStageProps {
  tracking: TrackingData;
  playback: ReplayPlayback;
  videoUrl: string | null;
  names: TrackNames;
  selectedTrackId: string | null;
  editing?: TrackingPitchEditing;
  calibrating?: { points: { image: Vec2; label: string }[]; onPick: (image: Vec2) => void; landmarks: { id: string; pitchM: [number, number] }[] };
  /** Shown where the video would be when no video is attached. */
  noVideo: ReactNode;
}

/** Source video (when attached) beside the pitch, one set of controls, and the display options. */
export function TrackingStage({ tracking, playback, videoUrl, names, selectedTrackId, editing, calibrating, noVideo }: TrackingStageProps) {
  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [options, setOptions] = useState<OverlayOptions & { trail: boolean }>({ boxes: true, ids: true, lines: true, trail: true });
  const solver = useMemo(() => manualSolver(tracking), [tracking]);
  // One cache of effective points per version of the tracking data (edits produce a new object).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cache = useMemo(() => new Map<string, EffectivePoint[]>(), [tracking]);
  const tMs = playback.time * 1000;
  const sample = sampleTracking(tracking, tMs, solver, cache);
  const trail = options.trail ? ballTrail(tracking, tMs, TRAIL_MS, solver) : [];
  const overlay = useMemo(() => ({ boxes: options.boxes, ids: options.ids, lines: options.lines }), [options.boxes, options.ids, options.lines]);
  const set = (key: keyof typeof options) => (v: boolean) => setOptions((o) => ({ ...o, [key]: v }));
  const frame = frameAt(tracking, tMs + 1);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="group" aria-label="Pitch orientation" className="flex gap-1 rounded-md bg-zinc-900 p-1">
          {(['landscape', 'portrait'] as const).map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={orientation === o}
              onClick={() => setOrientation(o)}
              className={cn('rounded px-3 py-1.5 text-xs font-medium capitalize', orientation === o ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-100')}
            >
              {o}
            </button>
          ))}
        </div>
        <Toggle label="Track IDs" checked={options.ids} onChange={set('ids')} />
        <Toggle label="Ball trail" checked={options.trail} onChange={set('trail')} />
        {videoUrl ? <Toggle label="Boxes on video" checked={options.boxes} onChange={set('boxes')} /> : null}
        {videoUrl ? <Toggle label="Pitch lines on video" checked={options.lines} onChange={set('lines')} /> : null}
      </div>

      <div className={cn('grid gap-3', orientation === 'landscape' ? 'lg:grid-cols-2' : 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]')}>
        <div className="min-w-0">
          {videoUrl ? (
            <TrackingVideo
              url={videoUrl}
              tracking={tracking}
              time={playback.time}
              playing={playback.playing}
              speed={playback.speed}
              solver={solver}
              names={names}
              options={overlay}
              selectedTrackId={selectedTrackId}
              calibrating={calibrating}
            />
          ) : (
            noVideo
          )}
        </div>
        <div className="flex min-w-0 justify-center rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
          <TrackingPitch
            tracking={tracking}
            sample={sample.visible}
            trail={trail}
            orientation={orientation}
            names={names}
            showIds={options.ids}
            selectedTrackId={selectedTrackId}
            landmarks={calibrating?.landmarks}
            editing={editing}
          />
        </div>
      </div>

      <p className="text-xs text-zinc-400" aria-live="off" data-testid="tracking-status">
        Frame {frame + 1} of {tracking.frameTimesMs.length} · {sample.visible.length} shown on the pitch
        {sample.inGap.length > 0 ? ` · ${sample.inGap.length} without a position here (gap over 0.5 s; not drawn)` : ''}. Dashed = interpolated; ringed = placed by you.
      </p>
      <ReplayControls playback={playback} stepUnit="frame" seekStep={1 / tracking.source.fps} />
    </div>
  );
}
