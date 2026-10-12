'use client';

import { isPlayingPeriod, PERIOD_LABELS, periodIndex, PLAYING_PERIODS } from '@/domain/time';
import type { Match, Period } from '@/domain/types';
import { SelectField, TextField } from '@/components/ui/fields';
import { whenPreview } from './eventFormModel';

/** Period + minute + added time, with a live "recorded as 45+2'" preview. */
export function WhenFields({
  match,
  period,
  minute,
  added,
  matchTimeMs,
  allowBreaks,
  onChange,
}: {
  match: Match;
  period: Period;
  minute: string;
  added: string;
  matchTimeMs: number | null;
  /** Notes may be attached to a break (e.g. half time). */
  allowBreaks: boolean;
  onChange: (patch: { period?: Period; minute?: string; added?: string }) => void;
}) {
  // Extra-time periods are offered once the match has reached them (or the event is already there).
  const reachedExtra = periodIndex(match.clock.period) >= periodIndex('extraTimeFirstHalf') || period.startsWith('extraTime');
  const options: Period[] = [
    ...PLAYING_PERIODS.filter((p) => reachedExtra || !p.startsWith('extraTime')),
    ...(allowBreaks ? (['halfTime', 'fullTime'] as const) : []),
  ];
  const timed = isPlayingPeriod(period);
  const preview = whenPreview(match, period, matchTimeMs);

  return (
    <fieldset className="grid gap-3 sm:grid-cols-[1fr_6rem_6rem]">
      <legend className="mb-1 text-xs font-medium text-zinc-300">When</legend>
      <SelectField
        label="Period"
        value={period}
        onChange={(e) => onChange({ period: e.target.value as Period })}
      >
        {options.map((p) => (
          <option key={p} value={p}>
            {PERIOD_LABELS[p]}
          </option>
        ))}
      </SelectField>
      <TextField
        label="Minute"
        type="number"
        inputMode="numeric"
        min={1}
        value={timed ? minute : ''}
        disabled={!timed}
        onChange={(e) => onChange({ minute: e.target.value })}
      />
      <TextField
        label="Added (+)"
        type="number"
        inputMode="numeric"
        min={0}
        value={timed ? added : ''}
        disabled={!timed}
        onChange={(e) => onChange({ added: e.target.value })}
      />
      <p className="text-xs text-zinc-400 sm:col-span-3" aria-live="polite">
        {timed
          ? preview
            ? `Recorded as ${preview}`
            : 'Enter a valid minute.'
          : 'Breaks have no minute; the note is placed at the end of the previous half.'}
      </p>
    </fieldset>
  );
}
