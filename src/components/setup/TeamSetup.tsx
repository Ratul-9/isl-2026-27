'use client';

import { getTeam, teamDisplayName } from '@/domain/match';
import type { TeamSide } from '@/domain/types';
import { useMatch, useMatchActions } from '@/store/MatchContext';
import { TextField } from '@/components/ui/fields';
import { Section } from '@/components/ui/Section';
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
      <RosterEditor side={side} team={team} />
    </div>
  );
}
