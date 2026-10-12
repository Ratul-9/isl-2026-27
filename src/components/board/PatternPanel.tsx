'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { isLayoutModified } from '@/domain/layout';
import { getTeam, teamDisplayName } from '@/domain/match';
import { getPattern, isPatternId, PATTERNS } from '@/domain/patterns';
import type { PatternId } from '@/domain/patterns';
import type { TeamSide } from '@/domain/types';
import { useMatch, useMatchActions } from '@/store/MatchContext';
import { Button } from '@/components/ui/Button';
import { ConfirmBar } from '@/components/ui/ConfirmBar';
import { SelectField } from '@/components/ui/fields';
import { cn } from '@/lib/cn';

/**
 * Tactical pattern library: apply a phase-of-play shape + arrows to one team. Shown inside the Tactical Bench
 * dropdown / fullscreen overlay (`embedded`: no card chrome or heading, the frame supplies them).
 * `onApplied` runs after a pattern was applied (the bench closes itself).
 */
export function PatternPanel({ embedded = false, onApplied }: { embedded?: boolean; onApplied?: () => void }) {
  const match = useMatch();
  const actions = useMatchActions();
  const [side, setSide] = useState<TeamSide>('home');
  const [patternId, setPatternId] = useState<PatternId>('high-press');
  const [confirmApply, setConfirmApply] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const team = getTeam(match, side);
  const name = teamDisplayName(team, side);
  const pattern = getPattern(patternId);
  const modified = isLayoutModified(team, side, match.savedLayouts);

  function apply() {
    try {
      actions.applyPattern(side, patternId);
    } catch (e) {
      // Keep the panel open so the user can retry or cancel.
      setError(e instanceof Error ? e.message : 'The pattern could not be applied.');
      return;
    }
    setError(null);
    setConfirmApply(false);
    onApplied?.();
  }

  return (
    <section
      aria-label="Tactical patterns"
      className={cn('flex flex-col gap-3', !embedded && 'rounded-lg border border-zinc-800 bg-zinc-900/60 p-3')}
    >
      {embedded ? null : <h3 className="text-sm font-semibold">Tactical patterns</h3>}

      <div role="group" aria-label="Apply pattern to" className="grid grid-cols-2 gap-1 rounded-md bg-zinc-950 p-1">
        {(['home', 'away'] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={side === s}
            onClick={() => {
              setSide(s);
              setConfirmApply(false);
            }}
            className={cn(
              'truncate rounded px-2 py-1.5 text-xs font-medium',
              side === s ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-100',
            )}
          >
            {teamDisplayName(getTeam(match, s), s)}
          </button>
        ))}
      </div>

      <SelectField
        label="Pattern"
        value={patternId}
        onChange={(e) => {
          if (isPatternId(e.target.value)) setPatternId(e.target.value);
          setConfirmApply(false);
        }}
      >
        {PATTERNS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </SelectField>
      <p className="text-xs leading-relaxed text-zinc-400">{pattern.description}</p>

      {confirmApply ? (
        <ConfirmBar
          message={`${name} has custom positions. Applying “${pattern.name}” moves players from the formation defaults and replaces them. Save the arrangement first to keep it.`}
          confirmLabel="Apply anyway"
          onConfirm={apply}
          onCancel={() => setConfirmApply(false)}
        />
      ) : (
        <Button variant="primary" size="sm" onClick={() => (modified ? setConfirmApply(true) : apply())}>
          <Sparkles size={14} aria-hidden /> Apply to {name}
        </Button>
      )}
      {error ? (
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">
          The pattern was not applied: {error}
        </p>
      ) : null}
      <p className="text-[11px] text-zinc-400">
        Re-applying replaces this team&apos;s previous pattern arrows. “Reset to formation” restores the shape.
      </p>
    </section>
  );
}
