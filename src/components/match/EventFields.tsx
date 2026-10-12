'use client';

import { GOAL_TYPES } from '@/domain/events';
import { teamDisplayName } from '@/domain/match';
import type { GoalType, Match, TeamSide } from '@/domain/types';
import { SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { cn } from '@/lib/cn';
import { otherSide, playerGroups } from './eventFormModel';
import type { EventFormState } from './eventFormModel';
import { PlayerSelect } from './PlayerSelect';

type Lineups = Parameters<typeof playerGroups>[2];
interface FieldsProps {
  match: Match;
  state: EventFormState;
  lineups: { home: Lineups; away: Lineups };
  onChange: (patch: Partial<EventFormState>) => void;
}

/** Team toggle: segmented control for home/away. */
function TeamPicker({
  match,
  value,
  label,
  allowNone,
  onChange,
}: {
  match: Match;
  value: TeamSide | '';
  label: string;
  allowNone?: boolean;
  onChange: (side: TeamSide | '') => void;
}) {
  const sides: (TeamSide | '')[] = allowNone ? ['', 'home', 'away'] : ['home', 'away'];
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-zinc-300">{label}</span>
      <div className={cn('grid gap-1 rounded-md bg-zinc-950 p-1', allowNone ? 'grid-cols-3' : 'grid-cols-2')}>
        {sides.map((side) => (
          <button
            key={side || 'none'}
            type="button"
            role="radio"
            aria-checked={value === side}
            onClick={() => onChange(side)}
            className={cn(
              'truncate rounded px-2 py-2 text-sm font-medium',
              value === side ? 'bg-emerald-700 text-white' : 'text-zinc-300 hover:bg-zinc-800',
            )}
          >
            {side === '' ? 'No team' : teamDisplayName(match[side], side)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function GoalFields({ match, state, lineups, onChange }: FieldsProps) {
  const side = state.side || 'home';
  const own = state.goalType === 'ownGoal';
  // For an own goal the responsible player belongs to the OTHER team.
  const scorerSide = own ? otherSide(side) : side;
  const scorerGroups = playerGroups(match, scorerSide, lineups[scorerSide], 'scorer');
  const assistGroups = playerGroups(match, side, lineups[side], 'scorer')
    .map((g) => ({ ...g, players: g.players.filter((p) => p.id !== state.scorerId) }))
    .filter((g) => g.players.length > 0);

  return (
    <>
      <TeamPicker
        match={match}
        value={side}
        label={own ? 'Team credited with the goal' : 'Scoring team'}
        onChange={(s) => onChange({ side: s || 'home', scorerId: '', assistId: '' })}
      />
      <SelectField
        label="Goal type"
        value={state.goalType}
        onChange={(e) => onChange({ goalType: e.target.value as GoalType, scorerId: '', assistId: '' })}
      >
        {GOAL_TYPES.map((g) => (
          <option key={g.value} value={g.value}>
            {g.label}
          </option>
        ))}
      </SelectField>
      <PlayerSelect
        label={own ? `Own goal scored by (${teamDisplayName(match[scorerSide], scorerSide)} player)` : 'Scorer'}
        value={state.scorerId}
        groups={scorerGroups}
        emptyLabel={own ? 'Choose a player…' : 'Not recorded'}
        hint={own ? `The goal is credited to ${teamDisplayName(match[side], side)}.` : undefined}
        onChange={(id) => onChange({ scorerId: id, assistId: id && id === state.assistId ? '' : state.assistId })}
      />
      {own ? null : (
        <PlayerSelect
          label="Assist (optional)"
          value={state.assistId}
          groups={assistGroups}
          emptyLabel="No assist"
          onChange={(id) => onChange({ assistId: id })}
        />
      )}
      <TextAreaField label="Notes (optional)" value={state.notes} onChange={(e) => onChange({ notes: e.target.value })} className="min-h-16" />
    </>
  );
}

export function SubstitutionFields({ match, state, lineups, onChange }: FieldsProps) {
  const side = state.side || 'home';
  return (
    <>
      <TeamPicker match={match} value={side} label="Team" onChange={(s) => onChange({ side: s || 'home', outId: '', inId: '' })} />
      <PlayerSelect
        label="Player going off"
        value={state.outId}
        groups={playerGroups(match, side, lineups[side], 'outgoing')}
        onChange={(id) => onChange({ outId: id })}
      />
      <PlayerSelect
        label="Player coming on"
        value={state.inId}
        groups={playerGroups(match, side, lineups[side], 'incoming')}
        hint="Only substitutes who have not played, and are not sent off, are listed."
        onChange={(id) => onChange({ inId: id })}
      />
      <TextField label="Reason (optional)" value={state.reason} onChange={(e) => onChange({ reason: e.target.value })} maxLength={100} placeholder="e.g. Injury, tactical" />
    </>
  );
}

export function CardFields({ match, state, lineups, onChange }: FieldsProps) {
  const side = state.side || 'home';
  return (
    <>
      <TeamPicker match={match} value={side} label="Team" onChange={(s) => onChange({ side: s || 'home', playerId: '' })} />
      <div role="radiogroup" aria-label="Card" className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-zinc-300">Card</span>
        <div className="grid grid-cols-2 gap-1 rounded-md bg-zinc-950 p-1">
          {(['yellow', 'red'] as const).map((card) => (
            <button
              key={card}
              type="button"
              role="radio"
              aria-checked={state.card === card}
              onClick={() => onChange({ card })}
              className={cn(
                'flex items-center justify-center gap-2 rounded px-2 py-2 text-sm font-medium',
                state.card === card ? 'bg-zinc-700 text-white' : 'text-zinc-300 hover:bg-zinc-800',
              )}
            >
              <span aria-hidden className={cn('h-4 w-3 rounded-sm', card === 'yellow' ? 'bg-yellow-400' : 'bg-red-500')} />
              {card === 'yellow' ? 'Yellow card' : 'Red card'}
            </button>
          ))}
        </div>
      </div>
      <PlayerSelect
        label="Player"
        value={state.playerId}
        groups={playerGroups(match, side, lineups[side], 'card')}
        hint="A second yellow card sends the player off."
        onChange={(id) => onChange({ playerId: id })}
      />
      <TextAreaField label="Notes (optional)" value={state.notes} onChange={(e) => onChange({ notes: e.target.value })} className="min-h-16" />
    </>
  );
}

export function NoteFields({ match, state, onChange }: Pick<FieldsProps, 'match' | 'state' | 'onChange'>) {
  return (
    <>
      <TextAreaField
        label="Note"
        value={state.text}
        maxLength={500}
        onChange={(e) => onChange({ text: e.target.value })}
        placeholder="e.g. VAR check, injury stoppage, change of shape"
      />
      <TeamPicker match={match} value={state.side} label="Team (optional)" allowNone onChange={(s) => onChange({ side: s })} />
    </>
  );
}
