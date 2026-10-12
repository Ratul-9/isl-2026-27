'use client';

import { useState } from 'react';
import { createId } from '@/domain/ids';
import { emptyReplay, replayFromAnalysis } from '@/domain/replay/build';
import { replayFromTracking, trackingFromServiceResult } from '@/domain/tracking/build';
import type { Id, TacticalReplay } from '@/domain/types';
import { useMatch, useMatchActions } from '@/store/MatchContext';
import { Button } from '@/components/ui/Button';
import { ClipImport, defaultClipDeps } from './ClipImport';
import type { AnalysedClip, ClipDeps } from './ClipImport';
import { ReplayEditor } from './ReplayEditor';
import { ReplayList } from './ReplayList';
import { ReplayViewer } from './ReplayViewer';
import type { AttachedVideo } from '@/components/tracking/AttachVideo';
import { TrackingEditor } from '@/components/tracking/TrackingEditor';
import { defaultTrackingDeps, TrackingImport } from '@/components/tracking/TrackingImport';
import type { TrackingDeps } from '@/components/tracking/TrackingImport';
import { TrackingViewer } from '@/components/tracking/TrackingViewer';

type Mode =
  | { kind: 'list' }
  | { kind: 'import' }
  | { kind: 'track' }
  | { kind: 'track-edit'; draft: TacticalReplay; isNew: boolean; video: AttachedVideo | null }
  | { kind: 'edit'; draft: TacticalReplay; isNew: boolean; clip: AnalysedClip | null; generation: number; busy?: boolean; error?: string }
  | { kind: 'view'; id: Id };

function draftFromClip(clip: AnalysedClip, keep?: { id: Id; createdAt: string }): TacticalReplay {
  const built = replayFromAnalysis(clip.analysis, {
    id: keep?.id ?? createId('rpl'),
    newId: createId,
    now: new Date().toISOString(),
    source: {
      fileName: clip.file.name.slice(0, 120),
      mimeType: clip.file.type || 'video/mp4',
      sizeBytes: clip.file.size,
      durationSeconds: clip.meta.durationSeconds,
      analysedAt: clip.meta.analysedAt,
      model: clip.meta.model.slice(0, 80),
      samplingFps: clip.meta.samplingFps || null,
    },
  });
  return keep ? { ...built, createdAt: keep.createdAt } : built;
}


/** The match's tactical replays: list, track a video, import from a clip, annotate by hand, review/edit, play. */
export function ReplaysView({ clipDeps = defaultClipDeps, trackingDeps = defaultTrackingDeps }: { clipDeps?: ClipDeps; trackingDeps?: TrackingDeps }) {
  const match = useMatch();
  const actions = useMatchActions();
  const [mode, setMode] = useState<Mode>({ kind: 'list' });

  if (mode.kind === 'track') {
    return (
      <TrackingImport
        deps={trackingDeps}
        onTracked={(file, result) => {
          const tracking = trackingFromServiceResult(result, file.name);
          const draft = replayFromTracking(tracking, { id: createId('rpl'), now: new Date().toISOString() });
          setMode({ kind: 'track-edit', draft, isNew: true, video: { file, url: URL.createObjectURL(file) } });
        }}
        onCancel={() => setMode({ kind: 'list' })}
      />
    );
  }

  if (mode.kind === 'track-edit') {
    return (
      <TrackingEditor
        key={mode.draft.id}
        initial={mode.draft}
        isNew={mode.isNew}
        video={mode.video}
        duration={trackingDeps.duration}
        onSave={(replay) => {
          const errors = actions.saveReplay(replay);
          if (errors.length === 0) {
            if (mode.video) URL.revokeObjectURL(mode.video.url);
            setMode({ kind: 'view', id: replay.id });
          }
          return errors;
        }}
        onCancel={() => {
          if (mode.video) URL.revokeObjectURL(mode.video.url);
          setMode(mode.isNew ? { kind: 'list' } : { kind: 'view', id: mode.draft.id });
        }}
      />
    );
  }

  if (mode.kind === 'import') {
    return (
      <ClipImport
        deps={clipDeps}
        onAnalysed={(clip) => setMode({ kind: 'edit', draft: draftFromClip(clip), isNew: true, clip, generation: 0 })}
        onManual={() => setMode({ kind: 'edit', draft: emptyReplay({ id: createId('rpl'), newId: createId, now: new Date().toISOString() }), isNew: true, clip: null, generation: 0 })}
        onCancel={() => setMode({ kind: 'list' })}
      />
    );
  }

  if (mode.kind === 'edit') {
    const { clip } = mode;
    async function regenerate() {
      if (!clip) return;
      setMode((m) => (m.kind === 'edit' ? { ...m, busy: true, error: undefined } : m));
      try {
        const result = await clipDeps.analyze(clip.file, clip.durationSeconds, new AbortController().signal);
        const fresh: AnalysedClip = { ...clip, ...result };
        setMode((m) =>
          m.kind === 'edit'
            ? { kind: 'edit', draft: draftFromClip(fresh, { id: m.draft.id, createdAt: m.draft.createdAt }), isNew: m.isNew, clip: fresh, generation: m.generation + 1 }
            : m,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Analysing the clip failed.';
        setMode((m) => (m.kind === 'edit' ? { ...m, busy: false, error: message } : m));
      }
    }
    return (
      <div className="flex flex-1 flex-col">
        {mode.error ? (
          <p role="alert" className="mx-auto mt-4 w-full max-w-[110rem] px-4 text-sm text-red-300">
            The clip could not be analysed again: {mode.error}
          </p>
        ) : null}
        <ReplayEditor
          // A fresh analysis replaces the draft, so the editor restarts from it.
          key={`${mode.draft.id}:${mode.generation}`}
          initial={mode.draft}
          isNew={mode.isNew}
          regenerate={clip ? { busy: !!mode.busy, onRegenerate: () => void regenerate() } : undefined}
          onSave={(replay) => {
            const errors = actions.saveReplay(replay);
            if (errors.length === 0) setMode({ kind: 'view', id: replay.id });
            return errors;
          }}
          onCancel={() => setMode(mode.isNew ? { kind: 'list' } : { kind: 'view', id: mode.draft.id })}
        />
      </div>
    );
  }

  if (mode.kind === 'view') {
    const replay = match.replays.find((r) => r.id === mode.id);
    if (!replay) {
      return (
        <div className="p-6">
          <p className="text-sm text-zinc-300">This replay no longer exists.</p>
          <Button className="mt-3" onClick={() => setMode({ kind: 'list' })}>
            Back to replays
          </Button>
        </div>
      );
    }
    const edit = () => setMode(replay.origin === 'tracking' ? { kind: 'track-edit', draft: replay, isNew: false, video: null } : { kind: 'edit', draft: replay, isNew: false, clip: null, generation: 0 });
    if (replay.origin === 'tracking') {
      return <TrackingViewer key={replay.id} replay={replay} duration={trackingDeps.duration} onBack={() => setMode({ kind: 'list' })} onEdit={edit} />;
    }
    return (
      <ReplayViewer
        key={replay.id}
        replay={replay}
        onBack={() => setMode({ kind: 'list' })}
        onEdit={edit}
      />
    );
  }

  return (
    <ReplayList
      replays={match.replays}
      onTrack={() => setMode({ kind: 'track' })}
      onImport={() => setMode({ kind: 'import' })}
      onCreate={() =>
        setMode({ kind: 'edit', draft: emptyReplay({ id: createId('rpl'), newId: createId, now: new Date().toISOString() }), isNew: true, clip: null, generation: 0 })
      }
      onPlay={(id) => setMode({ kind: 'view', id })}
      onEdit={(r) =>
        setMode(r.origin === 'tracking' ? { kind: 'track-edit', draft: r, isNew: false, video: null } : { kind: 'edit', draft: r, isNew: false, clip: null, generation: 0 })
      }
      onDelete={actions.deleteReplay}
    />
  );
}
