import { PITCH_LENGTH, PITCH_WIDTH } from '../geometry';
import type { ReplayPoint } from '../types';
import { clampUnit, corridor, distanceM, distanceToSegmentM, ellipse, lerp, pointInPolygon, rect, toMetres } from './geometry';
import type { OptionId, OutcomeId, Pt, SpaceRule, TacticScenario } from './types';

/**
 * Evaluates the scenario's space rules against sampled positions. Everything
 * is a pure function of (scenario, selection, positions, t): no model, no
 * randomness. Results are in the authored (left-flank, attacking) frame.
 */

export type SpaceKind = 'open' | 'lane' | 'cover' | 'exposed' | 'target' | 'overload';
type SpaceStatus = 'open' | 'contested';

export interface SpaceHighlight {
  id: string;
  kind: SpaceKind;
  status: SpaceStatus;
  label: string;
  /** The label without a status suffix: what is drawn on the pitch (status is shown by the outline). */
  short: string;
  /** A second, smaller line (what the geometry says), when there is one. */
  detail?: string;
  points: ReplayPoint[];
}

export interface MarkingLine {
  id: string;
  defenderId: string;
  attackerId: string;
}

/** Distances in metres that decide whether a space is open, contested or gone. */
export const SPACE_THRESHOLDS = {
  /** A defender this close to the runner makes the channel contested. */
  channelContested: 8,
  /** A lane is open at or beyond this distance from every defender… */
  laneOpen: 4,
  /** …contested between the two values, and closed (not drawn) below this: his body is on the line. */
  laneClosed: 2.4,
  /** The winger's pocket: open beyond, contested between, closed below `pocketClosed`. */
  pocketOpen: 8,
  pocketClosed: 4.5,
  /** A defender within this distance counts as marking the attacker. */
  marked: 6,
  /** A ball carrier with a defender this close is being pressed. */
  underPressure: 6,
  /** A defender this close to a landing point is within reach of it. */
  withinReach: 4.5,
  /** Centre-backs closer together than this (replay units across) leave no gap to show. */
  gapMinUnits: 12,
} as const;

export type Positions = Readonly<Record<string, ReplayPoint>>;

export function defenderIds(scenario: TacticScenario): string[] {
  return scenario.roles.filter((r) => r.team === 'defence').map((r) => r.id);
}

const toPoint = (p: Pt): ReplayPoint => ({ x: p[0], y: p[1] });

/** Distance and name of the defender nearest to `point`. */
export function nearestDefender(
  scenario: TacticScenario,
  positions: Positions,
  point: ReplayPoint,
): { id: string; distanceM: number } | null {
  let best: { id: string; distanceM: number } | null = null;
  for (const id of defenderIds(scenario)) {
    const p = positions[id];
    if (!p) continue;
    const d = distanceM(p, point);
    if (best === null || d < best.distanceM) best = { id, distanceM: d };
  }
  return best;
}

function inWindow(rule: { window: readonly [number, number] }, t: number): boolean {
  return t >= rule.window[0] - 1e-9 && t <= rule.window[1] + 1e-9;
}

function endpoint(positions: Positions, ref: string | Pt): ReplayPoint | null {
  return typeof ref === 'string' ? (positions[ref] ?? null) : toPoint(ref);
}

/** Status of a ground lane / cross corridor from `from` to `to` given the defenders' positions. */
export function laneStatus(
  scenario: TacticScenario,
  positions: Positions,
  from: ReplayPoint,
  to: ReplayPoint,
  mode: 'ground' | 'cross' | 'lofted',
): { status: 'open' | 'contested' | 'closed'; clearanceM: number } {
  // A lofted ball passes over players in the middle: a cross is blocked only near the kicker,
  // a long switch only near the kicker or by the receiver's marker.
  const parts: [ReplayPoint, ReplayPoint][] =
    mode === 'cross'
      ? [[from, lerp(from, to, 0.4)]]
      : mode === 'lofted'
        ? [
            [from, lerp(from, to, 0.3)],
            [lerp(from, to, 0.75), to],
          ]
        : [[from, to]];
  let clearance = Infinity;
  for (const id of defenderIds(scenario)) {
    const p = positions[id];
    if (!p) continue;
    for (const [a, b] of parts) clearance = Math.min(clearance, distanceToSegmentM(p, a, b));
  }
  const status =
    clearance < SPACE_THRESHOLDS.laneClosed ? 'closed' : clearance < SPACE_THRESHOLDS.laneOpen ? 'contested' : 'open';
  return { status, clearanceM: clearance };
}

function evaluateRule(
  scenario: TacticScenario,
  rule: SpaceRule,
  positions: Positions,
): SpaceHighlight | null {
  const defenders = defenderIds(scenario).flatMap((id) => (positions[id] ? [positions[id]] : []));

  switch (rule.type) {
    case 'channel': {
      const runner = positions[rule.runner];
      if (!runner) return null;
      const x0 = runner.x + 1.5;
      if (x0 >= 95) return null;
      const points = rect(x0, clampUnit(runner.x + 24), 0, 15);
      if (defenders.some((d) => pointInPolygon(d, points))) return null;
      const nearest = Math.min(...defenders.map((d) => distanceM(d, runner)));
      const contested = nearest < SPACE_THRESHOLDS.channelContested;
      return {
        id: rule.id,
        kind: 'open',
        status: contested ? 'contested' : 'open',
        label: contested ? `${rule.label} (contested)` : rule.label,
        short: rule.label,
        detail: Number.isFinite(nearest) ? `nearest defender ${nearest.toFixed(0)} m away` : undefined,
        points,
      };
    }
    case 'lane': {
      const from = rule.from === 'ball' ? positions.ball : positions[rule.from];
      const to = endpoint(positions, rule.to);
      if (!from || !to || distanceM(from, to) < 3) return null;
      const { status, clearanceM } = laneStatus(scenario, positions, from, to, rule.mode);
      if (status === 'closed') return null;
      return {
        id: rule.id,
        kind: 'lane',
        status,
        label: status === 'contested' ? `${rule.label} (contested)` : rule.label,
        short: rule.label,
        detail: `${clearanceM.toFixed(1)} m from the nearest defender`,
        points: corridor(from, to, rule.mode === 'ground' ? 1.6 : 1.8),
      };
    }
    case 'gap': {
      const a = positions[rule.between[0]];
      const b = positions[rule.between[1]];
      const attacker = positions[rule.attacker];
      if (!a || !b) return null;
      if (Math.abs(a.y - b.y) < SPACE_THRESHOLDS.gapMinUnits) return null;
      const y0 = Math.min(a.y, b.y) + 3.5;
      const y1 = Math.max(a.y, b.y) - 3.5;
      if (y1 <= y0) return null;
      const points = rect(Math.max(a.x, b.x) - 2, 99, y0, y1);
      const nearest = attacker ? nearestDefender(scenario, positions, attacker) : null;
      const marked = nearest !== null && nearest.distanceM <= SPACE_THRESHOLDS.marked;
      return {
        id: rule.id,
        kind: 'open',
        status: marked ? 'contested' : 'open',
        label: rule.label,
        short: rule.label,
        detail: nearest
          ? marked
            ? `striker still marked (${nearest.distanceM.toFixed(1)} m)`
            : `nearest defender ${nearest.distanceM.toFixed(1)} m from the striker`
          : undefined,
        points,
      };
    }
    case 'cover': {
      const anchor = positions[rule.anchor];
      if (!anchor) return null;
      return {
        id: rule.id,
        kind: 'cover',
        status: 'open',
        label: rule.label,
        short: rule.label,
        detail: 'stays deeper against a counter',
        points: ellipse(anchor, rule.radiusM[0], rule.radiusM[1]),
      };
    }
    case 'exposed': {
      const runner = positions[rule.runner];
      if (!runner || runner.x < 62) return null;
      return {
        id: rule.id,
        kind: 'exposed',
        status: 'open',
        label: rule.label,
        short: rule.label,
        detail: 'space behind the advancing full-back',
        points: rect(Math.max(30, runner.x - 28), runner.x - 4, 0, 22),
      };
    }
    case 'pocket': {
      const anchor = positions[rule.anchor];
      if (!anchor) return null;
      const nearest = Math.min(...defenders.map((d) => distanceM(d, anchor)));
      if (nearest < SPACE_THRESHOLDS.pocketClosed) return null;
      const contested = nearest < SPACE_THRESHOLDS.pocketOpen;
      return {
        id: rule.id,
        kind: 'open',
        status: contested ? 'contested' : 'open',
        label: contested ? `${rule.label} (contested)` : rule.label,
        short: rule.label,
        detail: `nearest defender ${nearest.toFixed(0)} m`,
        points: ellipse(anchor, 6.5, 5),
      };
    }
    case 'overload': {
      const present = rule.attackers.flatMap((id) => (positions[id] ? [positions[id]] : []));
      if (present.length < 3) return null;
      const m = present.map(toMetres);
      const cx = m.reduce((a, p) => a + p.x, 0) / m.length;
      const cy = m.reduce((a, p) => a + p.y, 0) / m.length;
      // The zone is what the attackers occupy plus a margin: nobody is counted who is not near them.
      const rx = Math.max(12, Math.max(...m.map((p) => Math.abs(p.x - cx))) + 6);
      const ry = Math.max(9, Math.max(...m.map((p) => Math.abs(p.y - cy))) + 6);
      const centre = { x: cx / (PITCH_LENGTH / 100), y: cy / (PITCH_WIDTH / 100) };
      const inside = defenders.filter((d) => {
        const q = toMetres(d);
        return ((q.x - cx) / rx) ** 2 + ((q.y - cy) / ry) ** 2 <= 1;
      }).length;
      const advantage = present.length - inside;
      const count = `${present.length}v${inside}`;
      return {
        id: rule.id,
        kind: 'overload',
        status: advantage >= 1 ? 'open' : 'contested',
        label: advantage >= 1 ? `${count} overload` : `${count}, no overload`,
        short: advantage >= 1 ? `${count} overload` : `${count}`,
        detail: `${inside} defender${inside === 1 ? '' : 's'} in the zone`,
        points: ellipse(centre, rx, ry, 28),
      };
    }
    case 'zone': {
      const [x0, x1, y0, y1] = rule.rect;
      let clearance = Infinity;
      for (const d of defenders) {
        const dx = Math.max(x0 - d.x, 0, d.x - x1) * (PITCH_LENGTH / 100);
        const dy = Math.max(y0 - d.y, 0, d.y - y1) * (PITCH_WIDTH / 100);
        clearance = Math.min(clearance, Math.hypot(dx, dy));
      }
      if (clearance < rule.showAtM) return null;
      const contested = clearance < rule.openAtM;
      return {
        id: rule.id,
        kind: 'open',
        status: contested ? 'contested' : 'open',
        label: contested ? `${rule.label} (contested)` : rule.label,
        short: rule.label,
        detail: `nearest defender ${clearance.toFixed(0)} m from it`,
        points: rect(x0, x1, y0, y1),
      };
    }
    case 'target':
      return {
        id: rule.id,
        kind: 'target',
        status: 'open',
        label: rule.label,
        short: rule.label,
        points: ellipse(toPoint(rule.at), rule.radiusM, rule.radiusM * 0.9),
      };
  }
}

/** Highlights visible at `t` for the chosen outcome/option, in authored coordinates. */
export function evaluateSpaces(
  scenario: TacticScenario,
  selection: { outcome: OutcomeId; option: OptionId | null },
  positions: Positions,
  t: number,
): SpaceHighlight[] {
  const out: SpaceHighlight[] = [];
  for (const rule of scenario.spaces) {
    if (!inWindow(rule, t)) continue;
    if (rule.outcomes && !rule.outcomes.includes(selection.outcome)) continue;
    if (rule.options && !rule.options.includes(selection.option)) continue;
    const h = evaluateRule(scenario, rule, positions);
    if (h) out.push(rule.shortLabel && h.kind !== 'overload' ? { ...h, short: rule.shortLabel } : h);
  }
  return out;
}

export function evaluateMarking(
  scenario: TacticScenario,
  selection: { outcome: OutcomeId },
  positions: Positions,
  t: number,
): MarkingLine[] {
  return scenario.marking
    .filter((m) => inWindow(m, t) && (!m.outcomes || m.outcomes.includes(selection.outcome)))
    .filter((m) => positions[m.defender] && positions[m.attacker])
    .map((m) => ({ id: m.id, defenderId: m.defender, attackerId: m.attacker }));
}

