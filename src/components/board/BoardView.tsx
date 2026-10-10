'use client';

import { useState } from 'react';
import { Users } from 'lucide-react';
import type { Orientation } from '@/domain/geometry';
import { useMatch } from '@/store/MatchContext';
import { TacticalBoard } from '@/components/pitch/TacticalBoard';
import type { SlotRef } from '@/components/pitch/TacticalBoard';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { FormationPanel, SavedLayoutsPanel } from './FormationPanel';
import { PatternPanel } from './PatternPanel';
import { SelectionPanel } from './SelectionPanel';

/** The tactical board workspace: pitch in the centre, controls alongside. */
export function BoardView({ onOpenSetup }: { onOpenSetup: () => void }) {
  const match = useMatch();
  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [snap, setSnap] = useState(false);
  const [selected, setSelected] = useState<SlotRef | null>(null);
  const noPlayers = match.home.players.length === 0 && match.away.players.length === 0;

  return (
    <div className="mx-auto grid w-full max-w-[110rem] flex-1 gap-4 px-4 py-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Pitch orientation" className="flex gap-1 rounded-md bg-zinc-900 p-1">
            {(['landscape', 'portrait'] as const).map((o) => (
              <button
                key={o}
                type="button"
                aria-pressed={orientation === o}
                onClick={() => setOrientation(o)}
                className={cn(
                  'rounded px-3 py-1.5 text-xs font-medium capitalize',
                  orientation === o ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-100',
                )}
              >
                {o}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={snap}
              onChange={(e) => setSnap(e.target.checked)}
              className="h-4 w-4 accent-emerald-500"
            />
            Snap to grid
          </label>
          {noPlayers ? (
            <div className="ml-auto flex items-center gap-2 text-xs text-zinc-400">
              <span>No players yet — empty positions are shown.</span>
              <Button size="sm" onClick={onOpenSetup}>
                <Users size={14} aria-hidden /> Add squads
              </Button>
            </div>
          ) : null}
        </div>
        <div className="flex min-h-0 justify-center rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
          <TacticalBoard orientation={orientation} snap={snap} selected={selected} onSelect={setSelected} />
        </div>
      </div>

      <aside aria-label="Board controls" className="flex flex-col gap-3">
        <SelectionPanel selected={selected} onClear={() => setSelected(null)} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <FormationPanel side="home" />
          <FormationPanel side="away" />
        </div>
        <SavedLayoutsPanel />
        <PatternPanel />
      </aside>
    </div>
  );
}
