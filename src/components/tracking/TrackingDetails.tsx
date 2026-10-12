import type { TrackingData } from '@/domain/types';
import { TextAreaField } from '@/components/ui/fields';
import { formatSeconds } from '@/tracking/segment';

/** Provenance of a tracking result: which models ran where, what the service warned about, and the user's notes. */
export function TrackingDetails({ tracking, sizeKb, notes, onNotes }: { tracking: TrackingData; sizeKb?: number; notes: string; onNotes?: (notes: string) => void }) {
  const { segment, source } = tracking;
  const edits = tracking.tracks.reduce((n, t) => n + Object.keys(t.edits).length, 0);
  return (
    <section aria-label="Tracking details" className="flex flex-col gap-3 text-xs">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-zinc-400">Video</dt>
        <dd className="break-all">
          {source.fileName ?? 'unknown'} · {source.width}×{source.height} · {source.fps} fps (not stored)
        </dd>
        <dt className="text-zinc-400">Segment</dt>
        <dd>
          {formatSeconds(segment.startMs / 1000)}–{formatSeconds(segment.endMs / 1000)} · {segment.processedFrames} frames
          {segment.frameStride > 1 ? ` (every ${segment.frameStride}th)` : ' (every frame)'}
        </dd>
        <dt className="text-zinc-400">Tracks</dt>
        <dd>
          {tracking.tracks.length} · {edits} correction{edits === 1 ? '' : 's'} by you
        </dd>
        <dt className="text-zinc-400">Computed on</dt>
        <dd>{tracking.device}</dd>
        {sizeKb !== undefined ? (
          <>
            <dt className="text-zinc-400">Stored size</dt>
            <dd>about {sizeKb} KB in this match</dd>
          </>
        ) : null}
      </dl>
      <div>
        <h3 className="font-semibold text-zinc-200">Models</h3>
        <ul className="mt-1 flex flex-col gap-1 text-zinc-300">
          {tracking.models.map((m) => (
            <li key={m.role}>
              {m.name} <span className="text-zinc-400">— {m.licence}</span>
            </li>
          ))}
        </ul>
      </div>
      {tracking.warnings.length > 0 ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-amber-100">
          <h3 className="font-semibold">Limitations reported by the service</h3>
          <ul className="mt-1 list-inside list-disc">
            {tracking.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {onNotes ? (
        <TextAreaField label="Notes" value={notes} maxLength={2000} rows={3} onChange={(e) => onNotes(e.target.value)} />
      ) : notes ? (
        <p className="whitespace-pre-wrap text-zinc-200">{notes}</p>
      ) : null}
    </section>
  );
}
