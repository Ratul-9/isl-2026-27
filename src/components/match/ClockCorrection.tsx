'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { currentMatchTimeMs, elapsedForMatchTime } from '@/domain/clock';
import {
  formatClockTime,
  isPlayingPeriod,
  MAX_STOPPAGE_MINUTES,
  MINUTE_MS,
  PERIOD_LABELS,
  PERIOD_ORDER,
  periodBounds,
} from '@/domain/time';
import type { ClockState, Period } from '@/domain/types';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/fields';

/** Parses "mm:ss" or "m" (minutes) into ms; null when malformed. */
function parseClockInput(text: string): number | null {
  const m = /^\s*(\d{1,3})(?::([0-5]?\d))?\s*$/.exec(text);
  if (!m) return null;
  return (Number(m[1]) * 60 + Number(m[2] ?? 0)) * 1000;
}

interface Props {
  clock: ClockState;
  durationMinutes: number;
  now: number;
  onApply: (correction: { period: Period; elapsedMs: number }) => void;
  onClose: () => void;
}

/** Manual correction: choose the period and set the match time shown on the clock. */
export function ClockCorrection({ clock, durationMinutes, now, onApply, onClose }: Props) {
  const [period, setPeriod] = useState<Period>(clock.period);
  const [timeText, setTimeText] = useState(() => formatClockTime(currentMatchTimeMs(clock, now, durationMinutes)));
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (isPlayingPeriod(period)) {
      const ms = parseClockInput(timeText);
      if (ms === null) return setError('Enter the time as mm:ss, e.g. 67:30.');
      const { startMs, endMs } = periodBounds(period, durationMinutes);
      if (ms < startMs || ms > endMs + MAX_STOPPAGE_MINUTES * MINUTE_MS) {
        return setError(`For this period the clock runs from ${formatClockTime(startMs)} to ${formatClockTime(endMs)} plus stoppage.`);
      }
      onApply({ period, elapsedMs: elapsedForMatchTime(period, ms, durationMinutes) });
    } else if (period === 'halfTime' || period === 'fullTime') {
      // A break shows the end of the half it follows.
      onApply({ period, elapsedMs: (durationMinutes / 2) * MINUTE_MS });
    } else {
      onApply({ period, elapsedMs: 0 });
    }
    onClose();
  }

  const timed = isPlayingPeriod(period);
  return (
    <form
      onSubmit={submit}
      aria-label="Correct match clock"
      className="grid gap-3 rounded-md border border-zinc-700 bg-zinc-900 p-3 sm:grid-cols-[1fr_1fr_auto]"
    >
      <SelectField label="Period" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
        {PERIOD_ORDER.map((p) => (
          <option key={p} value={p}>
            {PERIOD_LABELS[p]}
          </option>
        ))}
      </SelectField>
      <TextField
        label="Match time (mm:ss)"
        value={timed ? timeText : ''}
        disabled={!timed}
        placeholder={timed ? '67:30' : 'Not used'}
        error={error}
        inputMode="numeric"
        onChange={(e) => {
          setTimeText(e.target.value);
          setError(null);
        }}
        hint={timed ? 'On the match scale: the second half starts at 45:00.' : undefined}
      />
      <div className="flex items-end gap-2">
        <Button type="submit" variant="primary">
          Set clock
        </Button>
        <Button onClick={onClose} variant="ghost">
          Cancel
        </Button>
      </div>
    </form>
  );
}
