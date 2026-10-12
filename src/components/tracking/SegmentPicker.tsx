import { Crosshair, ScanSearch } from 'lucide-react';
import type { CvScan } from '@/tracking/client';
import { formatSeconds } from '@/tracking/segment';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/fields';

interface SegmentPickerProps {
  start: string;
  duration: string;
  maxSegment: number;
  error: string | null;
  disabled: boolean;
  onChange: (next: { start?: string; duration?: string }) => void;
  onUseCurrent: () => void;
  scan: CvScan | null;
  canScan: boolean;
  onScan: () => void;
  onPick: (startS: number, durationS: number) => void;
}

/** Which part of the video to track: a start and a length (every frame in it is processed). */
export function SegmentPicker(props: SegmentPickerProps) {
  const { scan } = props;
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-zinc-800 p-3" disabled={props.disabled}>
      <legend className="px-1 text-sm font-semibold">Segment to track</legend>
      <p className="text-xs text-zinc-400">
        Tracking works best on one continuous wide (“tactical camera”) shot. Replays, close-ups and fast pans are tracked poorly; camera cuts restart the
        track IDs.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <TextField
          label="Start (seconds)"
          type="number"
          inputMode="decimal"
          min={0}
          step={0.04}
          value={props.start}
          onChange={(e) => props.onChange({ start: e.target.value })}
          wrapperClassName="w-36"
        />
        <TextField
          label={`Length (max ${props.maxSegment} s)`}
          type="number"
          inputMode="decimal"
          min={0.5}
          max={props.maxSegment}
          step={0.5}
          value={props.duration}
          onChange={(e) => props.onChange({ duration: e.target.value })}
          wrapperClassName="w-36"
        />
        <Button size="sm" onClick={props.onUseCurrent} title="Start the segment where the preview is paused">
          <Crosshair size={14} aria-hidden /> Start at preview position
        </Button>
      </div>
      {props.error ? (
        <p role="alert" className="text-xs text-red-300">
          {props.error}
        </p>
      ) : null}
      <div className="flex flex-col gap-2 border-t border-zinc-800 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={props.onScan} disabled={!props.canScan}>
            <ScanSearch size={14} aria-hidden /> Find wide shots in the video
          </Button>
          <span className="text-xs text-zinc-400">Optional: finds camera cuts and samples the pitch detector (takes about a sixth of the video&apos;s length).</span>
        </div>
        {scan ? (
          scan.suggestions.length === 0 ? (
            <p className="text-xs text-zinc-300">No wide shot of at least 3 s was found. You can still choose a segment by hand.</p>
          ) : (
            <ul aria-label="Suggested segments" className="flex flex-wrap gap-2">
              {scan.suggestions.map((s) => (
                <li key={s.startS}>
                  <button
                    type="button"
                    onClick={() => props.onPick(s.startS, s.durationS)}
                    className="rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100 hover:bg-zinc-700"
                    title={`Pitch landmarks found in ${Math.round(s.wideScore * 100)}% of sampled frames`}
                  >
                    {formatSeconds(s.startS)} · {s.durationS.toFixed(1)} s · wide {Math.round(s.wideScore * 100)}%
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </fieldset>
  );
}
