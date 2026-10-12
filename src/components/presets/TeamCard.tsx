'use client';

import { Home, Plane } from 'lucide-react';
import type { TeamPreset } from '@/domain/presets/types';
import type { TeamSide } from '@/domain/types';
import { Button } from '@/components/ui/Button';
import { TeamLogo } from '@/components/ui/Avatars';
import { cn } from '@/lib/cn';

/** One selectable preset team. A team chosen for one side cannot be chosen for the other. */
export function TeamCard({
  team,
  season,
  chosenAs,
  onChoose,
}: {
  team: TeamPreset;
  season: string;
  /** Which side this team is currently chosen for, if any. */
  chosenAs: TeamSide | null;
  onChoose: (side: TeamSide) => void;
}) {
  const details: [string, string][] = [
    ['Home city', team.city ?? 'Not available'],
    ['Head coach', team.coach?.name ?? 'Not available'],
    ['Squad', `${team.players.length} player${team.players.length === 1 ? '' : 's'}`],
    ['Season', season],
  ];

  return (
    <article
      aria-label={team.displayName}
      className={cn(
        'flex h-full flex-col gap-3 rounded-lg border bg-zinc-900/60 p-4',
        chosenAs ? 'border-emerald-600' : 'border-zinc-800',
      )}
    >
      <header className="flex items-center gap-3">
        <TeamLogo url={team.logoUrl} name={team.displayName} abbreviation={team.abbreviation} size="lg" />
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-zinc-100">{team.officialName}</h3>
          {team.abbreviation ? <p className="text-xs text-zinc-400">{team.abbreviation}</p> : null}
        </div>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {details.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-zinc-400">{label}</dt>
            <dd className="truncate text-zinc-200">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-auto flex gap-2">
        {(['home', 'away'] as const).map((side) => {
          const selected = chosenAs === side;
          const blocked = chosenAs !== null && chosenAs !== side;
          const Icon = side === 'home' ? Home : Plane;
          const label = side === 'home' ? 'Home' : 'Away';
          return (
            <Button
              key={side}
              size="sm"
              variant={selected ? 'primary' : 'secondary'}
              className="flex-1"
              aria-pressed={selected}
              aria-label={`${selected ? 'Remove' : 'Choose'} ${team.displayName} as the ${side} team`}
              title={blocked ? `${team.displayName} is already the ${chosenAs} team` : undefined}
              disabled={blocked}
              onClick={() => onChoose(side)}
            >
              <Icon size={14} aria-hidden /> {label}
            </Button>
          );
        })}
      </div>
    </article>
  );
}
