import type { FormationId, PositionCode, TemplateSlot } from './types';

/**
 * Formation presets in the TEAM frame: x 0 = own goal line → 0.5 = halfway,
 * y 0 = the team's left touchline. Every preset has exactly 11 slots, one GK,
 * and sits in its own half so both teams can share the board at kickoff.
 */

export interface FormationPreset {
  id: FormationId;
  label: string;
  slots: readonly TemplateSlot[];
}

// Line depths (fraction of pitch length).
const GK = 0.04;
const DEF = 0.17;
const DEF3 = 0.16;
const WB = 0.2;
const DM = 0.26;
const MID = 0.31;
const AM = 0.38;
const FWD = 0.45;

const s = (position: PositionCode, x: number, y: number): TemplateSlot => ({ position, x, y });

const keeper = s('GK', GK, 0.5);
const backFour = [s('LB', DEF, 0.14), s('LCB', DEF, 0.37), s('RCB', DEF, 0.63), s('RB', DEF, 0.86)];
const backThree = [s('LCB', DEF3, 0.3), s('CB', DEF3 - 0.01, 0.5), s('RCB', DEF3, 0.7)];
const backFive = [s('LWB', WB, 0.08), ...backThree, s('RWB', WB, 0.92)];
const wingBackMidfield = [s('LWB', MID, 0.1), s('LCM', MID, 0.38), s('RCM', MID, 0.62), s('RWB', MID, 0.9)];
const flatFourMidfield = [s('LM', MID, 0.14), s('LCM', MID - 0.01, 0.38), s('RCM', MID - 0.01, 0.62), s('RM', MID, 0.86)];
const twoStrikers = [s('ST', FWD - 0.01, 0.4), s('ST', FWD - 0.01, 0.6)];

export const FORMATIONS: readonly FormationPreset[] = [
  {
    id: '4-3-3',
    label: '4-3-3',
    slots: [
      keeper,
      ...backFour,
      s('LCM', MID, 0.3),
      s('CDM', DM, 0.5),
      s('RCM', MID, 0.7),
      s('LW', FWD - 0.02, 0.15),
      s('ST', FWD, 0.5),
      s('RW', FWD - 0.02, 0.85),
    ],
  },
  {
    id: '4-2-3-1',
    label: '4-2-3-1',
    slots: [
      keeper,
      ...backFour,
      s('CDM', DM, 0.38),
      s('CDM', DM, 0.62),
      s('LW', AM, 0.16),
      s('CAM', AM - 0.01, 0.5),
      s('RW', AM, 0.84),
      s('ST', FWD, 0.5),
    ],
  },
  {
    id: '4-4-2',
    label: '4-4-2',
    slots: [keeper, ...backFour, ...flatFourMidfield, ...twoStrikers],
  },
  {
    id: '4-1-4-1',
    label: '4-1-4-1',
    slots: [
      keeper,
      ...backFour,
      s('CDM', DM - 0.01, 0.5),
      s('LM', MID + 0.03, 0.14),
      s('LCM', MID + 0.02, 0.38),
      s('RCM', MID + 0.02, 0.62),
      s('RM', MID + 0.03, 0.86),
      s('ST', FWD, 0.5),
    ],
  },
  {
    id: '4-3-2-1',
    label: '4-3-2-1',
    slots: [
      keeper,
      ...backFour,
      s('LCM', MID - 0.02, 0.3),
      s('CM', MID - 0.03, 0.5),
      s('RCM', MID - 0.02, 0.7),
      s('CAM', AM, 0.38),
      s('CAM', AM, 0.62),
      s('ST', FWD, 0.5),
    ],
  },
  {
    id: '3-5-2',
    label: '3-5-2',
    slots: [
      keeper,
      ...backThree,
      s('LWB', MID, 0.1),
      s('LCM', MID, 0.34),
      s('CDM', DM, 0.5),
      s('RCM', MID, 0.66),
      s('RWB', MID, 0.9),
      ...twoStrikers,
    ],
  },
  {
    id: '3-4-3',
    label: '3-4-3',
    slots: [
      keeper,
      ...backThree,
      ...wingBackMidfield,
      s('LW', FWD - 0.02, 0.18),
      s('ST', FWD, 0.5),
      s('RW', FWD - 0.02, 0.82),
    ],
  },
  {
    id: '3-4-2-1',
    label: '3-4-2-1',
    slots: [
      keeper,
      ...backThree,
      ...wingBackMidfield,
      s('CAM', AM, 0.36),
      s('CAM', AM, 0.64),
      s('ST', FWD, 0.5),
    ],
  },
  {
    id: '5-3-2',
    label: '5-3-2',
    slots: [
      keeper,
      ...backFive,
      s('LCM', MID, 0.3),
      s('CM', MID - 0.01, 0.5),
      s('RCM', MID, 0.7),
      ...twoStrikers,
    ],
  },
  {
    id: '5-4-1',
    label: '5-4-1',
    slots: [keeper, ...backFive, ...flatFourMidfield, s('ST', FWD, 0.5)],
  },
];

export const DEFAULT_FORMATION: FormationId = '4-3-3';

const BY_ID = new Map(FORMATIONS.map((f) => [f.id, f]));

export function isFormationId(value: unknown): value is FormationId {
  return typeof value === 'string' && BY_ID.has(value as FormationId);
}

export function getFormation(id: FormationId): FormationPreset {
  const preset = BY_ID.get(id);
  if (!preset) throw new Error(`Unknown formation ${id}`);
  return preset;
}
