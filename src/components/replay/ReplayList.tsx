'use client';

import { useState } from 'react';
import { Film, FilePlus2, Pencil, Play, ScanEye, Trash2, X } from 'lucide-react';
import { REPLAY_EVENT_LABELS } from '@/domain/replay/eventTypes';
import { replayDuration } from '@/domain/replay/interpolate';
import { MAX_REPLAYS_PER_MATCH } from '@/domain/replay/limits';
import type { Id, TacticalReplay } from '@/domain/types';
import { Button } from '@/components/ui/Button';
import { ConfirmBar } from '@/components/ui/ConfirmBar';

const ORIGIN_TEXT: Record<TacticalReplay['origin'], string> = {
  ai: 'from AI analysis (estimated)',
  manual: 'annotated by hand',
  tracking: 'computer-vision tracking',
};

/** The saved replays of a match and the ways to add one. */
export function ReplayList({
  replays,
  onTrack,
  onImport,
  onCreate,
  onPlay,
  onEdit,
  onDelete,
  videoAnalysis = true,
}: {
  replays: TacticalReplay[];
  onTrack: () => void;
  onImport: () => void;
  onCreate: () => void;
  onPlay: (id: Id) => void;
  onEdit: (replay: TacticalReplay) => void;
  onDelete: (id: Id) => void;
  /** False = the video features are switched off: their buttons answer "Coming soon" instead of opening. */
  videoAnalysis?: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState<Id | null>(null);
  const [comingSoon, setComingSoon] = useState(false);
  const full = replays.length >= MAX_REPLAYS_PER_MATCH;
  const videoAction = (open: () => void) => () => (videoAnalysis ? open() : setComingSoon(true));
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h2 className="text-base font-semibold">Tactical replays</h2>
          <p className="text-xs text-zinc-400">Tracked video segments and animated reconstructions of short events, saved with this match.</p>
        </div>
        <Button variant="primary" onClick={videoAction(onTrack)} disabled={full} title={videoAnalysis ? undefined : 'Coming soon'}>
          <ScanEye size={16} aria-hidden /> Track a video
        </Button>
        <Button
          onClick={videoAction(onImport)}
          disabled={full}
          title={videoAnalysis ? 'Estimated reconstruction by a generative AI model (Gemini)' : 'Coming soon'}
        >
          <Film size={16} aria-hidden /> AI sketch from a clip
        </Button>
        <Button
          onClick={onCreate}
          disabled={full}
        >
          <FilePlus2 size={16} aria-hidden /> Create replay by hand
        </Button>
      </header>
      {comingSoon ? (
        <div role="status" className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
          <span aria-hidden className="text-lg leading-none">
            🎬
          </span>
          <p className="min-w-0 flex-1">
            <strong>Coming Soon</strong> — video analysis isn&apos;t available yet. You can still create a replay by hand.
          </p>
          <button
            type="button"
            onClick={() => setComingSoon(false)}
            aria-label="Dismiss"
            className="shrink-0 rounded p-1 text-amber-100 hover:bg-amber-500/20"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      ) : null}
      {full ? <p className="text-xs text-amber-200">This match holds the maximum of {MAX_REPLAYS_PER_MATCH} replays. Delete one to add another.</p> : null}

      {replays.length === 0 ? (
        <section aria-label="No replays" className="rounded-lg border border-dashed border-zinc-700 p-8 text-center">
          <p className="text-sm text-zinc-300">No replays yet.</p>
          <p className="mt-1 text-xs text-zinc-400">
            {videoAnalysis ? 'Track players and the ball in a video segment, or annotate a play by hand.' : 'Annotate a play by hand. Video analysis is coming soon.'}
          </p>
        </section>
      ) : (
        <ul aria-label="Saved replays" className="flex flex-col gap-2">
          {replays.map((r) => (
            <li key={r.id}>
              <article aria-label={r.title} className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold">{r.title}</h3>
                  <p className="text-xs text-zinc-400">
                    {r.origin === 'tracking' ? 'Tracked segment' : REPLAY_EVENT_LABELS[r.event.type]} · {replayDuration(r).toFixed(1)} s · {ORIGIN_TEXT[r.origin]} ·{' '}
                    updated {new Date(r.updatedAt).toLocaleString()}
                  </p>
                </div>
                <Button size="sm" variant="primary" onClick={() => onPlay(r.id)} aria-label={`Play ${r.title}`}>
                  <Play size={14} aria-hidden /> Play
                </Button>
                <Button
                  size="sm"
                  onClick={() => onEdit(r)}
                  aria-label={`Edit ${r.title}`}
                >
                  <Pencil size={14} aria-hidden /> Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(r.id)} aria-label={`Delete ${r.title}`}>
                  <Trash2 size={14} aria-hidden />
                </Button>
                {confirmDelete === r.id ? (
                  <div className="w-full">
                    <ConfirmBar
                      message={`Delete the replay “${r.title}”? The match, board and events are not affected.`}
                      confirmLabel="Delete"
                      onConfirm={() => {
                        onDelete(r.id);
                        setConfirmDelete(null);
                      }}
                      onCancel={() => setConfirmDelete(null)}
                    />
                  </div>
                ) : null}
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
