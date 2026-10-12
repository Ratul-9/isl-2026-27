import { useState } from 'react';
import { EyeOff } from 'lucide-react';
import { observationIndex } from '@/domain/tracking/overlay';
import type { TrackingTrack } from '@/domain/types';
import { cn } from '@/lib/cn';
import { TrackDetail } from './TrackDetail';
import type { TrackDetailProps } from './TrackDetail';
import { trackColours, trackLabel } from './trackStyle';

type Props = Omit<TrackDetailProps, 'track'> & { onSelect: (id: string | null) => void; selectedTrackId: string | null };

const order = (t: TrackingTrack) => (t.objectType === 'ball' ? 0 : t.objectType === 'referee' ? 2 : 1);

/** Every track found in the clip; select one to assign it, merge fragments or correct it at the current frame. */
export function TracksPanel(props: Props) {
  const { tracking, frame, names, selectedTrackId, onSelect } = props;
  const [onlyNow, setOnlyNow] = useState(false);
  const selected = tracking.tracks.find((t) => t.id === selectedTrackId) ?? null;
  const visibleNow = (t: TrackingTrack) => observationIndex(t, frame) >= 0 || String(frame) in t.edits;
  const list = tracking.tracks
    .filter((t) => !onlyNow || visibleNow(t))
    .sort((a, b) => order(a) - order(b) || (a.trackerId ?? 0) - (b.trackerId ?? 0));

  return (
    <section aria-label="Tracks" className="flex flex-col gap-3">
      {selected ? <TrackDetail {...props} track={selected} /> : <p className="text-xs text-zinc-400">Select a track below, on the pitch, or in the list.</p>}
      <div className="flex items-center justify-between gap-2 border-t border-zinc-800 pt-3">
        <h3 className="text-sm font-semibold">
          {list.length} track{list.length === 1 ? '' : 's'}
        </h3>
        <label className="flex items-center gap-1.5 text-xs text-zinc-300">
          <input type="checkbox" checked={onlyNow} onChange={(e) => setOnlyNow(e.target.checked)} className="accent-emerald-600" />
          Only those in this frame
        </label>
      </div>
      <p className="text-xs text-zinc-400">Track numbers come from the tracker. They are not shirt numbers, and a number can jump to another player when players cross.</p>
      <ul aria-label="Track list" className="flex max-h-80 flex-col gap-1 overflow-y-auto pr-1">
        {list.map((t) => {
          const colours = trackColours(tracking, t);
          const label = trackLabel(tracking, t, names);
          const edits = Object.keys(t.edits).length;
          return (
            <li key={t.id}>
              <button
                type="button"
                aria-pressed={t.id === selectedTrackId}
                onClick={() => onSelect(t.id === selectedTrackId ? null : t.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs',
                  t.id === selectedTrackId ? 'bg-zinc-700 text-white' : 'text-zinc-200 hover:bg-zinc-800',
                  t.hidden && 'opacity-60',
                )}
              >
                <span aria-hidden className="h-3 w-3 shrink-0 rounded-full border border-zinc-600" style={{ backgroundColor: t.objectType === 'ball' ? '#ffffff' : colours.fill }} />
                <span className="min-w-0 flex-1 truncate">{label.description}</span>
                <span className="shrink-0 tabular-nums text-zinc-300">{t.obs.frame.length} fr</span>
                {edits > 0 ? <span className="shrink-0 text-sky-300">{edits} fix</span> : null}
                {t.hidden ? <EyeOff size={12} aria-label="hidden" /> : null}
                {!visibleNow(t) ? <span className="sr-only">(not in this frame)</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
