'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Pencil } from 'lucide-react';
import type { TacticalReplay, TrackingData } from '@/domain/types';
import { Button } from '@/components/ui/Button';
import { useReplayClock } from '@/components/replay/useReplayClock';
import { AttachVideo } from './AttachVideo';
import type { AttachedVideo } from './AttachVideo';
import { TrackingDetails } from './TrackingDetails';
import { TrackingStage } from './TrackingStage';
import { useTrackNames } from './useTrackNames';

/** Plays a SAVED tracked replay from its stored data. No detection runs; the video is optional and never stored. */
export function TrackingViewer({
  replay,
  duration,
  onEdit,
  onBack,
}: {
  replay: TacticalReplay;
  duration: (file: File) => Promise<number | null>;
  onEdit: () => void;
  onBack: () => void;
}) {
  const { names } = useTrackNames();
  const tracking = replay.tracking as TrackingData;
  const frameTimes = useMemo(() => tracking.frameTimesMs.map((t) => t / 1000), [tracking.frameTimesMs]);
  const playback = useReplayClock((tracking.segment.endMs - tracking.segment.startMs) / 1000, frameTimes);
  const [video, setVideo] = useState<{ v: AttachedVideo; warning: string | null } | null>(null);
  useEffect(() => () => (video ? URL.revokeObjectURL(video.v.url) : undefined), [video]);

  return (
    <div className="mx-auto grid w-full max-w-[120rem] flex-1 gap-4 px-4 py-4 2xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex min-w-0 flex-col gap-3">
        <header className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onBack} aria-label="Back to replays">
            <ArrowLeft size={14} aria-hidden /> Replays
          </Button>
          <h2 className="mr-auto min-w-0 truncate text-base font-semibold">{replay.title}</h2>
          <Button size="sm" onClick={onEdit}>
            <Pencil size={14} aria-hidden /> Review &amp; correct
          </Button>
        </header>
        <p className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-300">
          Computer-vision tracking: positions come from detected boxes projected through a pitch calibration (automatic ones are unverified). Gaps longer than
          0.5 s are left empty rather than guessed.
        </p>
        {video?.warning ? <p className="text-xs text-amber-200">{video.warning}</p> : null}
        <TrackingStage
          tracking={tracking}
          playback={playback}
          videoUrl={video?.v.url ?? null}
          names={names}
          selectedTrackId={null}
          noVideo={<AttachVideo tracking={tracking} duration={duration} onAttach={(v, warning) => setVideo({ v, warning })} />}
        />
      </div>
      <aside aria-label="Replay details" className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <TrackingDetails tracking={tracking} notes={replay.notes} />
      </aside>
    </div>
  );
}
