'use client';

import { REPLAY_EVENT_LABELS, REPLAY_EVENT_TYPES } from '@/domain/replay/eventTypes';
import { setAttackingSide, setNotes, setTitle, updateEvent } from '@/domain/replay/edit';
import { MAX_LONG_TEXT, MAX_TITLE } from '@/domain/replay/limits';
import type { ReplayEventType, TacticalReplay } from '@/domain/types';
import { SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { NumberField } from './NumberField';

const percent = (c: number | null) => (c === null ? 'unknown' : `${Math.round(c * 100)}%`);

/** What happened: type, description, where it sits in the clip, and which team is attacking. */
export function EventPanel({
  replay,
  teamNames,
  onChange,
}: {
  replay: TacticalReplay;
  teamNames: { home: string; away: string };
  onChange: (next: TacticalReplay) => void;
}) {
  const { event } = replay;
  return (
    <div className="flex flex-col gap-3">
      <TextField label="Title" value={replay.title} maxLength={MAX_TITLE} onChange={(e) => onChange(setTitle(replay, e.target.value))} />
      <SelectField
        label="Event type"
        value={event.type}
        onChange={(e) => onChange(updateEvent(replay, { type: e.target.value as ReplayEventType }))}
        hint={`AI confidence: ${percent(event.confidence)}`}
      >
        {REPLAY_EVENT_TYPES.map((t) => (
          <option key={t} value={t}>
            {REPLAY_EVENT_LABELS[t]}
          </option>
        ))}
      </SelectField>
      <TextAreaField
        label="Description"
        value={event.description}
        maxLength={MAX_LONG_TEXT}
        onChange={(e) => onChange(updateEvent(replay, { description: e.target.value }))}
      />
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Starts in the clip (s)" value={event.startSeconds} min={0} onCommit={(v) => onChange(updateEvent(replay, { startSeconds: v }))} />
        <NumberField label="Ends in the clip (s)" value={event.endSeconds} min={0} onCommit={(v) => onChange(updateEvent(replay, { endSeconds: v }))} />
        <TextField label="Match clock" value={event.matchClock} maxLength={40} onChange={(e) => onChange(updateEvent(replay, { matchClock: e.target.value }))} />
        <TextField label="Period" value={event.period} maxLength={40} onChange={(e) => onChange(updateEvent(replay, { period: e.target.value }))} />
      </div>
      <TextField label="Outcome" value={event.outcome} maxLength={300} onChange={(e) => onChange(updateEvent(replay, { outcome: e.target.value }))} />
      <SelectField
        label="Attacking team"
        value={replay.attackingSide}
        onChange={(e) => onChange(setAttackingSide(replay, e.target.value as 'home' | 'away'))}
        error={replay.attackingSideAssumed ? 'Not identified from the clip. Home is assumed — choose the team that is attacking.' : null}
        hint="Switching turns the whole play around to attack the other end."
      >
        <option value="home">{teamNames.home}</option>
        <option value="away">{teamNames.away}</option>
      </SelectField>

      {event.evidence.length > 0 ? (
        <div>
          <h3 className="text-xs font-semibold text-zinc-300">Evidence the AI gave</h3>
          <ul className="mt-1 list-inside list-disc text-xs text-zinc-400">
            {event.evidence.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {event.uncertainty.length > 0 ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
          <h3 className="text-xs font-semibold text-amber-100">Uncertain or unknown</h3>
          <ul className="mt-1 list-inside list-disc text-xs text-amber-100">
            {event.uncertainty.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <TextAreaField label="Notes" value={replay.notes} maxLength={MAX_LONG_TEXT} onChange={(e) => onChange(setNotes(replay, e.target.value))} />
    </div>
  );
}
