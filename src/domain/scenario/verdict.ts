import type { ReplayPoint } from '../types';
import { distanceM } from './geometry';
import { defenderIds, laneStatus, nearestDefender, SPACE_THRESHOLDS } from './spaces';
import type { Positions } from './spaces';
import type { Flank, Pt, TacticScenario, VerdictSpec } from './types';
import { byFlank } from './types';

/**
 * The sentence shown when an option's first pass lands: what the geometry at
 * that moment supports, and no more. It never awards a shot or a goal, and it
 * never calls a lane open without having measured it.
 */

const m = (n: number) => `${n.toFixed(1)} m`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface VerdictInput {
  scenario: TacticScenario;
  spec: VerdictSpec;
  flank: Flank;
  /** Positions when the ball is struck (including `ball`) and when it arrives. */
  atRelease: Positions;
  atArrival: Positions;
  /** Where the pass is going: a role id or a fixed point. */
  target: string | Pt;
  passer: string;
  style: 'pass' | 'lofted' | 'shot';
}

function targetPoint(positions: Positions, target: string | Pt): ReplayPoint | null {
  return typeof target === 'string' ? (positions[target] ?? null) : { x: target[0], y: target[1] };
}

const DEFAULT_NEXT = {
  time: 'There is time to shoot or pick a pass.',
  tight: 'He is closed down quickly: a first-time lay-off or pass is more realistic than a shot.',
  closed: 'He is already tight: keeping the ball or recycling beats forcing a shot.',
};

export function describeOption(input: VerdictInput): string {
  const { scenario, spec, flank, atRelease, atArrival, target, passer, style } = input;
  const role = (id: string) => scenario.roles.find((r) => r.id === id);
  const short = (id: string) => {
    const r = role(id);
    return r ? byFlank(r.short ?? r.label, flank) : id;
  };
  // Defenders are named the way captions name them ("their No. 3", or the label when a role has no short form).
  const label = short;
  const landing = targetPoint(atArrival, target);
  const from = atRelease[passer];
  if (!landing || !from) return '';
  const origin = atRelease.ball ?? from;
  const mode = style === 'lofted' ? 'lofted' : 'ground';

  if (spec.type === 'delivery') {
    const pressure = nearestDefender(scenario, atRelease, from);
    const near = defenderIds(scenario)
      .flatMap((id) => (atArrival[id] ? [{ id, d: distanceM(atArrival[id], landing) }] : []))
      .filter((x) => x.d <= SPACE_THRESHOLDS.withinReach)
      .sort((a, b) => a.d - b.d);
    const start = pressure
      ? pressure.distanceM <= SPACE_THRESHOLDS.underPressure
        ? `Delivered under pressure (${label(pressure.id)} ${m(pressure.distanceM)} away).`
        : `Delivered with time (nearest defender ${m(pressure.distanceM)} away).`
      : '';
    const end =
      near.length === 0
        ? `No defender is within ${SPACE_THRESHOLDS.withinReach} m of the landing zone as the ball arrives, though one can still get across.`
        : `Within reach of the landing zone: ${near.map((x) => `${label(x.id)} ${m(x.d)}`).join(', ')}. ${
            near.length > 1 ? 'A contested header.' : 'Still contested.'
          }`;
    return `${start} ${end} The ball arriving does not guarantee a shot.`.trim();
  }

  if (spec.type === 'receiver') {
    const receiver = typeof target === 'string' ? atArrival[target] : landing;
    const near = nearestDefender(scenario, atArrival, receiver);
    const lane = laneStatus(scenario, atRelease, origin, landing, mode);
    const laneText =
      lane.status === 'open'
        ? 'The lane was open at release.'
        : lane.status === 'contested'
          ? `The lane was contested at release (${m(lane.clearanceM)} from the nearest defender).`
          : `The lane was almost closed at release (${m(lane.clearanceM)} from the nearest defender), so this pass is a risk.`;
    if (!near) return laneText;
    const d = near.distanceM;
    const tiers = spec.next ?? DEFAULT_NEXT;
    const next =
      d >= SPACE_THRESHOLDS.underPressure ? tiers.time : d >= SPACE_THRESHOLDS.withinReach ? tiers.tight : tiers.closed;
    const who = typeof target === 'string' ? cap(short(target)) : 'The receiver';
    return `${laneText} ${who} receives with ${label(near.id)} ${m(d)} away. ${next}`;
  }

  if (spec.type === 'retain') {
    const declined = atRelease[spec.declined];
    const receiver = typeof target === 'string' ? target : null;
    if (!declined) return '';
    const lane = laneStatus(scenario, atRelease, origin, declined, 'ground');
    const word = lane.status === 'closed' ? 'closed' : lane.status === 'contested' ? 'contested' : 'open';
    const closer = nearestDefender(scenario, atArrival, landing);
    return [
      `The lane to ${short(spec.declined)} is ${word} at this moment (${m(lane.clearanceM)} from the nearest defender), so the pass is not on.`,
      receiver ? `${cap(short(passer))} keeps the ball and plays it to ${short(receiver)}${closer ? ` (nearest defender ${m(closer.distanceM)} away)` : ''}.` : '',
      'Possession is retained and the attack is re-set, not abandoned.',
    ]
      .filter(Boolean)
      .join(' ');
  }

  // lanes: the receiver, then how the lanes from him to the listed roles look.
  const near = nearestDefender(scenario, atArrival, landing);
  const words = spec.to.flatMap((id) => {
    const p = atArrival[id];
    if (!p) return [];
    const st = laneStatus(scenario, atArrival, landing, p, 'ground').status;
    return [`${short(id)} is ${st}`];
  });
  const who = typeof target === 'string' ? cap(short(target)) : 'The receiver';
  return [
    near ? `${who} receives with ${label(near.id)} ${m(near.distanceM)} away.` : `${who} receives.`,
    words.length ? `From there the lane to ${words.join(' and to ')}.` : '',
    'The attack is re-set rather than finished.',
  ]
    .filter(Boolean)
    .join(' ');
}
