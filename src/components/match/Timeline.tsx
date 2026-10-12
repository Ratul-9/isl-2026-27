'use client';

import { ArrowRightLeft, CircleDot, Flag, Square, StickyNote, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { describeEvent } from '@/domain/events';
import type { AnalyzedEvent } from '@/domain/events';
import { teamDisplayName } from '@/domain/match';
import { PERIOD_LABELS } from '@/domain/time';
import type { Id, Match, MatchEvent } from '@/domain/types';
import { cn } from '@/lib/cn';

export type TimelineFilter = 'all' | 'goals' | 'substitutions' | 'cards' | 'notes';

export const FILTERS: { id: TimelineFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'goals', label: 'Goals' },
  { id: 'substitutions', label: 'Substitutions' },
  { id: 'cards', label: 'Cards' },
  { id: 'notes', label: 'Notes' },
];

function matchesFilter(event: MatchEvent, filter: TimelineFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'goals':
      return event.type === 'goal';
    case 'substitutions':
      return event.type === 'substitution';
    case 'cards':
      return event.type === 'yellowCard' || event.type === 'redCard';
    case 'notes':
      return event.type === 'note';
  }
}

function EventIcon({ event }: { event: MatchEvent }): ReactNode {
  switch (event.type) {
    case 'goal':
      return <CircleDot size={16} aria-hidden className="text-emerald-400" />;
    case 'substitution':
      return <ArrowRightLeft size={16} aria-hidden className="text-sky-400" />;
    case 'yellowCard':
      return <Square size={16} aria-hidden className="fill-yellow-400 text-yellow-400" />;
    case 'redCard':
      return <Square size={16} aria-hidden className="fill-red-500 text-red-500" />;
    case 'note':
      return <StickyNote size={16} aria-hidden className="text-zinc-400" />;
    case 'periodMarker':
      return <Flag size={16} aria-hidden className="text-zinc-400" />;
  }
}

interface Props {
  match: Match;
  entries: AnalyzedEvent[];
  filter: TimelineFilter;
  selectedId: Id | null;
  onSelect: (id: Id) => void;
}

/** Chronological event list, grouped by period; each entry opens the editor. */
export function Timeline({ match, entries, filter, selectedId, onSelect }: Props) {
  const visible = entries.filter((a) => matchesFilter(a.event, filter));

  if (entries.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-700 p-6 text-center text-sm text-zinc-400">
        No events yet. Kick off the match from the scoreboard, or record a goal, substitution, card or note.
      </p>
    );
  }
  if (visible.length === 0) {
    return <p className="rounded-lg border border-dashed border-zinc-700 p-6 text-center text-sm text-zinc-400">Nothing matches this filter.</p>;
  }

  return (
    <ol className="flex flex-col gap-1" aria-label="Match timeline">
      {visible.map((a, index) => {
        const e = a.event;
        // A period heading starts each group of entries.
        const heading = index === 0 || visible[index - 1].event.period !== e.period ? PERIOD_LABELS[e.period] : null;
        const teamId = 'teamId' in e ? e.teamId : undefined;
        const side = teamId === match.home.id ? 'home' : teamId === match.away.id ? 'away' : null;
        const text = describeEvent(match, e);
        const invalid = a.errors.length > 0;
        return (
          <li key={e.id}>
            {heading ? <h4 className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{heading}</h4> : null}
            <button
              type="button"
              onClick={() => onSelect(e.id)}
              aria-current={selectedId === e.id ? 'true' : undefined}
              aria-label={`${a.minute} ${side ? teamDisplayName(match[side], side) + ' ' : ''}${text}${invalid ? ' (invalid)' : ''}`}
              className={cn(
                'flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                selectedId === e.id ? 'border-emerald-500 bg-zinc-800' : 'border-transparent bg-zinc-900/60 hover:bg-zinc-800',
                e.type === 'periodMarker' && 'opacity-80',
                invalid && 'border-red-500/50',
              )}
            >
              <span className="w-14 shrink-0 pt-0.5 font-mono text-sm font-semibold tabular-nums text-zinc-200">{a.minute}</span>
              <span className="mt-0.5 shrink-0">
                <EventIcon event={e} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-zinc-100">{text}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-zinc-400">
                  {side ? (
                    <span className="flex items-center gap-1">
                      <span
                        aria-hidden
                        className={cn('h-2 w-2 rounded-full', side === 'home' ? 'bg-blue-600' : 'border border-zinc-500 bg-zinc-100')}
                      />
                      {teamDisplayName(match[side], side)}
                    </span>
                  ) : null}
                  {e.type === 'goal' && e.goalType === 'ownGoal' ? <span>credited to {side ? teamDisplayName(match[side], side) : 'team'}</span> : null}
                  {'notes' in e && e.notes ? <span className="truncate">{e.notes}</span> : null}
                  {e.type === 'substitution' && e.reason ? <span className="truncate">{e.reason}</span> : null}
                </span>
                {invalid ? (
                  <span className="mt-1 flex items-start gap-1 text-xs text-red-300">
                    <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
                    <span>Invalid — ignored in the score and lineups: {a.errors.join(' ')}</span>
                  </span>
                ) : a.warnings.length > 0 ? (
                  <span className="mt-1 flex items-start gap-1 text-xs text-amber-300">
                    <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
                    <span>{a.warnings.join(' ')}</span>
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
