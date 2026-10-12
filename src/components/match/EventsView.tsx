'use client';

import { useMemo, useState } from 'react';
import { ArrowRightLeft, CircleDot, Square, StickyNote } from 'lucide-react';
import type { ComponentType } from 'react';
import { useMatch, useMatchAnalysis } from '@/store/MatchContext';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/fields';
import { EventForm } from './EventForm';
import type { EventFormKind } from './eventFormModel';
import { FILTERS, Timeline } from './Timeline';
import type { TimelineFilter } from './Timeline';
import type { Id } from '@/domain/types';

const RECORD: { kind: EventFormKind; label: string; icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }> }[] = [
  { kind: 'goal', label: 'Goal', icon: CircleDot },
  { kind: 'substitution', label: 'Substitution', icon: ArrowRightLeft },
  { kind: 'card', label: 'Card', icon: Square },
  { kind: 'note', label: 'Note', icon: StickyNote },
];

type FormMode = { type: 'new'; kind: EventFormKind; openedAt: number; key: number } | { type: 'edit'; id: Id; key: number } | null;

/** Event entry on the left, chronological timeline on the right. */
export function EventsView({ initialKind }: { initialKind?: EventFormKind }) {
  const match = useMatch();
  const analysis = useMatchAnalysis();
  const [filter, setFilter] = useState<TimelineFilter>('all');
  // `key` remounts the form so each opening starts from fresh defaults.
  const [form, setForm] = useState<FormMode>(() =>
    initialKind ? { type: 'new', kind: initialKind, openedAt: Date.now(), key: 1 } : null,
  );

  const editing = form?.type === 'edit' ? match.events.find((e) => e.id === form.id) : undefined;
  const problemCount = useMemo(() => analysis.ordered.filter((a) => a.errors.length > 0).length, [analysis]);
  const nextKey = (form?.key ?? 0) + 1;

  return (
    <div className="mx-auto grid w-full max-w-7xl flex-1 gap-6 px-4 py-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <section aria-label="Record an event" className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Record an event</h2>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Event type">
          {RECORD.map(({ kind, label, icon: Icon }) => (
            <Button
              key={kind}
              variant={form?.type === 'new' && form.kind === kind ? 'primary' : 'secondary'}
              onClick={() => setForm({ type: 'new', kind, openedAt: Date.now(), key: nextKey })}
              aria-pressed={form?.type === 'new' && form.kind === kind}
            >
              <Icon size={16} aria-hidden /> {label}
            </Button>
          ))}
        </div>

        {form?.type === 'new' ? (
          <EventForm key={form.key} match={match} kind={form.kind} openedAt={form.openedAt} onClose={() => setForm(null)} />
        ) : editing && form?.type === 'edit' ? (
          <EventForm
            key={`${form.key}-${editing.id}`}
            match={match}
            kind={editing.type === 'periodMarker' ? 'marker' : editing.type === 'redCard' || editing.type === 'yellowCard' ? 'card' : editing.type}
            editing={editing}
            openedAt={0}
            onClose={() => setForm(null)}
          />
        ) : (
          <p className="rounded-lg border border-dashed border-zinc-700 p-4 text-sm text-zinc-400">
            Choose an event type to record it at the current match time, or select a timeline entry to inspect or edit it.
          </p>
        )}
      </section>

      <section aria-label="Timeline" className="min-w-0">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Timeline</h2>
            <p className="text-xs text-zinc-400">
              {match.events.length} event{match.events.length === 1 ? '' : 's'}
              {problemCount > 0 ? ` · ${problemCount} invalid` : ''}
            </p>
          </div>
          <SelectField
            label="Show"
            value={filter}
            onChange={(e) => setFilter(e.target.value as TimelineFilter)}
            wrapperClassName="w-40"
            className="h-9"
          >
            {FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </SelectField>
        </div>
        <Timeline
          match={match}
          entries={analysis.ordered}
          filter={filter}
          selectedId={form?.type === 'edit' ? form.id : null}
          onSelect={(id) => setForm({ type: 'edit', id, key: nextKey })}
        />
      </section>
    </div>
  );
}
