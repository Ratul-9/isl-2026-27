'use client';

import { cn } from '@/lib/cn';
import { useMatchActions } from '@/store/MatchContext';
import { usePlayerKits } from '@/components/pitch/usePlayerKits';

/**
 * Circles | Jerseys. Rendered only when jerseys can be used (a team created from an ISL preset with a kit theme);
 * custom-team matches never see it. Switching only changes how players are drawn, never positions or match state.
 */
export function PlayerDisplayControl() {
  const { jerseys, available } = usePlayerKits();
  const actions = useMatchActions();
  if (!available) return null;
  return (
    <div role="group" aria-label="Player display" className="flex gap-1 rounded-md bg-zinc-900 p-1">
      {(['circles', 'jerseys'] as const).map((mode) => {
        const active = (mode === 'jerseys') === jerseys;
        return (
          <button
            key={mode}
            type="button"
            aria-pressed={active}
            onClick={() => actions.setPlayerDisplay(mode)}
            className={cn('rounded px-3 py-1.5 text-xs font-medium capitalize', active ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-100')}
          >
            {mode}
          </button>
        );
      })}
    </div>
  );
}
