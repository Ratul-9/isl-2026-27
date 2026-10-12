'use client';

import { Plus, Trash2 } from 'lucide-react';
import { createId } from '@/domain/ids';
import { addAnnotation, addPath, ensureKeyframe, removeAnnotation, removeKeyframe, removePath, setKeyframeTime, updateAnnotation, updatePath } from '@/domain/replay/edit';
import { samplePositions } from '@/domain/replay/interpolate';
import { MAX_ANNOTATIONS, MAX_KEYFRAMES, MAX_PATHS } from '@/domain/replay/limits';
import type { ReplayPathKind, TacticalReplay } from '@/domain/types';
import { Button } from '@/components/ui/Button';
import { NumberField } from './NumberField';
import type { ReplayPlayback } from './useReplayClock';

const CELL = 'h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100 focus-visible:border-emerald-500';
const PATH_LABELS: Record<ReplayPathKind, string> = { pass: 'Pass', lofted: 'Lofted pass (LD)', shot: 'Shot', movement: 'Run' };
const actorName = (replay: TacticalReplay, id: string) => {
  const a = replay.actors.find((x) => x.id === id);
  return a ? (a.kind === 'ball' ? 'Ball' : a.name || a.label) : 'Unknown';
};

interface PanelProps {
  replay: TacticalReplay;
  playback: ReplayPlayback;
  onChange: (next: TacticalReplay) => void;
}

/** Moments in time: each keyframe fixes where the players and ball are; motion between them is interpolated. */
export function KeyframesPanel({ replay, playback, onChange }: PanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-zinc-400">
        Moving a player on the pitch sets their position at the current time ({playback.time.toFixed(1)} s) and creates a keyframe there if needed.
      </p>
      <ul className="flex flex-col gap-2">
        {replay.keyframes.map((k, i) => (
          <li key={k.id} aria-label={`Keyframe ${i + 1}`} className="flex items-end gap-2 rounded-md border border-zinc-800 p-2">
            <NumberField className="w-28" label={`Keyframe ${i + 1} time (s)`} value={k.t} min={0} onCommit={(t) => onChange(setKeyframeTime(replay, k.id, t))} />
            <span className="pb-2 text-xs text-zinc-400">{Object.keys(k.positions).length} placed</span>
            <Button size="sm" className="ml-auto" onClick={() => playback.seek(k.t)} aria-label={`Go to keyframe ${i + 1}`}>
              Go to
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onChange(removeKeyframe(replay, k.id))} aria-label={`Delete keyframe ${i + 1}`}>
              <Trash2 size={14} aria-hidden />
            </Button>
          </li>
        ))}
        {replay.keyframes.length === 0 ? <li className="text-xs text-zinc-400">No keyframes yet.</li> : null}
      </ul>
      <Button size="sm" onClick={() => onChange(ensureKeyframe(replay, playback.time, createId).replay)} disabled={replay.keyframes.length >= MAX_KEYFRAMES}>
        <Plus size={14} aria-hidden /> Add keyframe at {playback.time.toFixed(1)} s
      </Button>
    </div>
  );
}

/** Passes, shots and runs. An end can follow a player, or stay at a fixed point. */
export function PathsPanel({ replay, playback, onChange }: PanelProps) {
  function addArrow() {
    const ball = replay.actors.find((a) => a.kind === 'ball');
    const at = playback.time;
    const start = (ball ? samplePositions(replay, at)[ball.id] : undefined) ?? { x: 50, y: 50 };
    onChange(
      addPath(replay, {
        id: createId('path'),
        kind: 'pass',
        startT: at,
        endT: at + 1,
        from: start,
        to: { x: Math.min(100, start.x + 15), y: start.y },
        fromActorId: null,
        toActorId: null,
        note: '',
        confidence: null,
        source: 'user',
      }),
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {replay.paths.map((p, i) => (
          <li key={p.id} aria-label={`Arrow ${i + 1}`} className="rounded-md border border-zinc-800 p-2">
            <div className="flex items-center gap-2">
              <select className={CELL} aria-label={`Arrow ${i + 1} type`} value={p.kind} onChange={(e) => onChange(updatePath(replay, p.id, { kind: e.target.value as ReplayPathKind }))}>
                {(Object.keys(PATH_LABELS) as ReplayPathKind[]).map((k) => (
                  <option key={k} value={k}>
                    {PATH_LABELS[k]}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="ghost" onClick={() => onChange(removePath(replay, p.id))} aria-label={`Delete arrow ${i + 1}`}>
                <Trash2 size={14} aria-hidden />
              </Button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <NumberField label={`Arrow ${i + 1} starts (s)`} value={p.startT} min={0} onCommit={(v) => onChange(updatePath(replay, p.id, { startT: v }))} />
              <NumberField label={`Arrow ${i + 1} ends (s)`} value={p.endT} min={0} onCommit={(v) => onChange(updatePath(replay, p.id, { endT: v }))} />
              {(['from', 'to'] as const).map((end) => {
                const actorKey = end === 'from' ? 'fromActorId' : 'toActorId';
                const actorId = p[actorKey];
                return (
                  <div key={end} className="col-span-1 flex flex-col gap-1">
                    <label className="text-xs text-zinc-300">
                      {end === 'from' ? 'From' : 'To'}
                      <select
                        className={CELL}
                        aria-label={`Arrow ${i + 1} ${end}`}
                        value={actorId ?? ''}
                        onChange={(e) => onChange(updatePath(replay, p.id, { [actorKey]: e.target.value === '' ? null : e.target.value }))}
                      >
                        <option value="">Fixed point</option>
                        {replay.actors.map((a) => (
                          <option key={a.id} value={a.id}>
                            {actorName(replay, a.id)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {actorId === null ? (
                      <div className="grid grid-cols-2 gap-1">
                        <NumberField label={`Arrow ${i + 1} ${end} X`} value={p[end].x} min={0} max={100} onCommit={(x) => onChange(updatePath(replay, p.id, { [end]: { ...p[end], x } }))} />
                        <NumberField label={`Arrow ${i + 1} ${end} Y`} value={p[end].y} min={0} max={100} onCommit={(y) => onChange(updatePath(replay, p.id, { [end]: { ...p[end], y } }))} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-zinc-400">
              {p.source === 'ai' ? `AI estimate${p.confidence !== null ? ` · ${Math.round(p.confidence * 100)}% sure` : ''}` : 'Set by you'}
              {p.note ? ` · ${p.note}` : ''}
            </p>
          </li>
        ))}
        {replay.paths.length === 0 ? <li className="text-xs text-zinc-400">No arrows yet.</li> : null}
      </ul>
      <Button size="sm" onClick={addArrow} disabled={replay.paths.length >= MAX_PATHS}>
        <Plus size={14} aria-hidden /> Add arrow at {playback.time.toFixed(1)} s
      </Button>
    </div>
  );
}

/** Short captions shown at a moment during playback. */
export function AnnotationsPanel({ replay, playback, onChange }: PanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {replay.annotations.map((a, i) => (
          <li key={a.id} aria-label={`Label ${i + 1}`} className="flex items-end gap-2 rounded-md border border-zinc-800 p-2">
            <NumberField className="w-24" label={`Label ${i + 1} time (s)`} value={a.t} min={0} onCommit={(t) => onChange(updateAnnotation(replay, a.id, { t }))} />
            <label className="min-w-0 flex-1 text-xs text-zinc-300">
              Label {i + 1} text
              <input className={CELL} value={a.label} maxLength={300} onChange={(e) => onChange(updateAnnotation(replay, a.id, { label: e.target.value }))} />
            </label>
            <Button size="sm" variant="ghost" onClick={() => onChange(removeAnnotation(replay, a.id))} aria-label={`Delete label ${i + 1}`}>
              <Trash2 size={14} aria-hidden />
            </Button>
          </li>
        ))}
        {replay.annotations.length === 0 ? <li className="text-xs text-zinc-400">No labels yet.</li> : null}
      </ul>
      <Button
        size="sm"
        disabled={replay.annotations.length >= MAX_ANNOTATIONS}
        onClick={() => onChange(addAnnotation(replay, { id: createId('note'), t: playback.time, label: 'New label', point: null, eventType: null }))}
      >
        <Plus size={14} aria-hidden /> Add label at {playback.time.toFixed(1)} s
      </Button>
    </div>
  );
}
