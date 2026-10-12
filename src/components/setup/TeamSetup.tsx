'use client';

import { getTeam, teamDisplayName } from '@/domain/match';
import type { Team, TeamSide } from '@/domain/types';
import { useMatch, useMatchActions } from '@/store/MatchContext';
import { TextField } from '@/components/ui/fields';
import { Section } from '@/components/ui/Section';
import { TeamLogo } from '@/components/ui/Avatars';
import { formatDay } from '@/lib/formatDay';
import { RosterEditor } from './RosterEditor';

export function TeamSetup({ side }: { side: TeamSide }) {
  const match = useMatch();
  const { updateTeam } = useMatchActions();
  const team = getTeam(match, side);
  const other = getTeam(match, side === 'home' ? 'away' : 'home');
  const sameName =
    team.name.trim() !== '' && team.name.trim().toLowerCase() === other.name.trim().toLowerCase();
  const heading = side === 'home' ? 'Home team' : 'Away team';

  return (
    <div className="flex flex-col gap-6" aria-label={`${heading} setup`}>
      <Section title={heading} description={`Setting up ${teamDisplayName(team, side)}.`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Team name"
            value={team.name}
            error={sameName ? 'Both teams have the same name.' : null}
            onChange={(e) => updateTeam(side, { name: e.target.value })}
            maxLength={60}
            autoComplete="off"
          />
          <TextField
            label="Coach or manager"
            value={team.coach}
            onChange={(e) => updateTeam(side, { coach: e.target.value })}
            maxLength={80}
            autoComplete="off"
          />
        </div>
      </Section>
      {team.preset ? <PresetNote team={team} /> : null}
      <RosterEditor side={side} team={team} />
    </div>
  );
}

/** Where a preset-based team came from, and that editing it here leaves the shared preset alone. */
function PresetNote({ team }: { team: Team }) {
  const preset = team.preset;
  if (!preset) return null;
  const nameEdited = team.name.trim() !== preset.officialName && team.name.trim() !== '';
  const coachEdited = (preset.coach?.name ?? '') !== team.coach.trim();
  const profileUrl = preset.profileUrl && /^https:\/\//.test(preset.profileUrl) ? preset.profileUrl : null;
  return (
    <aside
      aria-label="Team preset"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-xs text-zinc-300"
    >
      <TeamLogo url={preset.logoUrl} name={preset.officialName} abbreviation={preset.abbreviation} />
      <div className="min-w-0 flex-1 basis-60">
        <p className="font-medium text-zinc-100">
          {preset.officialName} · {preset.league.toUpperCase()} {preset.season} preset
        </p>
        <p className="text-zinc-400">
          Copied into this match on {formatDay(preset.snapshotAt)}. Changes here stay in this match; the shared preset
          and your other matches are not affected.
          {nameEdited ? ' Team name edited.' : ''}
          {coachEdited ? ' Coach edited.' : ''}
        </p>
      </div>
      {profileUrl ? (
        <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-300 underline">
          Official club page
        </a>
      ) : null}
    </aside>
  );
}
