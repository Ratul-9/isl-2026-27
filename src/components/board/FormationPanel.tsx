'use client';

import { useState } from 'react';
import { RotateCcw, Save, Trash2 } from 'lucide-react';
import { FORMATIONS } from '@/domain/formations';
import { isLayoutModified } from '@/domain/layout';
import { getTeam, teamDisplayName } from '@/domain/match';
import type { FormationRef, TeamSide } from '@/domain/types';
import { MAX_LAYOUT_NAME_LENGTH } from '@/store/matchReducer';
import { useMatch, useMatchActions } from '@/store/MatchContext';
import { Button } from '@/components/ui/Button';
import { ConfirmBar } from '@/components/ui/ConfirmBar';
import { SelectField, TextField } from '@/components/ui/fields';
import { decodeFormation, encodeFormation, formationLabel } from './formationOptions';

/** Formation selector, reset and "save arrangement" for one team. */
export function FormationPanel({ side }: { side: TeamSide }) {
  const match = useMatch();
  const actions = useMatchActions();
  const team = getTeam(match, side);
  const name = teamDisplayName(team, side);
  const modified = isLayoutModified(team, side, match.savedLayouts);
  const [pending, setPending] = useState<FormationRef | null>(null);
  const [layoutName, setLayoutName] = useState('');
  const [saved, setSaved] = useState<string | null>(null);

  function choose(value: string) {
    const ref = decodeFormation(value, match.savedLayouts);
    if (!ref) return;
    setSaved(null);
    // Never silently discard a custom arrangement.
    if (modified) setPending(ref);
    else actions.applyFormation(side, ref);
  }

  function save() {
    const trimmed = layoutName.trim();
    if (!trimmed) return;
    actions.saveLayout(side, trimmed);
    setSaved(trimmed);
    setLayoutName('');
  }

  return (
    <section aria-label={`${name} formation`} className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={side === 'home' ? 'h-3 w-3 rounded-full bg-blue-700' : 'h-3 w-3 rounded-full border border-zinc-500 bg-zinc-100'}
        />
        <h3 className="truncate text-sm font-semibold">{name}</h3>
        {modified ? <span className="ml-auto text-[11px] text-amber-300">Custom positions</span> : null}
      </div>

      <SelectField label="Formation" value={encodeFormation(team.formation)} onChange={(e) => choose(e.target.value)}>
        <optgroup label="Presets">
          {FORMATIONS.map((f) => (
            <option key={f.id} value={encodeFormation({ kind: 'preset', id: f.id })}>
              {f.label}
            </option>
          ))}
        </optgroup>
        {match.savedLayouts.length > 0 ? (
          <optgroup label="Saved arrangements">
            {match.savedLayouts.map((l) => (
              <option key={l.id} value={encodeFormation({ kind: 'saved', id: l.id })}>
                {l.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </SelectField>

      {pending ? (
        <ConfirmBar
          message={`Switching to ${formationLabel(pending, match.savedLayouts)} replaces ${name}'s custom positions.`}
          confirmLabel="Switch"
          onConfirm={() => {
            actions.applyFormation(side, pending);
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      ) : null}

      <Button
        size="sm"
        onClick={() => actions.resetFormation(side)}
        disabled={!modified}
        title={modified ? 'Move every player back to the formation positions' : 'Players are already in formation positions'}
      >
        <RotateCcw size={14} aria-hidden /> Reset to {formationLabel(team.formation, match.savedLayouts)}
      </Button>

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <TextField
          label="Save current arrangement as"
          value={layoutName}
          onChange={(e) => setLayoutName(e.target.value)}
          maxLength={MAX_LAYOUT_NAME_LENGTH}
          placeholder="e.g. Pressing 4-4-2"
          wrapperClassName="flex-1"
          className="h-9"
        />
        <Button size="md" type="submit" disabled={!layoutName.trim()} aria-label={`Save ${name} arrangement`} className="h-9">
          <Save size={14} aria-hidden /> Save
        </Button>
      </form>
      {saved ? (
        <p role="status" className="text-xs text-emerald-400">
          Saved “{saved}”. It is now in the formation list for both teams.
        </p>
      ) : null}
    </section>
  );
}

/** Lists saved arrangements with delete (confirmed inline). Hidden when there are none. */
export function SavedLayoutsPanel() {
  const match = useMatch();
  const actions = useMatchActions();
  const [confirming, setConfirming] = useState<string | null>(null);
  if (match.savedLayouts.length === 0) return null;

  return (
    <section aria-label="Saved arrangements" className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <h3 className="text-sm font-semibold">Saved arrangements</h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {match.savedLayouts.map((l) => (
          <li key={l.id} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{l.name}</span>
              <span className="text-xs text-zinc-500">from {l.baseFormation}</span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Delete saved arrangement ${l.name}`}
                title="Delete"
                onClick={() => setConfirming(l.id)}
              >
                <Trash2 size={14} aria-hidden />
              </Button>
            </div>
            {confirming === l.id ? (
              <ConfirmBar
                message={`Delete “${l.name}”? Teams using it keep their positions and fall back to ${l.baseFormation}.`}
                confirmLabel="Delete"
                onConfirm={() => {
                  actions.deleteLayout(l.id);
                  setConfirming(null);
                }}
                onCancel={() => setConfirming(null)}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
