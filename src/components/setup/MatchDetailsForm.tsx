'use client';

import { useState } from 'react';
import { durationError, MATCH_STATUSES } from '@/domain/match';
import type { MatchStatus } from '@/domain/types';
import { useMatch, useMatchActions } from '@/store/MatchContext';
import { SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { Section } from '@/components/ui/Section';

export function MatchDetailsForm() {
  const match = useMatch();
  const { updateInfo } = useMatchActions();

  // The duration box holds free text while typing; only a valid value reaches the store.
  const [durationText, setDurationText] = useState(String(match.durationMinutes));
  const durationValue = durationText.trim() === '' ? null : Number(durationText);
  const durationProblem = durationError(durationValue);

  return (
    <Section title="Match details" description="Everything here can be changed at any time.">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Match name"
          hint="Optional. Defaults to “Home vs Away”."
          value={match.name}
          onChange={(e) => updateInfo({ name: e.target.value })}
          maxLength={80}
          wrapperClassName="sm:col-span-2"
        />
        <TextField
          label="Competition or tournament"
          value={match.competition}
          onChange={(e) => updateInfo({ competition: e.target.value })}
          maxLength={80}
        />
        <TextField
          label="Venue or stadium"
          value={match.venue}
          onChange={(e) => updateInfo({ venue: e.target.value })}
          maxLength={80}
        />
        <TextField
          label="Match date"
          type="date"
          value={match.date}
          onChange={(e) => updateInfo({ date: e.target.value })}
        />
        <TextField
          label="Kickoff time"
          type="time"
          value={match.kickoffTime}
          onChange={(e) => updateInfo({ kickoffTime: e.target.value })}
        />
        <TextField
          label="Match duration (minutes)"
          type="number"
          inputMode="numeric"
          min={10}
          max={180}
          value={durationText}
          error={durationProblem}
          onChange={(e) => {
            const text = e.target.value;
            setDurationText(text);
            const n = text.trim() === '' ? null : Number(text);
            if (durationError(n) === null && n !== null) updateInfo({ durationMinutes: n });
          }}
          onBlur={() => {
            if (durationProblem) setDurationText(String(match.durationMinutes));
          }}
          hint="Regulation time, normally 90."
        />
        <SelectField
          label="Match status"
          value={match.status}
          onChange={(e) => updateInfo({ status: e.target.value as MatchStatus })}
        >
          {MATCH_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </SelectField>
        <TextAreaField
          label="Match notes"
          value={match.notes}
          onChange={(e) => updateInfo({ notes: e.target.value })}
          maxLength={2000}
          wrapperClassName="sm:col-span-2"
        />
      </div>
    </Section>
  );
}
