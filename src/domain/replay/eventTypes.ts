import type { ReplayEventType } from '../types';

export const REPLAY_EVENT_TYPES: readonly ReplayEventType[] = [
  'kickoff',
  'restart',
  'pass',
  'progression',
  'shot',
  'shotOnTarget',
  'goal',
  'save',
  'corner',
  'freeKick',
  'throwIn',
  'foul',
  'penalty',
  'offside',
  'tackle',
  'interception',
  'yellowCard',
  'redCard',
  'substitution',
  'other',
  'uncertain',
];

export const REPLAY_EVENT_LABELS: Record<ReplayEventType, string> = {
  kickoff: 'Kick-off',
  restart: 'Restart',
  pass: 'Pass',
  progression: 'Ball progression',
  shot: 'Shot',
  shotOnTarget: 'Shot on target',
  goal: 'Goal',
  save: 'Save',
  corner: 'Corner',
  freeKick: 'Free kick',
  throwIn: 'Throw-in',
  foul: 'Foul',
  penalty: 'Penalty',
  offside: 'Offside',
  tackle: 'Tackle',
  interception: 'Interception',
  yellowCard: 'Yellow card',
  redCard: 'Red card',
  substitution: 'Substitution',
  other: 'Other',
  uncertain: 'Uncertain',
};

export function isReplayEventType(value: unknown): value is ReplayEventType {
  return typeof value === 'string' && (REPLAY_EVENT_TYPES as readonly string[]).includes(value);
}
