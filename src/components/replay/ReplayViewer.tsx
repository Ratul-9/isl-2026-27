'use client';

import { useMemo } from 'react';
import { ArrowLeft, Pencil } from 'lucide-react';
import { teamDisplayName } from '@/domain/match';
import { REPLAY_EVENT_LABELS } from '@/domain/replay/eventTypes';
import { replayDuration } from '@/domain/replay/interpolate';
import type { TacticalReplay } from '@/domain/types';
import { useMatch } from '@/store/MatchContext';
import { Button } from '@/components/ui/Button';
import { ReplayPlayer } from './ReplayPlayer';
import { useReplayClock } from './useReplayClock';

/** Plays a SAVED replay from its stored animation data. No clip and no AI request is involved. */
export function ReplayViewer({ replay, onEdit, onBack }: { replay: TacticalReplay; onEdit: () => void; onBack: () => void }) {
  const match = useMatch();
  const teamNames = { home: teamDisplayName(match.home, 'home'), away: teamDisplayName(match.away, 'away') };
  const keyframeTimes = useMemo(() => replay.keyframes.map((k) => k.t), [replay.keyframes]);
  const playback = useReplayClock(replayDuration(replay), keyframeTimes);

  return (
    <div className="mx-auto grid w-full max-w-[110rem] flex-1 gap-4 px-4 py-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-3">
        <header className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onBack} aria-label="Back to replays">
            <ArrowLeft size={14} aria-hidden /> Replays
          </Button>
          <h2 className="mr-auto min-w-0 truncate text-base font-semibold">{replay.title}</h2>
          <Button size="sm" onClick={onEdit}>
            <Pencil size={14} aria-hidden /> Edit
          </Button>
        </header>
        <ReplayPlayer replay={replay} playback={playback} teamNames={teamNames} />
      </div>
      <aside aria-label="Replay details" className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-zinc-400">Event</dt>
          <dd>{REPLAY_EVENT_LABELS[replay.event.type]}</dd>
          {replay.event.matchClock ? (
            <>
              <dt className="text-zinc-400">Clock</dt>
              <dd>
                {replay.event.matchClock}
                {replay.event.period ? ` · ${replay.event.period}` : ''}
              </dd>
            </>
          ) : null}
          <dt className="text-zinc-400">Attacking</dt>
          <dd>
            {teamNames[replay.attackingSide]}
            {replay.attackingSideAssumed ? ' (assumed)' : ''}
          </dd>
          {replay.event.outcome ? (
            <>
              <dt className="text-zinc-400">Outcome</dt>
              <dd>{replay.event.outcome}</dd>
            </>
          ) : null}
          <dt className="text-zinc-400">Source</dt>
          <dd>{replay.origin === 'ai' ? `AI analysis${replay.source ? ` (${replay.source.model})` : ''}, then edited` : 'Annotated by hand'}</dd>
        </dl>
        {replay.event.description ? <p className="text-zinc-200">{replay.event.description}</p> : null}
        {replay.event.uncertainty.length > 0 ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-100">
            <p className="font-semibold">Uncertain or unknown</p>
            <ul className="mt-1 list-inside list-disc">
              {replay.event.uncertainty.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {replay.source ? (
          <p className="text-xs text-zinc-400">
            Clip: {replay.source.fileName} (not kept). Analysed {new Date(replay.source.analysedAt).toLocaleString()}
            {replay.source.samplingFps ? ` at ${replay.source.samplingFps} fps` : ''}.
          </p>
        ) : null}
      </aside>
    </div>
  );
}
