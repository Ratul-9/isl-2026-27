import type { PositionCode } from './types';

export type PositionGroup = 'Goalkeeper' | 'Defence' | 'Midfield' | 'Attack';

export interface PositionInfo {
  code: PositionCode;
  name: string;
  group: PositionGroup;
}

/**
 * Display order is deliberate (goalkeeper, then defence left→right, then
 * midfield, then attack) and is used to sort players in lineup views.
 */
export const POSITIONS: readonly PositionInfo[] = [
  { code: 'GK', name: 'Goalkeeper', group: 'Goalkeeper' },
  { code: 'LB', name: 'Left Back', group: 'Defence' },
  { code: 'LCB', name: 'Left Centre Back', group: 'Defence' },
  { code: 'CB', name: 'Centre Back', group: 'Defence' },
  { code: 'RCB', name: 'Right Centre Back', group: 'Defence' },
  { code: 'RB', name: 'Right Back', group: 'Defence' },
  { code: 'LWB', name: 'Left Wing-Back', group: 'Defence' },
  { code: 'RWB', name: 'Right Wing-Back', group: 'Defence' },
  { code: 'CDM', name: 'Defensive Midfielder', group: 'Midfield' },
  { code: 'LCM', name: 'Left Central Midfielder', group: 'Midfield' },
  { code: 'CM', name: 'Central Midfielder', group: 'Midfield' },
  { code: 'RCM', name: 'Right Central Midfielder', group: 'Midfield' },
  { code: 'LM', name: 'Left Midfielder', group: 'Midfield' },
  { code: 'RM', name: 'Right Midfielder', group: 'Midfield' },
  { code: 'CAM', name: 'Attacking Midfielder', group: 'Midfield' },
  { code: 'LW', name: 'Left Winger', group: 'Attack' },
  { code: 'RW', name: 'Right Winger', group: 'Attack' },
  { code: 'CF', name: 'Centre Forward', group: 'Attack' },
  { code: 'ST', name: 'Striker', group: 'Attack' },
];

const BY_CODE = new Map(POSITIONS.map((p, index) => [p.code, { ...p, index }]));

export const POSITION_GROUPS: readonly PositionGroup[] = [
  'Goalkeeper',
  'Defence',
  'Midfield',
  'Attack',
];

export function isPositionCode(value: unknown): value is PositionCode {
  return typeof value === 'string' && BY_CODE.has(value as PositionCode);
}

export function positionName(code: PositionCode): string {
  return BY_CODE.get(code)?.name ?? code;
}

/** Sort key: lower sorts first (goalkeeper … striker). */
export function positionOrder(code: PositionCode): number {
  return BY_CODE.get(code)?.index ?? Number.MAX_SAFE_INTEGER;
}
