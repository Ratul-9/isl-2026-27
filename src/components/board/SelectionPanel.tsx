'use client';

import { getTeam, teamDisplayName } from '@/domain/match';
import { positionName } from '@/domain/positions';
import type { PositionCode } from '@/domain/types';
import { useMatch, useMatchActions } from '@/store/MatchContext';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/fields';
import { PositionOptions } from '@/components/setup/PlayerForm';
import type { SlotRef } from '@/components/pitch/TacticalBoard';

/** Details and position override for the selected marker. */
export function SelectionPanel({ selected, onClear }: { selected: SlotRef | null; onClear: () => void }) {
  const match = useMatch();
  const actions = useMatchActions();
  const team = selected ? getTeam(match, selected.side) : null;
  const slot = team?.slots.find((s) => s.id === selected?.slotId);

  if (!selected || !team || !slot) {
    return (
      <section aria-label="Selected player" className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <h3 className="text-sm font-semibold">Selected player</h3>
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          Click a player to select. Drag to move anywhere on the pitch. With a player focused, arrow keys nudge 1 m
          (Shift: 5 m) and Esc deselects.
        </p>
      </section>
    );
  }

  const player = slot.playerId ? team.players.find((p) => p.id === slot.playerId) : undefined;

  return (
    <section aria-label="Selected player" className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">{teamDisplayName(team, selected.side)}</p>
          <h3 className="truncate text-sm font-semibold">
            {player ? `#${player.shirtNumber} ${player.name}` : `Empty ${slot.position} position`}
          </h3>
          {player ? (
            <p className="text-xs text-zinc-400">
              Prefers {positionName(player.preferredPosition)}
              {player.notes ? ` · ${player.notes}` : ''}
            </p>
          ) : (
            <p className="text-xs text-zinc-400">Move a substitute into the XI in Setup to fill it.</p>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={onClear}>
          Deselect
        </Button>
      </div>
      <SelectField
        label="Plays as"
        hint={positionName(slot.position)}
        value={slot.position}
        onChange={(e) => actions.setSlotPosition(selected.side, slot.id, e.target.value as PositionCode)}
      >
        <PositionOptions />
      </SelectField>
    </section>
  );
}
