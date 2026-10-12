'use client';

import { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Pencil } from 'lucide-react';
import { formatDateOfBirth } from '@/domain/presets/snapshot';
import { getPool } from '@/domain/squad';
import { draftFromPlayer } from '@/domain/squad';
import type { Player, Team, TeamSide } from '@/domain/types';
import { useMatchActions } from '@/store/MatchContext';
import { PlayerAvatar } from '@/components/ui/Avatars';
import { Button } from '@/components/ui/Button';
import { Section } from '@/components/ui/Section';
import { PlayerBadges } from './PlayerBadges';
import { PlayerForm } from './PlayerForm';

const GROUPS = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward', 'Other'] as const;
type Group = (typeof GROUPS)[number];
const PLURAL: Record<Group, string> = {
  Goalkeeper: 'Goalkeepers',
  Defender: 'Defenders',
  Midfielder: 'Midfielders',
  Forward: 'Forwards',
  Other: 'Other players',
};

function groupOf(player: Player): Group {
  const source = player.origin?.sourcePosition;
  return (GROUPS as readonly string[]).includes(source ?? '') ? (source as Group) : 'Other';
}

/**
 * The rest of a club's registered squad. Pool players are editable but are not in the XI or on
 * the bench, so they never appear on the board or in event forms until moved in.
 */
export function SquadPool({ side, team }: { side: TeamSide; team: Team }) {
  const pool = getPool(team);
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const needle = query.trim().toLowerCase();
  const visible = pool.filter((p) => needle === '' || p.name.toLowerCase().includes(needle) || String(p.shirtNumber) === needle.replace('#', ''));

  return (
    <Section
      title="Squad pool"
      description={`${pool.length} registered player${pool.length === 1 ? '' : 's'} not in the matchday squad. Move players into the starting XI or onto the bench.`}
    >
      {pool.length === 0 ? (
        <p className="text-sm text-zinc-400">Everyone is in the matchday squad.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <label className="flex max-w-xs flex-col gap-1.5 text-xs font-medium text-zinc-300">
            Filter by name or number
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
              autoComplete="off"
            />
          </label>
          {visible.length === 0 ? <p className="text-sm text-zinc-400">No players match “{query}”.</p> : null}
          {GROUPS.map((group) => {
            const members = visible.filter((p) => groupOf(p) === group);
            if (members.length === 0) return null;
            return (
              <div key={group}>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  {PLURAL[group]} ({members.length})
                </h3>
                <ul className="flex flex-col divide-y divide-zinc-800">
                  {members.map((player) => (
                    <li key={player.id} className="py-2.5">
                      {editingId === player.id ? (
                        <EditPoolPlayer side={side} team={team} player={player} onDone={() => setEditingId(null)} />
                      ) : (
                        <PoolRow side={side} player={player} onEdit={() => setEditingId(player.id)} />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function EditPoolPlayer({ side, team, player, onDone }: { side: TeamSide; team: Team; player: Player; onDone: () => void }) {
  const actions = useMatchActions();
  return (
    <PlayerForm
      initial={draftFromPlayer(team, player)}
      submitLabel="Save player"
      autoFocusName
      hideRole
      onSubmit={(draft) => actions.updatePoolPlayer(side, player.id, draft)}
      onAccepted={onDone}
      onCancel={onDone}
    />
  );
}

function PoolRow({ side, player, onEdit }: { side: TeamSide; player: Player; onEdit: () => void }) {
  const actions = useMatchActions();
  const [rowError, setRowError] = useState<string | null>(null);

  function move(role: 'starter' | 'substitute') {
    const errors = actions.promoteFromPool(side, player.id, role);
    setRowError(errors.role ?? errors.shirtNumber ?? errors.form ?? null);
  }

  const origin = player.origin;
  const dob = formatDateOfBirth(origin?.dateOfBirth ?? null);
  const meta = [origin?.sourcePosition ?? null, origin?.nationality ?? null, dob ? `born ${dob}` : null].filter(Boolean).join(' · ');

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <PlayerAvatar url={origin?.photoUrl} name={player.name} />
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-sm font-semibold tabular-nums"
        aria-label={`Shirt number ${player.shirtNumber}`}
      >
        {player.shirtNumber}
      </span>
      <div className="min-w-0 flex-1 basis-40">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-zinc-100">
          <span className="truncate">{player.name}</span>
          <PlayerBadges player={player} showCustom />
        </p>
        {meta ? <p className="truncate text-xs text-zinc-400">{meta}</p> : null}
      </div>
      <div className="flex items-center gap-1.5">
        <Button size="sm" onClick={() => move('starter')} title="Move to the starting XI" aria-label={`Move ${player.name} to the starting XI`}>
          <ArrowUpFromLine size={14} aria-hidden /> To XI
        </Button>
        <Button size="sm" onClick={() => move('substitute')} title="Move to the substitutes" aria-label={`Move ${player.name} to the substitutes`}>
          <ArrowDownToLine size={14} aria-hidden /> To bench
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${player.name}`} title="Edit player">
          <Pencil size={14} aria-hidden />
        </Button>
      </div>
      {rowError ? (
        <p role="alert" className="basis-full text-xs text-red-400">
          {rowError}
        </p>
      ) : null}
    </div>
  );
}
