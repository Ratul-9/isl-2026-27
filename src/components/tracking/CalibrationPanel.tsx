import { Check, MapPin, Trash2, X } from 'lucide-react';
import { clearManualCalibration, setAutoCalibrationRejected, setManualCalibration } from '@/domain/tracking/edit';
import type { Vec2 } from '@/domain/tracking/homography';
import { LANDMARKS, landmark } from '@/domain/tracking/landmarks';
import { frameCalibrationSource } from '@/domain/tracking/sample';
import type { TrackingData } from '@/domain/types';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/fields';

export interface CalibrationDraft {
  landmarkId: string;
  points: { landmark: string; image: Vec2 }[];
  error: string | null;
}

interface Props {
  tracking: TrackingData;
  frame: number;
  hasVideo: boolean;
  draft: CalibrationDraft | null;
  onDraft: (d: CalibrationDraft | null) => void;
  onChange: (t: TrackingData) => void;
  onStart: () => void;
}

const SOURCE_TEXT = {
  keypoints: 'automatic, from pitch keypoints detected in this frame',
  propagated: 'automatic, carried from a nearby frame by camera motion',
  manual: 'your manual calibration',
  rejected: 'automatic calibration rejected by you',
  none: 'none (no pitch positions for this frame)',
} as const;

/** Shows how pitch positions were obtained and lets the user reject the automatic result or calibrate by hand. */
export function CalibrationPanel({ tracking, frame, hasVideo, draft, onDraft, onChange, onStart }: Props) {
  const c = tracking.calibration;
  const n = tracking.segment.processedFrames;
  const auto = c.perFrame.source.filter((s) => s === 'keypoints' || s === 'propagated').length;
  const shot = c.perFrame.shot[frame] ?? 0;
  const manual = c.manual[String(shot)];
  const source = frameCalibrationSource(tracking, frame);
  const err = c.perFrame.errorM[frame];
  const used = new Set(draft?.points.map((p) => p.landmark));

  function apply() {
    if (!draft) return;
    try {
      const points = draft.points.map((p) => ({ landmark: p.landmark, image: p.image, pitchM: landmark(p.landmark)!.pitchM }));
      onChange(setManualCalibration(tracking, frame, points));
      onDraft(null);
    } catch (e) {
      onDraft({ ...draft, error: e instanceof Error ? e.message : 'These points do not give a calibration.' });
    }
  }

  return (
    <section aria-label="Pitch calibration" className="flex flex-col gap-3 text-sm">
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-100">
        Automatic calibration is <strong>unverified</strong>: the pitch-keypoint model can produce a confident but wrong pitch on broadcast footage unlike its
        training data. Check that the projected lines on the video sit on the real markings; if they do not, reject it or calibrate by hand.
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-zinc-400">Automatic</dt>
        <dd>
          {auto} of {n} frames{c.autoRejected ? ' (rejected)' : ''}
        </dd>
        <dt className="text-zinc-400">This frame</dt>
        <dd>
          {SOURCE_TEXT[source]}
          {source !== 'manual' && source !== 'rejected' && err !== null && err !== undefined ? ` · est. error ${err.toFixed(2)} m (self-consistency only)` : ''}
        </dd>
        <dt className="text-zinc-400">Shot</dt>
        <dd>
          {shot + 1} of {Math.max(...c.perFrame.shot, 0) + 1} (camera cuts start a new shot)
        </dd>
      </dl>
      <label className="flex items-center gap-2 text-xs text-zinc-200">
        <input type="checkbox" checked={c.autoRejected} onChange={(e) => onChange(setAutoCalibrationRejected(tracking, e.target.checked))} className="accent-emerald-600" />
        Reject the automatic calibration for the whole clip
      </label>

      <div className="flex flex-col gap-2 border-t border-zinc-800 pt-3">
        <h3 className="text-sm font-semibold">Manual calibration for shot {shot + 1}</h3>
        {manual && !draft ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-300">
            <span>
              {manual.points.length} landmarks set on frame {manual.referenceFrame + 1}
              {manual.errorM !== null ? ` · leave-one-out error ${manual.errorM.toFixed(2)} m` : ' · add a 5th point for an error estimate'}. Camera motion carries it
              through the shot.
            </span>
            <Button size="sm" variant="ghost" onClick={() => onChange(clearManualCalibration(tracking, shot))}>
              <Trash2 size={14} aria-hidden /> Remove
            </Button>
          </div>
        ) : null}
        {!draft ? (
          <Button size="sm" className="self-start" disabled={!hasVideo} onClick={onStart} title={hasVideo ? undefined : 'Attach the original video first'}>
            <MapPin size={14} aria-hidden /> {manual ? 'Redo by hand on this frame' : 'Calibrate by hand on this frame'}
          </Button>
        ) : (
          <div className="flex flex-col gap-2 rounded-md border border-zinc-700 p-2">
            <p className="text-xs text-zinc-300">Choose a landmark you can see, then click exactly where it is on the video. At least 4, spread out; 6+ is better.</p>
            <SelectField label="Next landmark" value={draft.landmarkId} onChange={(e) => onDraft({ ...draft, landmarkId: e.target.value, error: null })}>
              {LANDMARKS.map((l) => (
                <option key={l.id} value={l.id} disabled={used.has(l.id)}>
                  {l.label}
                </option>
              ))}
            </SelectField>
            <ol className="flex flex-col gap-1 text-xs">
              {draft.points.map((p, i) => (
                <li key={p.landmark} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    {i + 1}. {landmark(p.landmark)?.label} at ({p.image[0].toFixed(0)}, {p.image[1].toFixed(0)}) px
                  </span>
                  <Button size="sm" variant="ghost" aria-label={`Remove point ${i + 1}`} onClick={() => onDraft({ ...draft, points: draft.points.filter((q) => q !== p), error: null })}>
                    <X size={12} aria-hidden />
                  </Button>
                </li>
              ))}
            </ol>
            {draft.error ? (
              <p role="alert" className="text-xs text-red-300">
                {draft.error}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button size="sm" variant="primary" disabled={draft.points.length < 4} onClick={apply}>
                <Check size={14} aria-hidden /> Use these {draft.points.length} points
              </Button>
              <Button size="sm" onClick={() => onDraft(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {!hasVideo ? <p className="text-xs text-zinc-400">Attach the original video to calibrate by hand.</p> : null}
      </div>
      {c.notes.length > 0 ? (
        <ul className="list-inside list-disc text-xs text-zinc-400">
          {c.notes.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
