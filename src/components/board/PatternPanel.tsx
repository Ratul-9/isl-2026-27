'use client';

import { useState } from 'react';
import { Eraser, Sparkles } from 'lucide-react';
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

/** Tactical pattern library: apply a phase-of-play shape + arrows to one team. */
export function PatternPanel() {
  const match = useMatch();
  const actions = useMatchActions();
  const [side, setSide] = useState<TeamSide>('home');
  const [patternId, setPatternId] = useState<PatternId>('high-press');
  const [confirmApply, setConfirmApply] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const team = getTeam(match, side);
  const name = teamDisplayName(team, side);
  const pattern = getPattern(patternId);
  const modified = isLayoutModified(team, side, match.savedLayouts);
  const arrowCount = match.drawings.length;

  function apply() {
    actions.applyPattern(side, patternId);
    setConfirmApply(false);
  }

  return (
    <section aria-label="Tactical patterns" className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <h3 className="text-sm font-semibold">Tactical patterns</h3>

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
      <p className="text-[11px] text-zinc-500">
        Re-applying replaces this team&apos;s previous pattern arrows. “Reset to formation” restores the shape.
      </p>

      <div className="border-t border-zinc-800 pt-3">
        {confirmClear ? (
          <ConfirmBar
            message={`Remove all ${arrowCount} arrow${arrowCount === 1 ? '' : 's'} from the board? Players stay where they are.`}
            confirmLabel="Clear arrows"
            onConfirm={() => {
              actions.clearDrawings();
              setConfirmClear(false);
            }}
            onCancel={() => setConfirmClear(false)}
          />
        ) : (
          <Button
            size="sm"
            className="w-full"
            disabled={arrowCount === 0}
            onClick={() => setConfirmClear(true)}
            title={arrowCount === 0 ? 'There are no arrows on the board' : 'Remove every arrow, keep the lineup'}
          >
            <Eraser size={14} aria-hidden /> Clear arrows{arrowCount > 0 ? ` (${arrowCount})` : ''}
          </Button>
        )}
      </div>
    </section>
  );
}
