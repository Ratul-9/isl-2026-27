'use client';

import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { analyzeEvents, checkEventChange, checkEventDeletion, EVENT_TYPE_LABELS, timelineText } from '@/domain/events';
import type { Match, MatchEvent } from '@/domain/types';
import { useMatchActions } from '@/store/MatchContext';
import type { EventDraft } from '@/store/MatchContext';
import { Button } from '@/components/ui/Button';
import { ConfirmBar } from '@/components/ui/ConfirmBar';
import { buildCandidate, formStateFromEvent, initialFormState, lineupAtMoment } from './eventFormModel';
import type { EventFormKind, EventFormState } from './eventFormModel';
import { CardFields, GoalFields, NoteFields, SubstitutionFields } from './EventFields';
import { WhenFields } from './WhenFields';

const TITLES: Record<EventFormKind, string> = {
  goal: 'goal',
  substitution: 'substitution',
  card: 'card',
  note: 'note',
  marker: 'period marker',
};

interface Props {
  match: Match;
  kind: EventFormKind;
  /** Present when editing an existing event. */
  editing?: MatchEvent;
  /** Epoch ms when the form was opened, used to default to the live minute. */
  openedAt: number;
  onClose: () => void;
}

/** Add or edit one match event, with live validation against the match at that moment. */
export function EventForm({ match, kind, editing, openedAt, onClose }: Props) {
  const actions = useMatchActions();
  const [state, setState] = useState<EventFormState>(() =>
    editing ? formStateFromEvent(match, editing) : initialFormState(kind, match, openedAt),
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const patch = (p: Partial<EventFormState>) => setState((s) => ({ ...s, ...p }));

  const candidate = useMemo(() => buildCandidate(match, state, editing?.id ?? 'new'), [match, state, editing?.id]);
  const check = useMemo(
    () => (candidate.event ? checkEventChange(match, candidate.event) : null),
    [match, candidate.event],
  );
  const lineups = useMemo(
    () => lineupAtMoment(match, editing?.id, state.period, candidate.matchTimeMs),
    [match, editing?.id, state.period, candidate.matchTimeMs],
  );
  const dependants = useMemo(
    () => (editing && confirmDelete ? checkEventDeletion(match, editing.id).map((a) => timelineText(match, a)) : []),
    [match, editing, confirmDelete],
  );

  const errors = check?.errors ?? [];
  const canSave = candidate.event !== null && errors.length === 0;
  const flagged = check?.newlyInvalid ?? [];

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!candidate.event || !canSave) return;
    if (editing) {
      if (actions.updateEvent(candidate.event).errors.length > 0) return;
    } else {
      const draft = Object.fromEntries(Object.entries(candidate.event).filter(([key]) => key !== 'id'));
      if (actions.addEvent(draft as EventDraft).errors.length > 0) return;
    }
    onClose();
  }

  const heading = `${editing ? 'Edit' : 'Record'} ${TITLES[state.kind]}`;
  const analysis = useMemo(() => (editing ? analyzeEvents(match).byId.get(editing.id) : undefined), [match, editing]);

  return (
    <form onSubmit={submit} aria-label={heading} noValidate className="flex flex-col gap-4 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{heading}</h3>
        {editing ? <span className="text-xs text-zinc-400">{EVENT_TYPE_LABELS[editing.type]}</span> : null}
      </div>

      {analysis && analysis.errors.length > 0 ? (
        <div role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">
          This event is currently invalid and is ignored in the score and lineups: {analysis.errors.join(' ')}
        </div>
      ) : null}

      <WhenFields
        match={match}
        period={state.period}
        minute={state.minute}
        added={state.added}
        matchTimeMs={candidate.matchTimeMs}
        allowBreaks={state.kind === 'note'}
        onChange={patch}
      />

      {state.kind === 'goal' ? <GoalFields match={match} state={state} lineups={lineups} onChange={patch} /> : null}
      {state.kind === 'substitution' ? <SubstitutionFields match={match} state={state} lineups={lineups} onChange={patch} /> : null}
      {state.kind === 'card' ? <CardFields match={match} state={state} lineups={lineups} onChange={patch} /> : null}
      {state.kind === 'note' ? <NoteFields match={match} state={state} onChange={patch} /> : null}

      {candidate.problems.length > 0 ? (
        <ul className="list-inside list-disc text-xs text-zinc-400">
          {candidate.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      {errors.length > 0 ? (
        <ul role="alert" className="list-inside list-disc rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">
          {errors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
      {check && check.warnings.length > 0 ? (
        <ul className="list-inside list-disc rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-100" aria-label="Warnings">
          {check.warnings.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
      {flagged.length > 0 ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-100" aria-label="Later events affected">
          <p>Saving this will make {flagged.length === 1 ? 'a later event' : `${flagged.length} later events`} invalid (they are then ignored until fixed):</p>
          <ul className="mt-1 list-inside list-disc">
            {flagged.map((a) => (
              <li key={a.event.id}>{timelineText(match, a)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={!canSave}>
          {editing ? (flagged.length > 0 ? `Save and flag ${flagged.length}` : 'Save changes') : 'Add to timeline'}
        </Button>
        <Button onClick={onClose} variant="ghost">
          Cancel
        </Button>
        {editing ? (
          <Button variant="danger" size="sm" className="ml-auto" onClick={() => setConfirmDelete(true)} disabled={confirmDelete}>
            <Trash2 size={14} aria-hidden /> Delete event
          </Button>
        ) : null}
      </div>

      {editing && confirmDelete ? (
        <ConfirmBar
          message={
            dependants.length > 0
              ? `Delete this event? ${dependants.length} later event${dependants.length === 1 ? '' : 's'} will become invalid: ${dependants.join('; ')}.`
              : 'Delete this event? The score and lineups will update.'
          }
          confirmLabel="Delete"
          onConfirm={() => {
            actions.deleteEvent(editing.id);
            onClose();
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </form>
  );
}
