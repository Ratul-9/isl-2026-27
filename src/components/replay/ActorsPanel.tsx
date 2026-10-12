'use client';

import { Crosshair, Plus, Trash2 } from 'lucide-react';
import { addActor, removeActor, updateActor } from '@/domain/replay/edit';
import { MAX_ACTORS } from '@/domain/replay/limits';
import type { Id, Match, ReplayActor, TacticalReplay, TeamSide } from '@/domain/types';
import { createId } from '@/domain/ids';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

const CELL = 'h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100 focus-visible:border-emerald-500';

/** Who is in the replay: team, number, name, and an optional link to a squad player. Unidentified is fine. */
export function ActorsPanel({
  replay,
  match,
  selectedId,
  onSelect,
  onChange,
}: {
  replay: TacticalReplay;
  match: Match;
  selectedId: Id | null;
  onSelect: (id: Id | null) => void;
  onChange: (next: TacticalReplay) => void;
}) {
  const hasBall = replay.actors.some((a) => a.kind === 'ball');
  const playerCount = replay.actors.filter((a) => a.kind === 'player').length;

  function addPlayer() {
    const side: TeamSide | null = replay.attackingSide;
    const next: ReplayActor = {
      id: createId('act'),
      kind: 'player',
      side,
      label: `Player ${playerCount + 1}`,
      shirtNumber: null,
      name: '',
      playerId: null,
      confidence: null,
      evidence: '',
    };
    onChange(addActor(replay, next));
    onSelect(next.id);
  }

  function link(actor: ReplayActor, playerId: string) {
    if (playerId === '') return onChange(updateActor(replay, actor.id, { playerId: null }));
    const squad = actor.side ? match[actor.side].players : [];
    const p = squad.find((x) => x.id === playerId);
    if (p) onChange(updateActor(replay, actor.id, { playerId: p.id, name: p.name, shirtNumber: p.shirtNumber }));
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-zinc-400">
        Drag a player or the ball on the pitch to place it at the current time. Names and numbers are only kept when the clip showed them; leave a player unidentified if unsure.
      </p>
      <ul className="flex flex-col gap-2">
        {replay.actors.map((actor) => {
          const squad = actor.side ? match[actor.side].players : [];
          const selected = actor.id === selectedId;
          return (
            <li
              key={actor.id}
              aria-label={actor.kind === 'ball' ? 'Ball' : actor.name || actor.label}
              className={cn('rounded-md border p-2', selected ? 'border-emerald-500/70 bg-emerald-500/5' : 'border-zinc-800')}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{actor.kind === 'ball' ? 'Ball' : actor.name || actor.label}</span>
                {actor.confidence !== null && actor.kind === 'player' ? (
                  <span className="text-xs text-zinc-400" title="How sure the AI was of this player's identity">
                    id {Math.round(actor.confidence * 100)}%
                  </span>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => onSelect(actor.id)} aria-label={`Select ${actor.kind === 'ball' ? 'ball' : actor.name || actor.label} on the pitch`}>
                  <Crosshair size={14} aria-hidden />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onChange(removeActor(replay, actor.id))} aria-label={`Remove ${actor.kind === 'ball' ? 'ball' : actor.name || actor.label}`}>
                  <Trash2 size={14} aria-hidden />
                </Button>
              </div>
              {actor.kind === 'player' ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="text-xs text-zinc-300">
                    Team
                    <select
                      className={CELL}
                      value={actor.side ?? ''}
                      onChange={(e) =>
                        onChange(updateActor(replay, actor.id, { side: e.target.value === '' ? null : (e.target.value as TeamSide), playerId: null }))
                      }
                    >
                      <option value="home">{match.home.name || 'Home team'}</option>
                      <option value="away">{match.away.name || 'Away team'}</option>
                      <option value="">Unknown</option>
                    </select>
                  </label>
                  <label className="text-xs text-zinc-300">
                    Squad player
                    <select className={CELL} value={actor.playerId ?? ''} onChange={(e) => link(actor, e.target.value)} disabled={squad.length === 0}>
                      <option value="">Unidentified</option>
                      {squad.map((p) => (
                        <option key={p.id} value={p.id}>
                          #{p.shirtNumber} {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-zinc-300">
                    Name
                    <input className={CELL} value={actor.name} maxLength={80} placeholder="Unidentified" onChange={(e) => onChange(updateActor(replay, actor.id, { name: e.target.value }))} />
                  </label>
                  <label className="text-xs text-zinc-300">
                    Shirt number
                    <input
                      className={CELL}
                      inputMode="numeric"
                      value={actor.shirtNumber ?? ''}
                      placeholder="—"
                      onChange={(e) => {
                        const t = e.target.value.trim();
                        onChange(updateActor(replay, actor.id, { shirtNumber: t === '' || !/^\d{1,3}$/.test(t) ? null : Number(t) }));
                      }}
                    />
                  </label>
                </div>
              ) : null}
              {actor.evidence ? <p className="mt-1 text-xs text-zinc-400">Evidence: {actor.evidence}</p> : null}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={addPlayer} disabled={replay.actors.length >= MAX_ACTORS}>
          <Plus size={14} aria-hidden /> Add player
        </Button>
        {!hasBall ? (
          <Button
            size="sm"
            onClick={() => {
              const ball: ReplayActor = { id: createId('act'), kind: 'ball', side: null, label: 'Ball', shirtNumber: null, name: '', playerId: null, confidence: null, evidence: '' };
              onChange(addActor(replay, ball));
              onSelect(ball.id);
            }}
          >
            <Plus size={14} aria-hidden /> Add ball
          </Button>
        ) : null}
      </div>
    </div>
  );
}
