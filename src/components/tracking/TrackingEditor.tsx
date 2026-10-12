'use client';

import { useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { setPosition } from '@/domain/tracking/edit';
import { landmark } from '@/domain/tracking/landmarks';
import { frameAt } from '@/domain/tracking/sample';
import type { TacticalReplay, TrackingData } from '@/domain/types';
import { Button } from '@/components/ui/Button';
import { ConfirmBar } from '@/components/ui/ConfirmBar';
import { TextField } from '@/components/ui/fields';
import { cn } from '@/lib/cn';
import { useReplayClock } from '@/components/replay/useReplayClock';
import { AttachVideo } from './AttachVideo';
import type { AttachedVideo } from './AttachVideo';
import { CalibrationPanel } from './CalibrationPanel';
import type { CalibrationDraft } from './CalibrationPanel';
import { TeamsPanel } from './TeamsPanel';
import { TrackingDetails } from './TrackingDetails';
import { TrackingStage } from './TrackingStage';
import { TracksPanel } from './TracksPanel';
import { useTrackNames } from './useTrackNames';

type PanelId = 'teams' | 'tracks' | 'calibration' | 'details';
const PANELS: { id: PanelId; label: string }[] = [
  { id: 'teams', label: 'Teams' },
  { id: 'tracks', label: 'Tracks' },
  { id: 'calibration', label: 'Calibration' },
  { id: 'details', label: 'Details' },
];

const nowIso = () => new Date().toISOString();

/** Review and correct tracking data. Works on a local draft; the match changes only on Save. Never re-runs detection. */
export function TrackingEditor({
  initial,
  isNew,
  video: initialVideo,
  duration,
  onSave,
  onCancel,
}: {
  initial: TacticalReplay;
  isNew: boolean;
  video: AttachedVideo | null;
  duration: (file: File) => Promise<number | null>;
  onSave: (replay: TacticalReplay) => string[];
  onCancel: () => void;
}) {
  const { names, squads } = useTrackNames();
  const [draft, setDraft] = useState(initial);
  const [panel, setPanel] = useState<PanelId>('teams');
  const [selected, setSelected] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [calib, setCalib] = useState<CalibrationDraft | null>(null);
  const [video, setVideo] = useState<{ v: AttachedVideo; warning: string | null } | null>(initialVideo ? { v: initialVideo, warning: null } : null);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const tracking = draft.tracking as TrackingData;
  const frameTimes = useMemo(() => tracking.frameTimesMs.map((t) => t / 1000), [tracking.frameTimesMs]);
  const playback = useReplayClock((tracking.segment.endMs - tracking.segment.startMs) / 1000, frameTimes);
  const frame = frameAt(tracking, playback.time * 1000 + 1);
  const dirty = draft !== initial;
  const sizeKb = useMemo(() => Math.round(JSON.stringify(tracking).length / 1024), [tracking]);

  // Only revoke URLs this editor created (an attached file), not the one handed in by the import.
  useEffect(() => () => (video && video.v !== initialVideo ? URL.revokeObjectURL(video.v.url) : undefined), [video, initialVideo]);

  const change = (t: TrackingData) => setDraft((d) => ({ ...d, tracking: t }));

  return (
    <div className="mx-auto grid w-full max-w-[120rem] flex-1 gap-4 px-4 py-4 2xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="flex min-w-0 flex-col gap-3">
        <header className="flex flex-wrap items-end gap-2">
          <TextField label="Title" value={draft.title} maxLength={80} onChange={(e) => setDraft({ ...draft, title: e.target.value })} wrapperClassName="mr-auto min-w-48 flex-1" />
          <Button size="sm" onClick={() => (dirty || isNew ? setConfirmDiscard(true) : onCancel())}>
            {isNew ? 'Discard' : 'Cancel'}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => setErrors(onSave({ ...draft, title: draft.title.trim(), updatedAt: nowIso() }))}
            title={`Adds about ${sizeKb} KB to the match`}
          >
            <Save size={14} aria-hidden /> Save tracked replay
          </Button>
        </header>
        {confirmDiscard ? (
          <ConfirmBar
            message={isNew ? 'Discard this tracking result? The video would have to be processed again.' : 'Discard your changes?'}
            confirmLabel="Discard"
            onConfirm={onCancel}
            onCancel={() => setConfirmDiscard(false)}
          />
        ) : null}
        {errors.length > 0 ? (
          <div role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
            <p className="font-medium">The replay was not saved:</p>
            <ul className="mt-1 list-inside list-disc">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {video?.warning ? <p className="text-xs text-amber-200">{video.warning}</p> : null}
        <TrackingStage
          tracking={tracking}
          playback={playback}
          videoUrl={video?.v.url ?? null}
          names={names}
          selectedTrackId={selected}
          editing={{
            placing,
            onSelect: (id) => {
              setSelected(id);
              if (id) setPanel('tracks');
            },
            onPlace: (id, point) => {
              playback.pause();
              change(setPosition(tracking, id, frame, point, nowIso()));
              setPlacing(false);
            },
          }}
          calibrating={
            calib
              ? {
                  points: calib.points.map((p, i) => ({ image: p.image, label: String(i + 1) })),
                  landmarks: calib.points.map((p) => ({ id: p.landmark, pitchM: landmark(p.landmark)!.pitchM })),
                  onPick: (image) => {
                    if (calib.points.some((p) => p.landmark === calib.landmarkId)) return setCalib({ ...calib, error: 'That landmark is already set; choose the next one.' });
                    setCalib({ ...calib, points: [...calib.points, { landmark: calib.landmarkId, image }], error: null });
                  },
                }
              : undefined
          }
          noVideo={<AttachVideo tracking={tracking} duration={duration} onAttach={(v, warning) => setVideo({ v, warning })} />}
        />
      </div>

      <aside aria-label="Tracking review" className="flex min-w-0 flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <div role="tablist" aria-label="Review panels" className="flex flex-wrap gap-1">
          {PANELS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={panel === p.id}
              onClick={() => setPanel(p.id)}
              className={cn('rounded-md px-3 py-1.5 text-xs font-medium', panel === p.id ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100')}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" aria-label={PANELS.find((p) => p.id === panel)?.label}>
          {panel === 'teams' ? <TeamsPanel tracking={tracking} teamNames={names.teams} onChange={change} /> : null}
          {panel === 'tracks' ? (
            <TracksPanel
              tracking={tracking}
              frame={frame}
              names={names}
              squads={squads}
              selectedTrackId={selected}
              onSelect={setSelected}
              placing={placing}
              onPlacing={(on) => {
                if (on) playback.pause();
                setPlacing(on);
              }}
              onChange={change}
              now={nowIso}
            />
          ) : null}
          {panel === 'calibration' ? (
            <CalibrationPanel
              tracking={tracking}
              frame={frame}
              hasVideo={!!video}
              draft={calib}
              onDraft={setCalib}
              onChange={change}
              onStart={() => {
                playback.pause();
                playback.seek(frameTimes[frame] ?? 0);
                setCalib({ landmarkId: 'halfway-far', points: [], error: null });
              }}
            />
          ) : null}
          {panel === 'details' ? <TrackingDetails tracking={tracking} sizeKb={sizeKb} notes={draft.notes} onNotes={(notes) => setDraft({ ...draft, notes })} /> : null}
        </div>
      </aside>
    </div>
  );
}
