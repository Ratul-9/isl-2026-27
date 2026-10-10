'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { POSITION_GROUPS, POSITIONS } from '@/domain/positions';
import { MAX_SHIRT_NUMBER, MIN_SHIRT_NUMBER } from '@/domain/squad';
import type { PlayerDraft, PlayerDraftErrors } from '@/domain/squad';
import type { LineupRole, PositionCode } from '@/domain/types';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/fields';

export function PositionOptions() {
  return (
    <>
      {POSITION_GROUPS.map((group) => (
        <optgroup key={group} label={group}>
          {POSITIONS.filter((p) => p.group === group).map((p) => (
            <option key={p.code} value={p.code}>
              {p.code} — {p.name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

interface PlayerFormProps {
  /** Starting values; the form is remounted (via `key`) when these should reset. */
  initial: PlayerDraft;
  submitLabel: string;
  /** Returns validation errors, or `{}` when the draft was accepted. */
  onSubmit: (draft: PlayerDraft) => PlayerDraftErrors;
  onCancel?: () => void;
  /** Called after an accepted submit (e.g. to remount the form for the next player). */
  onAccepted?: () => void;
  /** Move focus to the name field on mount (used when editing and after each add). */
  autoFocusName?: boolean;
}

export function PlayerForm({ initial, submitLabel, onSubmit, onCancel, onAccepted, autoFocusName }: PlayerFormProps) {
  const [name, setName] = useState(initial.name);
  const [numberText, setNumberText] = useState(initial.shirtNumber === null ? '' : String(initial.shirtNumber));
  const [position, setPosition] = useState<PositionCode>(initial.preferredPosition);
  const [role, setRole] = useState<LineupRole>(initial.role);
  const [notes, setNotes] = useState(initial.notes);
  const [errors, setErrors] = useState<PlayerDraftErrors>({});
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocusName) nameRef.current?.focus();
  }, [autoFocusName]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = numberText.trim();
    const parsed = trimmed === '' ? null : Number(trimmed);
    const result = onSubmit({
      name,
      shirtNumber: parsed !== null && Number.isFinite(parsed) ? parsed : null,
      preferredPosition: position,
      notes,
      role,
    });
    setErrors(result);
    if (Object.keys(result).length === 0) onAccepted?.();
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label={submitLabel} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
        <TextField
          label="Full name"
          value={name}
          error={errors.name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          maxLength={80}
          ref={nameRef}
        />
        <TextField
          label="Shirt number"
          type="number"
          inputMode="numeric"
          min={MIN_SHIRT_NUMBER}
          max={MAX_SHIRT_NUMBER}
          value={numberText}
          error={errors.shirtNumber}
          onChange={(e) => setNumberText(e.target.value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Preferred position"
          value={position}
          error={errors.preferredPosition}
          onChange={(e) => setPosition(e.target.value as PositionCode)}
        >
          <PositionOptions />
        </SelectField>
        <SelectField
          label="Lineup role"
          value={role}
          error={errors.role}
          onChange={(e) => setRole(e.target.value as LineupRole)}
        >
          <option value="starter">Starting XI</option>
          <option value="substitute">Substitute</option>
        </SelectField>
      </div>
      <TextAreaField
        label="Notes (optional)"
        value={notes}
        error={errors.notes}
        onChange={(e) => setNotes(e.target.value)}
        className="min-h-16"
      />
      {errors.form ? (
        <p role="alert" className="text-xs text-red-400">
          {errors.form}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary">
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button onClick={onCancel} variant="ghost">
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
