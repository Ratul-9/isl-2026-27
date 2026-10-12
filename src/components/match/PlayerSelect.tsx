'use client';

import type { Id } from '@/domain/types';
import { SelectField } from '@/components/ui/fields';
import { playerLabel } from './eventFormModel';
import type { PlayerGroup } from './eventFormModel';

/** Player picker with grouped options. `emptyLabel` adds an explicit "none" choice. */
export function PlayerSelect({
  label,
  value,
  groups,
  emptyLabel,
  placeholder = 'Choose a player…',
  hint,
  error,
  onChange,
}: {
  label: string;
  value: Id | '';
  groups: PlayerGroup[];
  emptyLabel?: string;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  onChange: (id: Id | '') => void;
}) {
  // A previously chosen player who is no longer offered must stay visible, not vanish.
  const offered = new Set(groups.flatMap((g) => g.players.map((p) => p.id)));
  const missing = value !== '' && !offered.has(value);
  return (
    <SelectField label={label} value={value} hint={hint} error={error} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel ?? placeholder}</option>
      {missing ? <option value={value}>{`Unavailable player (${value})`}</option> : null}
      {groups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.players.map((p) => (
            <option key={p.id} value={p.id}>
              {playerLabel(p)}
            </option>
          ))}
        </optgroup>
      ))}
    </SelectField>
  );
}
