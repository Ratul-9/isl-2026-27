'use client';

import { useMemo, useState } from 'react';
import { RefreshCw, RotateCcw, Save } from 'lucide-react';
import { createId } from '@/domain/ids';
import { teamDisplayName } from '@/domain/match';
import { moveActor } from '@/domain/replay/edit';
import { replayDuration } from '@/domain/replay/interpolate';
import type { Id, TacticalReplay } from '@/domain/types';
import { useMatch } from '@/store/MatchContext';
import { Button } from '@/components/ui/Button';
import { ConfirmBar } from '@/components/ui/ConfirmBar';
import { cn } from '@/lib/cn';
import { ActorsPanel } from './ActorsPanel';
import { EventPanel } from './EventPanel';
import { ReplayPlayer } from './ReplayPlayer';
import { AnnotationsPanel, KeyframesPanel, PathsPanel } from './TimelinePanels';
import { useReplayClock } from './useReplayClock';

type PanelId = 'event' | 'players' | 'keyframes' | 'arrows' | 'labels';
const PANELS: { id: PanelId; label: string }[] = [
  { id: 'event', label: 'Event' },
  { id: 'players', label: 'Players' },
  { id: 'keyframes', label: 'Keyframes' },
  { id: 'arrows', label: 'Arrows' },
  { id: 'labels', label: 'Labels' },
];

/**
 * The review screen. Everything edited here is a local draft; the match is
 * only touched when the user saves, and the replay preview always shows the
 * edited draft.
 */
export function ReplayEditor({
  initial,
  isNew,
  regenerate,
  onSave,
  onCancel,
}: {
  initial: TacticalReplay;
  isNew: boolean;
  /** Present only while the source clip is still in memory; running it is an explicit, costly choice. */
  regenerate?: { busy: boolean; onRegenerate: () => void };
  /** Returns the reasons the replay was refused; an empty list means it was saved. */
  onSave: (replay: TacticalReplay) => string[];
  onCancel: () => void;
}) {
  const match = useMatch();
  const teamNames = { home: teamDisplayName(match.home, 'home'), away: teamDisplayName(match.away, 'away') };
  const [draft, setDraft] = useState<TacticalReplay>(initial);
  const [panel, setPanel] = useState<PanelId>('event');
  const [selectedActor, setSelectedActor] = useState<Id | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<'discard' | 'revert' | 'regenerate' | null>(null);

  const keyframeTimes = useMemo(() => draft.keyframes.map((k) => k.t), [draft.keyframes]);
  const playback = useReplayClock(replayDuration(draft), keyframeTimes);
  const dirty = draft !== initial;

  function save() {
    const refused = onSave(draft);
    setErrors(refused);
  }

  return (
    <div className="mx-auto grid w-full max-w-[110rem] flex-1 gap-4 px-4 py-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="flex min-w-0 flex-col gap-3">
        <header className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-base font-semibold">{isNew ? 'Review replay' : 'Edit replay'}</h2>
          {regenerate ? (
            <Button size="sm" onClick={() => setConfirm('regenerate')} disabled={regenerate.busy}>
              <RefreshCw size={14} aria-hidden /> Analyse the clip again
            </Button>
          ) : null}
          <Button size="sm" onClick={() => setConfirm('revert')} disabled={!dirty}>
            <RotateCcw size={14} aria-hidden /> Revert edits
          </Button>
          <Button size="sm" onClick={() => (dirty ? setConfirm('discard') : onCancel())}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={save}>
            <Save size={14} aria-hidden /> Save replay
          </Button>
        </header>

        {confirm === 'discard' ? (
          <ConfirmBar message="Discard this replay and your edits?" confirmLabel="Discard" onConfirm={onCancel} onCancel={() => setConfirm(null)} />
        ) : null}
        {confirm === 'revert' ? (
          <ConfirmBar
            message="Revert every edit made in this session?"
            confirmLabel="Revert"
            onConfirm={() => {
              setDraft(initial);
              setErrors([]);
              setConfirm(null);
            }}
            onCancel={() => setConfirm(null)}
          />
        ) : null}
        {confirm === 'regenerate' && regenerate ? (
          <ConfirmBar
            message="Analyse the clip again? This sends it to the AI service again (it uses API quota) and replaces everything shown here, including your edits."
            confirmLabel="Analyse again"
            onConfirm={() => {
              setConfirm(null);
              regenerate.onRegenerate();
            }}
            onCancel={() => setConfirm(null)}
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

        <ReplayPlayer
          replay={draft}
          playback={playback}
          teamNames={teamNames}
          editing={{
            selectedActorId: selectedActor,
            onSelect: setSelectedActor,
            onMove: (actorId, point) => {
              playback.pause();
              setDraft((d) => moveActor(d, actorId, playback.time, point, createId));
            },
          }}
        />
      </div>

      <aside aria-label="Replay editor" className="flex min-w-0 flex-col gap-3">
        <div role="tablist" aria-label="Replay sections" className="flex flex-wrap gap-1 rounded-md bg-zinc-900 p-1">
          {PANELS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              id={`replay-tab-${p.id}`}
              aria-selected={panel === p.id}
              aria-controls={`replay-panel-${p.id}`}
              onClick={() => setPanel(p.id)}
              className={cn(
                'rounded px-3 py-1.5 text-xs font-medium',
                panel === p.id ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-100',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id={`replay-panel-${panel}`}
          aria-labelledby={`replay-tab-${panel}`}
          className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4"
        >
          {panel === 'event' ? <EventPanel replay={draft} teamNames={teamNames} onChange={setDraft} /> : null}
          {panel === 'players' ? (
            <ActorsPanel replay={draft} match={match} selectedId={selectedActor} onSelect={setSelectedActor} onChange={setDraft} />
          ) : null}
          {panel === 'keyframes' ? <KeyframesPanel replay={draft} playback={playback} onChange={setDraft} /> : null}
          {panel === 'arrows' ? <PathsPanel replay={draft} playback={playback} onChange={setDraft} /> : null}
          {panel === 'labels' ? <AnnotationsPanel replay={draft} playback={playback} onChange={setDraft} /> : null}
        </div>
      </aside>
    </div>
  );
}
