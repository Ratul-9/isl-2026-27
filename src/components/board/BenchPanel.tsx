'use client';

import { ArrowRightLeft } from 'lucide-react';
import { teamDisplayName } from '@/domain/match';
import type { Id, Player, TeamSide } from '@/domain/types';
import { useMatch, useMatchAnalysis } from '@/store/MatchContext';
import { Button } from '@/components/ui/Button';
import { playerLabel } from '@/components/match/eventFormModel';

/** Current bench state per team, derived from substitution and card events. */
export function BenchPanel({ onRecordSubstitution }: { onRecordSubstitution: () => void }) {
  return (
    <section aria-label="Bench" className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Bench</h3>
        <Button size="sm" onClick={onRecordSubstitution}>
          <ArrowRightLeft size={14} aria-hidden /> Record substitution
        </Button>
      </div>
      {(['home', 'away'] as const).map((side) => (
        <TeamBench key={side} side={side} />
      ))}
    </section>
  );
}

function names(ids: readonly Id[], players: readonly Player[]): string {
  const byId = new Map(players.map((p) => [p.id, p]));
  return ids.flatMap((id) => (byId.has(id) ? [playerLabel(byId.get(id)!)] : [])).join(', ');
}

function TeamBench({ side }: { side: TeamSide }) {
  const match = useMatch();
  const { lineups } = useMatchAnalysis();
  const team = match[side];
  const lineup = lineups[side];
  const rows: { label: string; ids: readonly Id[] }[] = [
    { label: 'Available', ids: lineup.bench },
    { label: 'Substituted on', ids: lineup.substitutedOn },
    { label: 'Substituted off', ids: lineup.substitutedOff },
    { label: 'Sent off', ids: lineup.sentOff },
  ];
  return (
    <div aria-label={`${teamDisplayName(team, side)} bench`} role="group">
      <p className="text-xs font-semibold text-zinc-300">
        {teamDisplayName(team, side)} <span className="font-normal text-zinc-400">· {lineup.substitutionsMade} substitution{lineup.substitutionsMade === 1 ? '' : 's'}</span>
      </p>
      <dl className="mt-1 grid grid-cols-[6.5rem_1fr] gap-x-2 gap-y-0.5 text-xs">
        {rows.map((r) =>
          r.ids.length === 0 && r.label !== 'Available' ? null : (
            <div key={r.label} className="contents">
              <dt className="text-zinc-400">{r.label}</dt>
              <dd className="text-zinc-200">{r.ids.length > 0 ? names(r.ids, team.players) : 'None'}</dd>
            </div>
          ),
        )}
      </dl>
    </div>
  );
}
