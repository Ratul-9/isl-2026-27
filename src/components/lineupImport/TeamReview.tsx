'use client';

import { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, CaseSensitive, Plus, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { FORMATIONS, getFormation } from '@/domain/formations';
import { POSITIONS } from '@/domain/positions';
import type { DraftIssue, DraftPlayer, DraftTeam } from '@/domain/lineupImport/types';
import type { FormationId, PositionCode } from '@/domain/types';
import { Button } from '@/components/ui/Button';
import { ConfirmBar } from '@/components/ui/ConfirmBar';
import { SelectField, TextField } from '@/components/ui/fields';
import { cn } from '@/lib/cn';
import { FormationPreview } from './FormationPreview';

export interface TeamActions {
  patchTeam(patch: Partial<Pick<DraftTeam, 'teamName' | 'coach'>>): void;
  setFormation(id: FormationId): void;
  updatePlayer(key: string, patch: Partial<Pick<DraftPlayer, 'name' | 'shirtNumber' | 'position' | 'captain'>>): void;
  assignSlot(key: string, slot: number | null): void;
  toSubstitutes(key: string): void;
  toStarters(key: string): void;
  add(role: 'starter' | 'substitute'): void;
  remove(key: string): void;
  tidyNames(): void;
  reread?(): void;
}

interface Props {
  side: 'home' | 'away';
  label: string;
  team: DraftTeam;
  issues: DraftIssue[];
  sourceName: string | null;
  sourceUrl: string | null;
  actions: TeamActions;
}

const CELL =
  'h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100 focus-visible:border-emerald-500';

function formationNote(team: DraftTeam): { text: string; tone: 'ok' | 'warn' } {
  const s = team.formationStatus;
  if (s.kind === 'detected') return { text: `Read from the image: ${team.formation}.`, tone: 'ok' };
  if (s.kind === 'chosen') return { text: `Set by you: ${team.formation}.`, tone: 'ok' };
  if (s.kind === 'unsupported')
    return { text: `The image shows “${s.raw}”, which DizPitch has no preset for. ${team.formation} is a placeholder — pick the closest formation.`, tone: 'warn' };
  return { text: `No formation text was found. ${team.formation} is a placeholder — please confirm.`, tone: 'warn' };
}

/** Editable review of one extracted team. */
export function TeamReview({ side, label, team, issues, sourceName, sourceUrl, actions }: Props) {
  const template = getFormation(team.formation).slots;
  const [confirmReread, setConfirmReread] = useState(false);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const issuesFor = (key: string) => issues.filter((i) => i.playerKey === key);
  const starters = [...team.starters].sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
  const note = formationNote(team);
  const slotLabel = (i: number) => `${i + 1}: ${template[i].position}`;

  return (
    <section aria-label={`${label} review`} className="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <span aria-hidden className={cn('h-3 w-3 rounded-full', side === 'home' ? 'bg-blue-700' : 'border border-zinc-500 bg-zinc-100')} />
          {label}
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
          {sourceName ? <span>from {sourceName}</span> : <span>entered manually</span>}
          {actions.reread ? (
            <Button size="sm" variant="ghost" onClick={() => setConfirmReread(true)}>
              <RefreshCw size={14} aria-hidden /> Read image again
            </Button>
          ) : null}
        </div>
      </header>

      {confirmReread && actions.reread ? (
        <ConfirmBar
          message={`Read the ${label.toLowerCase()} image again? This replaces everything shown here, including your edits.`}
          confirmLabel="Read again"
          onConfirm={() => {
            setConfirmReread(false);
            actions.reread?.();
          }}
          onCancel={() => setConfirmReread(false)}
        />
      ) : null}

      {sourceUrl ? (
        <details className="rounded-md border border-zinc-800 p-2 text-xs text-zinc-300">
          <summary className="cursor-pointer">Show source image to compare</summary>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sourceUrl} alt={`Source image for the ${label.toLowerCase()} lineup`} className="mt-2 max-h-80 w-full rounded object-contain" />
        </details>
      ) : null}

      {team.warnings.length > 0 ? (
        <ul className="list-inside list-disc rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-100" aria-label="Reader notes">
          {team.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Team name"
          value={team.teamName}
          onChange={(e) => actions.patchTeam({ teamName: e.target.value })}
          error={team.teamName.trim() === '' ? 'Not found in the image. Enter it, or leave blank to fill in later.' : null}
          hint={team.teamNameSource === 'crest' && team.teamName ? 'Read from the badge only — check the full name.' : undefined}
        />
        <TextField
          label="Head coach"
          value={team.coach}
          onChange={(e) => actions.patchTeam({ coach: e.target.value })}
          error={team.coach.trim() === '' ? 'Not found in the image.' : null}
        />
        <div className="sm:col-span-2">
          <SelectField label="Formation" value={team.formation} onChange={(e) => actions.setFormation(e.target.value as FormationId)}>
            {FORMATIONS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </SelectField>
          <p className={cn('mt-1.5 text-xs', note.tone === 'ok' ? 'text-emerald-300' : 'text-amber-300')} role={note.tone === 'warn' ? 'status' : undefined}>
            {note.text}
          </p>
        </div>
      </div>

      <FormationPreview team={team} side={side} />

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            Starting XI <span className="font-normal text-zinc-400">({team.starters.length} of 11)</span>
          </h3>
          <Button size="sm" variant="ghost" onClick={actions.tidyNames} title="Convert ALL-CAPS names to normal capitalisation">
            <CaseSensitive size={14} aria-hidden /> Tidy capitalisation
          </Button>
        </div>
        {starters.length === 0 ? <p className="text-sm text-zinc-400">No starters yet.</p> : null}
        <ul className="flex flex-col gap-2">
          {starters.map((p, index) => (
            <PlayerRow
              key={p.key}
              ariaLabel={`Starter ${index + 1}${p.name ? `, ${p.name}` : ''}`}
              player={p}
              issues={issuesFor(p.key)}
              slotControl={
                <select
                  aria-label={`Pitch position of ${p.name || `starter ${index + 1}`}`}
                  className={CELL}
                  value={p.slot ?? ''}
                  onChange={(e) => actions.assignSlot(p.key, e.target.value === '' ? null : Number(e.target.value))}
                >
                  <option value="">Not placed</option>
                  {template.map((_, i) => (
                    <option key={i} value={i}>
                      {slotLabel(i)}
                    </option>
                  ))}
                </select>
              }
              actions={actions}
              toggle={{ label: 'To subs', icon: <ArrowDownToLine size={14} aria-hidden />, onClick: () => actions.toSubstitutes(p.key) }}
            />
          ))}
        </ul>
        <Button size="sm" className="mt-2" onClick={() => actions.add('starter')} disabled={team.starters.length >= 11}>
          <Plus size={14} aria-hidden /> Add starter
        </Button>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">
          Substitutes <span className="font-normal text-zinc-400">({team.substitutes.length})</span>
        </h3>
        {team.substitutes.length === 0 ? <p className="text-sm text-zinc-400">No substitutes.</p> : null}
        <ul className="flex flex-col gap-2">
          {team.substitutes.map((p, index) => (
            <PlayerRow
              key={p.key}
              ariaLabel={`Substitute ${index + 1}${p.name ? `, ${p.name}` : ''}`}
              player={p}
              issues={issuesFor(p.key)}
              actions={actions}
              toggle={{ label: 'To XI', icon: <ArrowUpFromLine size={14} aria-hidden />, onClick: () => actions.toStarters(p.key), disabled: team.starters.length >= 11 }}
            />
          ))}
        </ul>
        <Button size="sm" className="mt-2" onClick={() => actions.add('substitute')}>
          <Plus size={14} aria-hidden /> Add substitute
        </Button>
      </div>

      {errors.length + warnings.length > 0 ? (
        <div aria-label={`${label} issues`} className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs">
          {errors.length > 0 ? (
            <ul className="mb-2 flex flex-col gap-1 text-red-200">
              {errors.map((i, n) => (
                <li key={`${i.code}-${n}`} className="flex gap-1.5">
                  <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
                  <span>
                    <span className="sr-only">Must fix: </span>
                    {i.message}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {warnings.length > 0 ? (
            <ul className="flex flex-col gap-1 text-amber-200">
              {warnings.map((i, n) => (
                <li key={`${i.code}-${n}`} className="flex gap-1.5">
                  <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
                  <span>
                    <span className="sr-only">Check: </span>
                    {i.message}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-emerald-300">No problems found in this team.</p>
      )}
    </section>
  );
}

function PlayerRow({
  ariaLabel,
  player,
  issues,
  slotControl,
  actions,
  toggle,
}: {
  ariaLabel: string;
  player: DraftPlayer;
  issues: DraftIssue[];
  slotControl?: React.ReactNode;
  actions: TeamActions;
  toggle: { label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean };
}) {
  const hasError = issues.some((i) => i.severity === 'error');
  const flagged = player.uncertain || hasError;
  const label = player.name || 'player';
  return (
    <li
      aria-label={ariaLabel}
      className={cn(
        'rounded-md border p-2',
        hasError ? 'border-red-500/60 bg-red-500/5' : flagged ? 'border-amber-500/50 bg-amber-500/5' : 'border-zinc-800',
      )}
    >
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 sm:grid-cols-[4.5rem_minmax(0,1fr)_9rem_8rem]">
        <input
          aria-label={`Shirt number of ${label}`}
          inputMode="numeric"
          className={cn(CELL, 'text-center tabular-nums')}
          value={player.shirtNumber ?? ''}
          placeholder="#"
          onChange={(e) => {
            const text = e.target.value.trim();
            actions.updatePlayer(player.key, { shirtNumber: text === '' ? null : Number(text) });
          }}
        />
        <input
          aria-label={`Name of ${label}`}
          className={CELL}
          value={player.name}
          placeholder="Player name"
          onChange={(e) => actions.updatePlayer(player.key, { name: e.target.value })}
        />
        {slotControl ?? <span className="hidden sm:block" />}
        <select
          aria-label={`Playing position of ${label}`}
          className={cn(CELL, 'col-span-2 sm:col-span-1')}
          value={player.position ?? ''}
          onChange={(e) => actions.updatePlayer(player.key, { position: e.target.value === '' ? null : (e.target.value as PositionCode) })}
        >
          <option value="">{player.unmappedPosition ? `“${player.unmappedPosition}” (not mapped)` : 'Position: auto'}</option>
          {POSITIONS.map((pos) => (
            <option key={pos.code} value={pos.code}>
              {pos.code} — {pos.name}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {slotControl ? <span className="sr-only sm:hidden" /> : null}
        <label className="flex items-center gap-1.5 text-xs text-zinc-300">
          <input type="checkbox" className="h-4 w-4 accent-emerald-500" checked={player.captain} onChange={(e) => actions.updatePlayer(player.key, { captain: e.target.checked })} />
          Captain
        </label>
        <Button size="sm" variant="ghost" onClick={toggle.onClick} disabled={toggle.disabled} aria-label={`${toggle.label}: ${label}`}>
          {toggle.icon} {toggle.label}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => actions.remove(player.key)} aria-label={`Remove ${label}`}>
          <Trash2 size={14} aria-hidden /> Remove
        </Button>
        {player.uncertain ? <span className="text-xs text-amber-300">Low confidence{player.note ? `: ${player.note}` : ''}</span> : player.note ? <span className="text-xs text-zinc-400">{player.note}</span> : null}
      </div>
      {issues.length > 0 ? (
        <ul className="mt-1 text-xs">
          {issues.map((i, n) => (
            <li key={`${i.code}-${n}`} className={i.severity === 'error' ? 'text-red-300' : 'text-amber-300'}>
              {i.message.replace(/^[^:]+: /, '')}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
