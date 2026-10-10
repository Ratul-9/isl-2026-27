'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Pencil, Trash2 } from 'lucide-react';
import { positionName } from '@/domain/positions';
import {
  draftFromPlayer,
  emptyPlayerDraft,
  getSquadCounts,
  getStarters,
  getSubstitutes,
  MAX_PLAYERS,
  MAX_STARTERS,
  MAX_SUBSTITUTES,
} from '@/domain/squad';
import type { Player, PositionCode, Team, TeamSide } from '@/domain/types';
import { useMatchActions } from '@/store/MatchContext';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/fields';
import { Section } from '@/components/ui/Section';
import { PlayerForm, PositionOptions } from './PlayerForm';

export function RosterEditor({ side, team }: { side: TeamSide; team: Team }) {
  const actions = useMatchActions();
  const counts = getSquadCounts(team);
  const starters = getStarters(team);
  const substitutes = getSubstitutes(team);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Bumped after each add so the form remounts with a fresh default role.
  const [addKey, setAddKey] = useState(0);
  const squadFull = counts.total >= MAX_PLAYERS;

  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Add player"
        description={`Register up to ${MAX_PLAYERS} players: ${MAX_STARTERS} starters and ${MAX_SUBSTITUTES} substitutes.`}
      >
        {squadFull ? (
          <p className="text-sm text-zinc-400">
            The squad is full ({MAX_PLAYERS} players). Remove a player to add another.
          </p>
        ) : (
          <PlayerForm
            key={`add-${side}-${addKey}-${counts.starters >= MAX_STARTERS}`}
            initial={emptyPlayerDraft(team)}
            submitLabel="Add player"
            autoFocusName={addKey > 0}
            onSubmit={(draft) => actions.addPlayer(side, draft)}
            onAccepted={() => setAddKey((k) => k + 1)}
          />
        )}
      </Section>

      <Section
        title="Starting XI"
        description={`${counts.starters} of ${MAX_STARTERS} selected`}
      >
        {starters.length === 0 ? (
          <EmptyState>No starters yet. Add players above, or move substitutes into the XI.</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-800">
            {starters.map(({ player, slot }) => (
              <li key={player.id} className="py-2.5">
                {editingId === player.id ? (
                  <EditPlayer side={side} team={team} player={player} onDone={() => setEditingId(null)} />
                ) : (
                  <PlayerRow
                    side={side}
                    player={player}
                    role="starter"
                    lineupSlot={{ id: slot.id, position: slot.position }}
                    onEdit={() => setEditingId(player.id)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Substitutes"
        description={`${counts.substitutes} of ${MAX_SUBSTITUTES} selected`}
      >
        {substitutes.length === 0 ? (
          <EmptyState>No substitutes yet.</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-800">
            {substitutes.map((player) => (
              <li key={player.id} className="py-2.5">
                {editingId === player.id ? (
                  <EditPlayer side={side} team={team} player={player} onDone={() => setEditingId(null)} />
                ) : (
                  <PlayerRow side={side} player={player} role="substitute" onEdit={() => setEditingId(player.id)} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-sm text-zinc-500">{children}</p>;
}

function EditPlayer({
  side,
  team,
  player,
  onDone,
}: {
  side: TeamSide;
  team: Team;
  player: Player;
  onDone: () => void;
}) {
  const actions = useMatchActions();
  return (
    <PlayerForm
      initial={draftFromPlayer(team, player)}
      submitLabel="Save player"
      autoFocusName
      onSubmit={(draft) => actions.updatePlayer(side, player.id, draft)}
      onAccepted={onDone}
      onCancel={onDone}
    />
  );
}

function PlayerRow({
  side,
  player,
  role,
  lineupSlot,
  onEdit,
}: {
  side: TeamSide;
  player: Player;
  role: 'starter' | 'substitute';
  lineupSlot?: { id: string; position: PositionCode };
  onEdit: () => void;
}) {
  const actions = useMatchActions();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);

  function move() {
    const target = role === 'starter' ? 'substitute' : 'starter';
    const errors = actions.setRole(side, player.id, target);
    setRoleError(errors.role ?? errors.form ?? null);
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-sm font-semibold tabular-nums"
        aria-label={`Shirt number ${player.shirtNumber}`}
      >
        {player.shirtNumber}
      </span>

      <div className="min-w-0 flex-1 basis-40">
        <p className="truncate text-sm font-medium text-zinc-100">{player.name}</p>
        <p className="truncate text-xs text-zinc-400" title={positionName(player.preferredPosition)}>
          Prefers {player.preferredPosition}
          {player.notes ? ` · ${player.notes}` : ''}
        </p>
      </div>

      {role === 'starter' && lineupSlot ? (
        <div className="w-44">
          <SelectField
            label="Plays as"
            value={lineupSlot.position}
            onChange={(e) => actions.setSlotPosition(side, lineupSlot.id, e.target.value as PositionCode)}
            className="h-9"
          >
            <PositionOptions />
          </SelectField>
        </div>
      ) : null}

      <div className="flex items-center gap-1.5">
        {confirmingRemove ? (
          <>
            <span className="text-xs text-zinc-300">Remove {player.name}?</span>
            <Button size="sm" variant="danger" onClick={() => actions.removePlayer(side, player.id)}>
              Remove
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmingRemove(false)}>
              Keep
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={move} title={role === 'starter' ? 'Move to substitutes' : 'Move to starting XI'}>
              {role === 'starter' ? (
                <>
                  <ArrowDownToLine size={14} aria-hidden /> To bench
                </>
              ) : (
                <>
                  <ArrowUpFromLine size={14} aria-hidden /> To XI
                </>
              )}
            </Button>
            <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${player.name}`} title="Edit player">
              <Pencil size={14} aria-hidden />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmingRemove(true)}
              aria-label={`Remove ${player.name}`}
              title="Remove player"
            >
              <Trash2 size={14} aria-hidden />
            </Button>
          </>
        )}
      </div>

      {roleError ? (
        <p role="alert" className="basis-full text-xs text-red-400">
          {roleError}
        </p>
      ) : null}
    </div>
  );
}
