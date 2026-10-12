import { clampPoint, distanceMetres, fromTeamFrame, toTeamFrame } from './geometry';
import { applyTemplate, positionFamily, resolveTemplate } from './layout';
import type { Drawing, DrawingKind, Id, LineupSlot, Point, SavedLayout, Team, TeamSide } from './types';

/**
 * Tactical patterns. Kept separate from formations: a pattern starts from the
 * team's *formation defaults* (so applying patterns never compounds), moves
 * players into a phase-of-play shape and adds movement/pass arrows.
 *
 * Pattern functions work in the TEAM frame (attacking toward x = 1, y = 0 on
 * the team's left) and are formation-agnostic: they find roles by position
 * family, then by coordinates. Side-specific patterns use the left flank.
 */

export type PatternId =
  | 'high-press'
  | 'mid-block'
  | 'low-block'
  | 'build-up'
  | 'overlap'
  | 'underlap'
  | 'wide-overload'
  | 'central-overload'
  | 'counterattack'
  | 'counter-press'
  | 'rotations'
  | 'set-piece';

/** A slot in the team frame, as patterns see it. */
interface PatternSlot {
  id: Id;
  position: LineupSlot['position'];
  x: number;
  y: number;
  filled: boolean;
  playerId: Id | null;
}

interface PatternArrow {
  kind: DrawingKind;
  fromSlotId: Id;
  /** Target is either another slot (its pattern position) or a team-frame point. */
  to: { slotId: Id } | { point: Point };
}

interface PatternResult {
  /** New team-frame position per slot id; every slot is included. */
  positions: Map<Id, Point>;
  arrows: PatternArrow[];
}

export interface TacticalPattern {
  id: PatternId;
  name: string;
  description: string;
  build(slots: PatternSlot[]): PatternResult;
}

// --- helpers ---------------------------------------------------------------

const isGK = (s: PatternSlot) => s.position === 'GK';
const outfield = (slots: PatternSlot[]) => slots.filter((s) => !isGK(s));
const byFamily = (slots: PatternSlot[], ...families: string[]) =>
  slots.filter((s) => families.includes(positionFamily(s.position)));

/** Applies `fn` to every slot's current point; returns a full position map. */
function mapPositions(slots: PatternSlot[], fn: (s: PatternSlot) => Point): Map<Id, Point> {
  return new Map(slots.map((s) => [s.id, clampPoint(fn(s))]));
}

function setPos(positions: Map<Id, Point>, slot: PatternSlot | undefined, p: Point) {
  if (slot) positions.set(slot.id, clampPoint(p));
}

function pos(positions: Map<Id, Point>, slot: PatternSlot): Point {
  return positions.get(slot.id) ?? { x: slot.x, y: slot.y };
}

/** Block shift: move outfield players up/down the pitch and squeeze the width. */
function block(slots: PatternSlot[], opts: { offset: number; depthScale: number; width: number; gkX: number }) {
  return mapPositions(slots, (s) =>
    isGK(s)
      ? { x: opts.gkX, y: 0.5 }
      : { x: opts.offset + s.x * opts.depthScale, y: 0.5 + (s.y - 0.5) * opts.width },
  );
}

const shiftUp = (slots: PatternSlot[], dx: number) =>
  mapPositions(slots, (s) => (isGK(s) ? { x: s.x + dx / 3, y: s.y } : { x: s.x + dx, y: s.y }));

/** Leftmost slot (smallest y) among candidates, preferring filled ones. */
function leftmost(candidates: PatternSlot[]): PatternSlot | undefined {
  return [...candidates].sort((a, b) => Number(b.filled) - Number(a.filled) || a.y - b.y || a.x - b.x)[0];
}

function mostAdvanced(candidates: PatternSlot[], n: number): PatternSlot[] {
  return [...candidates].sort((a, b) => b.x - a.x || a.y - b.y).slice(0, n);
}

const leftFullBack = (slots: PatternSlot[]) =>
  leftmost(byFamily(slots, 'fbL')) ?? leftmost(outfield(slots).filter((s) => s.x < 0.25));

const leftWideAttacker = (slots: PatternSlot[]) =>
  leftmost(byFamily(slots, 'wideL')) ??
  leftmost(outfield(slots).filter((s) => s.x >= 0.3 && positionFamily(s.position) !== 'fbL'));

const leftCentralMid = (slots: PatternSlot[]) => leftmost(byFamily(slots, 'cm', 'am'));

const move = (from: PatternSlot | undefined, point: Point): PatternArrow[] =>
  from ? [{ kind: 'movement', fromSlotId: from.id, to: { point: clampPoint(point) } }] : [];

const pass = (from: PatternSlot | undefined, to: PatternSlot | Point | undefined): PatternArrow[] => {
  if (!from || !to) return [];
  return 'id' in to
    ? [{ kind: 'pass', fromSlotId: from.id, to: { slotId: to.id } }]
    : [{ kind: 'pass', fromSlotId: from.id, to: { point: clampPoint(to) } }];
};

/** Sends each runner to the nearest unused target (greedy, deterministic). */
function runsTo(runners: PatternSlot[], positions: Map<Id, Point>, targets: Point[]): PatternArrow[] {
  const free = [...targets];
  const arrows: PatternArrow[] = [];
  for (const r of [...runners].sort((a, b) => a.y - b.y)) {
    if (free.length === 0) break;
    const from = pos(positions, r);
    let best = 0;
    for (let i = 1; i < free.length; i++) {
      if (distanceMetres(from, free[i]) < distanceMetres(from, free[best])) best = i;
    }
    arrows.push(...move(r, free[best]));
    free.splice(best, 1);
  }
  return arrows;
}

/** Front-line targets laid out across the width for `n` runners. */
function frontTargets(n: number, x: number, spread: number): Point[] {
  if (n <= 1) return [{ x, y: 0.5 }];
  return Array.from({ length: n }, (_, i) => ({ x: x - (i === 0 || i === n - 1 ? 0.03 : 0), y: 0.5 - spread / 2 + (spread * i) / (n - 1) }));
}

// --- patterns --------------------------------------------------------------

export const PATTERNS: readonly TacticalPattern[] = [
  {
    id: 'high-press',
    name: 'High press',
    description: 'Whole team steps into the opposition half; the front line presses the centre backs and goalkeeper.',
    build(slots) {
      const positions = block(slots, { offset: 0.27, depthScale: 1, width: 0.95, gkX: 0.14 });
      const front = mostAdvanced(outfield(slots).filter((s) => s.filled), 3);
      return { positions, arrows: runsTo(front, positions, frontTargets(front.length, 0.9, 0.4)) };
    },
  },
  {
    id: 'mid-block',
    name: 'Mid-block',
    description: 'Compact shape around halfway; wide players narrow to deny central passes.',
    build(slots) {
      const positions = block(slots, { offset: 0.12, depthScale: 0.85, width: 0.8, gkX: 0.06 });
      // Midfielders/attackers in the wide lanes narrow (works for narrow formations too).
      const wide = outfield(slots).filter((s) => s.filled && s.x >= 0.24 && Math.abs(s.y - 0.5) > 0.15);
      const arrows = wide.flatMap((s) => {
        const p = pos(positions, s);
        return move(s, { x: p.x - 0.02, y: p.y + (p.y < 0.5 ? 0.1 : -0.1) });
      });
      return { positions, arrows };
    },
  },
  {
    id: 'low-block',
    name: 'Low block',
    description: 'Deep, narrow two banks protecting the box; one forward stays high as the outlet.',
    build(slots) {
      const positions = block(slots, { offset: 0.06, depthScale: 0.5, width: 0.75, gkX: 0.03 });
      const [outlet] = mostAdvanced(outfield(slots), 1);
      if (outlet) setPos(positions, outlet, { x: 0.36, y: 0.5 });
      // Wide-lane midfielders/wing-backs drop next to the defence to form a back five or six.
      const wide = outfield(slots).filter(
        (s) => s.filled && s.id !== outlet?.id && s.x >= 0.24 && Math.abs(s.y - 0.5) > 0.15,
      );
      const arrows = wide.flatMap((s) => {
        const p = pos(positions, s);
        return move(s, { x: 0.13, y: p.y });
      });
      return { positions, arrows };
    },
  },
  {
    id: 'build-up',
    name: 'Build-up from the back',
    description: 'Centre backs split wide, a midfielder drops in as the pivot and full backs push high and wide.',
    build(slots) {
      const positions = shiftUp(slots, 0.12);
      const gk = slots.find(isGK);
      setPos(positions, gk, { x: 0.03, y: 0.5 });
      const cbs = [...byFamily(slots, 'cb')].sort((a, b) => a.y - b.y);
      const leftCb = cbs[0];
      const rightCb = cbs.length > 1 ? cbs[cbs.length - 1] : undefined;
      setPos(positions, leftCb, { x: 0.08, y: 0.24 });
      setPos(positions, rightCb, { x: 0.08, y: 0.76 });
      for (const middle of cbs.slice(1, -1)) setPos(positions, middle, { x: 0.12, y: 0.5 });
      for (const fb of byFamily(slots, 'fbL')) setPos(positions, fb, { x: 0.3, y: 0.06 });
      for (const fb of byFamily(slots, 'fbR')) setPos(positions, fb, { x: 0.3, y: 0.94 });
      const mids = [...byFamily(slots, 'cm')].sort((a, b) => a.x - b.x || Math.abs(a.y - 0.5) - Math.abs(b.y - 0.5));
      const pivot = mids[0];
      setPos(positions, pivot, { x: 0.18, y: 0.5 });
      const receiver = mids[1] ?? leftWideAttacker(slots);
      return { positions, arrows: [...pass(gk, leftCb), ...pass(leftCb, pivot), ...pass(pivot, receiver)] };
    },
  },
  {
    id: 'overlap',
    name: 'Overlapping full-back',
    description: 'Left winger checks inside with the ball while the left back overlaps around the outside.',
    build(slots) {
      const positions = shiftUp(slots, 0.2);
      const fb = leftFullBack(slots);
      const winger = leftWideAttacker(slots);
      const run = { x: 0.8, y: 0.05 };
      const arrows = [...move(fb, run)];
      if (winger) {
        const p = pos(positions, winger);
        arrows.push(...move(winger, { x: p.x + 0.04, y: 0.3 }), ...pass(winger, run));
      }
      return { positions, arrows };
    },
  },
  {
    id: 'underlap',
    name: 'Underlapping full-back',
    description: 'Left winger holds the touchline; the left back runs inside him into the half-space.',
    build(slots) {
      const positions = shiftUp(slots, 0.2);
      const fb = leftFullBack(slots);
      const winger = leftWideAttacker(slots);
      setPos(positions, winger, { x: 0.68, y: 0.06 });
      const run = { x: 0.8, y: 0.28 };
      return { positions, arrows: [...move(fb, run), ...pass(winger, run)] };
    },
  },
  {
    id: 'wide-overload',
    name: 'Wide overload',
    description: 'Midfield and attack shift to the left flank to create a numerical advantage out wide.',
    build(slots) {
      const positions = mapPositions(slots, (s) => {
        if (isGK(s)) return { x: s.x + 0.05, y: 0.45 };
        const attacking = s.x >= 0.24;
        return attacking
          ? { x: s.x + 0.22, y: 0.1 + s.y * 0.55 }
          : { x: s.x + 0.18, y: s.y * 0.85 };
      });
      const fb = leftFullBack(slots);
      const cm = leftCentralMid(slots);
      return { positions, arrows: [...move(fb, { x: 0.76, y: 0.05 }), ...move(cm, { x: 0.66, y: 0.24 })] };
    },
  },
  {
    id: 'central-overload',
    name: 'Central overload',
    description: 'Wide attackers tuck inside to crowd the centre; full backs provide all the width.',
    build(slots) {
      const positions = shiftUp(slots, 0.2);
      for (const s of byFamily(slots, 'wideL', 'wideR')) {
        const p = pos(positions, s);
        setPos(positions, s, { x: p.x, y: 0.5 + (p.y - 0.5) * 0.4 });
      }
      const arrows: PatternArrow[] = [];
      for (const fb of byFamily(slots, 'fbL')) arrows.push(...move(fb, { x: 0.7, y: 0.05 }));
      for (const fb of byFamily(slots, 'fbR')) arrows.push(...move(fb, { x: 0.7, y: 0.95 }));
      const [runner] = mostAdvanced(byFamily(slots, 'am', 'cm'), 1);
      if (runner) arrows.push(...move(runner, { x: 0.74, y: 0.5 }));
      return { positions, arrows };
    },
  },
  {
    id: 'counterattack',
    name: 'Counterattack',
    description: 'On regaining the ball, the front players sprint into space and a midfielder plays the early ball forward.',
    build(slots) {
      const positions = mapPositions(slots, (s) => ({ x: s.x, y: s.y }));
      const front = mostAdvanced(outfield(slots).filter((s) => s.filled), 3);
      const targets = frontTargets(front.length, 0.85, 0.5);
      const arrows = runsTo(front, positions, targets);
      const frontIds = new Set(front.map((f) => f.id));
      const [passer] = mostAdvanced(byFamily(slots, 'cm', 'am').filter((s) => s.filled && !frontIds.has(s.id)), 1);
      const central = targets[Math.floor(targets.length / 2)];
      return { positions, arrows: [...arrows, ...pass(passer, central)] };
    },
  },
  {
    id: 'counter-press',
    name: 'Counter-press',
    description: 'Ball lost high on the left: the four nearest players swarm the ball carrier immediately.',
    build(slots) {
      const positions = shiftUp(slots, 0.25);
      const ball = { x: 0.68, y: 0.3 };
      const nearest = outfield(slots)
        .filter((s) => s.filled)
        .sort((a, b) => distanceMetres(pos(positions, a), ball) - distanceMetres(pos(positions, b), ball))
        .slice(0, 4);
      const targets = [
        { x: ball.x - 0.04, y: ball.y - 0.07 },
        { x: ball.x - 0.04, y: ball.y + 0.07 },
        { x: ball.x + 0.03, y: ball.y - 0.06 },
        { x: ball.x + 0.03, y: ball.y + 0.06 },
      ];
      return { positions, arrows: runsTo(nearest, positions, targets) };
    },
  },
  {
    id: 'rotations',
    name: 'Positional rotations',
    description: 'Left-side triangle rotates: full back to the wing, winger inside, central midfielder covers the full-back spot.',
    build(slots) {
      const positions = shiftUp(slots, 0.2);
      const fb = leftFullBack(slots);
      const winger = leftWideAttacker(slots);
      const cm = leftCentralMid(slots);
      const arrows: PatternArrow[] = [];
      if (fb && winger) arrows.push({ kind: 'movement', fromSlotId: fb.id, to: { slotId: winger.id } });
      if (winger && cm) arrows.push({ kind: 'movement', fromSlotId: winger.id, to: { slotId: cm.id } });
      if (cm && fb) arrows.push({ kind: 'movement', fromSlotId: cm.id, to: { slotId: fb.id } });
      return { positions, arrows };
    },
  },
  {
    id: 'set-piece',
    name: 'Set piece: attacking corner',
    description: 'Corner from the left: aerial threats attack the posts and six-yard box, two stay on the edge, full backs guard the counter.',
    build(slots) {
      const positions = mapPositions(slots, (s) => ({ x: s.x, y: s.y }));
      const gk = slots.find(isGK);
      setPos(positions, gk, { x: 0.06, y: 0.5 });
      const taker = leftWideAttacker(slots) ?? leftmost(outfield(slots));
      setPos(positions, taker, { x: 1, y: 0 });
      // Aerial priority: centre backs and forwards attack the box, full backs stay back.
      const priority: Record<string, number> = { cb: 0, fw: 1, cm: 2, am: 3, wideL: 4, wideR: 4, fbR: 5, fbL: 6 };
      const rest = outfield(slots)
        .filter((s) => s.id !== taker?.id)
        .sort((a, b) => priority[positionFamily(a.position)] - priority[positionFamily(b.position)] || a.y - b.y);
      const targets: Point[] = [
        { x: 0.955, y: 0.43 }, // near post
        { x: 0.955, y: 0.6 }, // far post
        { x: 0.965, y: 0.51 }, // six-yard centre
        { x: 0.895, y: 0.5 }, // penalty spot
        { x: 0.9, y: 0.68 }, // back post, wide
        { x: 0.82, y: 0.42 }, // edge of the box
        { x: 0.82, y: 0.6 }, // edge of the box
        { x: 0.58, y: 0.35 }, // rest defence
        { x: 0.58, y: 0.65 }, // rest defence
      ];
      rest.forEach((s, i) => setPos(positions, s, targets[i] ?? { x: 0.45, y: 0.5 }));
      const arrows = [
        ...pass(taker, { x: 0.93, y: 0.48 }),
        ...move(rest[0], { x: 0.97, y: 0.45 }),
        ...move(rest[3], { x: 0.94, y: 0.53 }),
      ];
      return { positions, arrows };
    },
  },
];

const BY_ID = new Map(PATTERNS.map((p) => [p.id, p]));

export function isPatternId(value: unknown): value is PatternId {
  return typeof value === 'string' && BY_ID.has(value as PatternId);
}

export function getPattern(id: PatternId): TacticalPattern {
  const pattern = BY_ID.get(id);
  if (!pattern) throw new Error(`Unknown pattern ${id}`);
  return pattern;
}

export interface AppliedPattern {
  team: Team;
  drawings: Drawing[];
}

/**
 * Applies a pattern to a team: resets to formation defaults, moves slots to
 * the pattern shape and builds absolute-coordinate drawings tagged with the
 * pattern. Drawing ids are `${idSeed}-${n}` so the caller controls uniqueness.
 * Slot ids and occupants never change.
 */
export function applyPattern(
  team: Team,
  side: TeamSide,
  patternId: PatternId,
  savedLayouts: readonly SavedLayout[],
  idSeed: Id,
): AppliedPattern {
  const template = resolveTemplate(team.formation, savedLayouts);
  const base = template ? applyTemplate(team, template, side, team.formation) : team;
  const slots: PatternSlot[] = base.slots.map((s) => {
    const p = toTeamFrame({ x: s.x, y: s.y }, side);
    return { id: s.id, position: s.position, x: p.x, y: p.y, filled: s.playerId !== null, playerId: s.playerId };
  });

  const result = getPattern(patternId).build(slots);
  const absolute = (p: Point) => clampPoint(fromTeamFrame(p, side));
  const positionOf = (slotId: Id) => result.positions.get(slotId);

  const nextTeam: Team = {
    ...base,
    slots: base.slots.map((s) => {
      const p = positionOf(s.id);
      if (!p) return s;
      const a = absolute(p);
      return { ...s, x: a.x, y: a.y };
    }),
  };

  const slotById = new Map(slots.map((s) => [s.id, s]));
  const drawings: Drawing[] = [];
  for (const arrow of result.arrows) {
    const fromSlot = slotById.get(arrow.fromSlotId);
    const from = positionOf(arrow.fromSlotId);
    if (!fromSlot || !from || !fromSlot.filled) continue; // arrows only for real players
    const toSlot = 'slotId' in arrow.to ? slotById.get(arrow.to.slotId) : undefined;
    const to = 'slotId' in arrow.to ? positionOf(arrow.to.slotId) : arrow.to.point;
    if (!to || distanceMetres(from, to) < 0.5) continue;
    drawings.push({
      id: `${idSeed}-${drawings.length + 1}`,
      kind: arrow.kind,
      from: absolute(from),
      to: absolute(to),
      fromPlayerId: fromSlot.playerId ?? undefined,
      toPlayerId: toSlot?.playerId ?? undefined,
      source: { patternId, teamId: team.id },
    });
  }
  return { team: nextTeam, drawings };
}
