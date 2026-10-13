import { interpolateTrack, samplePositions } from '../replay/interpolate';
import { teamFrameToReplay } from '../replay/coords';
import type {
  ReplayActor,
  ReplayAnnotation,
  ReplayKeyframe,
  ReplayPath,
  ReplayPoint,
  TacticalReplay,
  TeamSide,
} from '../types';
import { distanceM, placeLabels } from './geometry';
import { evaluateMarking, evaluateSpaces } from './spaces';
import type { SpaceHighlight } from './spaces';
import { describeOption } from './verdict';
import { byFlank } from './types';
import type {
  BallLeg,
  Flank,
  OptionDef,
  OptionId,
  OutcomeId,
  Segment,
  TacticScenario,
  Waypoint,
} from './types';

/**
 * Compiles a scenario + a selection (which outcome, which final option) into
 * an ordinary `TacticalReplay`. Nothing here is random or reads the clock, so
 * the same inputs always produce the same replay; replaying calls no model.
 */

export interface ScenarioSelection {
  outcome: OutcomeId;
  /** Null until the user picks one at the decision point. Options never combine. */
  option: OptionId | null;
}

export interface ScenarioContext {
  /** The side that is Team A (attacking). */
  side: TeamSide;
  flank: Flank;
}

export interface ResolvedStage {
  id: string;
  /** "Stage 3", or the decision stage's own label. */
  label: string;
  /** False for a stage that exists but cannot be reached yet (the resolve stage before an option is chosen). */
  available: boolean;
  title: string;
  summary: string;
  coaching: string[];
  outcomeNote: string | null;
  start: number;
  end: number;
}

export interface ScenarioBuild {
  scenario: TacticScenario;
  selection: ScenarioSelection;
  context: ScenarioContext;
  /** Canonical frame: what the replay player draws. */
  replay: TacticalReplay;
  /** Authored frame (left flank, attacking toward x = 100): what the space rules are evaluated in. */
  author: TacticalReplay;
  duration: number;
  decisionT: number;
  stages: ResolvedStage[];
  /** actor id → text drawn on the marker. */
  badges: Record<string, string>;
  /** Seconds a path stays visible after it ends, by path id. */
  pathHold: Record<string, number>;
  /** Stage boundaries and the decision, for the transport's step buttons. */
  stepMarks: number[];
}

/** The ball sits just ahead of the carrier's marker (marker radius 2.6 m ≈ 2.5 units), so it is never hidden under it. */
const CARRY_OFFSET = 3;
const CARRY_STEP = 0.5;
const PASS_STEPS = 4;
const EPOCH = '1970-01-01T00:00:00.000Z';
const BALL = 'ball';
/** Seconds between the decision key and its hold (see the keyframe step in buildScenario). */
const DECISION_HOLD = 0.002;
const DEFAULT_HOLD = 1;

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Authored point → canonical replay point (flank mirror, then the attacking side's orientation). */
function authorToCanonical(p: ReplayPoint, ctx: ScenarioContext): ReplayPoint {
  const flanked = ctx.flank === 'right' ? { x: p.x, y: 100 - p.y } : p;
  return teamFrameToReplay(flanked, ctx.side);
}

function optionSegment(def: OptionDef, outcome: OutcomeId): Segment {
  const override = def.byOutcome?.[outcome];
  if (override?.replace) {
    return {
      tracks: override.tracks ?? {},
      ball: override.ball ?? [],
      arrows: override.arrows ?? [],
      beats: override.beats ?? [],
    };
  }
  return {
    tracks: { ...def.tracks, ...(override?.tracks ?? {}) },
    ball: override?.ball ?? def.ball,
    arrows: [...def.arrows, ...(override?.arrows ?? [])],
    beats: [...def.beats, ...(override?.beats ?? [])],
  };
}

/** The segments that make up the selected line, in time order. */
function segmentsFor(scenario: TacticScenario, selection: ScenarioSelection): Segment[] {
  const list: Segment[] = [scenario.base, scenario.outcomes[selection.outcome]];
  if (selection.option) list.push(optionSegment(scenario.options[selection.option], selection.outcome));
  return list;
}

function mergeTracks(segments: readonly Segment[]): Record<string, Waypoint[]> {
  const byRole = new Map<string, Map<number, Waypoint>>();
  for (const segment of segments) {
    for (const [role, waypoints] of Object.entries(segment.tracks)) {
      const map = byRole.get(role) ?? new Map<number, Waypoint>();
      // A later segment owns a moment it restates.
      for (const w of waypoints) map.set(round3(w[0]), w);
      byRole.set(role, map);
    }
  }
  const out: Record<string, Waypoint[]> = {};
  for (const [role, map] of byRole) out[role] = [...map.values()].sort((a, b) => a[0] - b[0]);
  return out;
}

/**
 * The curve through a waypoint takes its tangent from the next one, so a branch's first waypoint would
 * reshape the last stretch before the decision. A hold a hair after the decision keeps that stretch
 * identical in every line (the tangent then looks at the hold, not at the branch).
 */
function isolateDecision(tracks: Record<string, Waypoint[]>, decisionT: number): void {
  const at0 = round3(decisionT);
  for (const list of Object.values(tracks)) {
    const here = list.find((w) => round3(w[0]) === at0);
    if (!here) continue;
    if (list.some((w) => w[0] > at0 && w[0] <= at0 + DECISION_HOLD)) continue;
    list.push([at0 + DECISION_HOLD, here[1], here[2]]);
    list.sort((a, b) => a[0] - b[0]);
  }
}

function trackAt(track: readonly Waypoint[] | undefined, t: number): ReplayPoint | null {
  if (!track || track.length === 0) return null;
  return interpolateTrack(
    track.map((w) => ({ t: w[0], p: { x: w[1], y: w[2] } })),
    t,
  );
}

function resolveStages(
  scenario: TacticScenario,
  selection: ScenarioSelection,
  duration: number,
  firstPassEnd: number | null,
): ResolvedStage[] {
  const stages: ResolvedStage[] = scenario.stages.map((s, i) => {
    const span = Array.isArray(s.span) ? (s.span as readonly [number, number]) : (s.span as Record<OutcomeId, readonly [number, number]>)[selection.outcome];
    return {
      id: s.id,
      label: `Stage ${i + 1}`,
      available: true,
      title: s.title,
      summary: s.summary,
      coaching: s.coaching,
      outcomeNote: s.outcomeNotes?.[selection.outcome] ?? null,
      start: span[0],
      end: span[1],
    };
  });
  const resolves = scenario.resolveStage !== undefined;
  // With a resolve stage, the decision stage ends when the chosen option's first pass lands.
  const splitAt = resolves && selection.option && firstPassEnd !== null ? firstPassEnd : null;
  stages.push({
    id: 'decision',
    label: scenario.decisionStage.label ?? 'Decision',
    available: true,
    title: scenario.decisionStage.title,
    summary: scenario.decisionStage.summary,
    coaching: scenario.decisionStage.coaching,
    outcomeNote: null,
    start: scenario.decisionT,
    end: splitAt ?? Math.max(scenario.decisionT, duration),
  });
  if (scenario.resolveStage) {
    stages.push({
      id: 'resolve',
      label: `Stage ${scenario.stages.length + 2}`,
      available: splitAt !== null,
      title: scenario.resolveStage.title,
      summary: scenario.resolveStage.summary,
      coaching: scenario.resolveStage.coaching,
      outcomeNote: null,
      start: splitAt ?? duration,
      end: duration,
    });
  }
  return stages;
}

function legEndT(leg: BallLeg): number {
  return leg.t1;
}

export function buildScenario(
  scenario: TacticScenario,
  selection: ScenarioSelection,
  ctx: ScenarioContext,
): ScenarioBuild {
  const segments = segmentsFor(scenario, selection);
  const tracks = mergeTracks(segments);
  if (selection.option) isolateDecision(tracks, scenario.decisionT);
  const legs = segments.flatMap((s) => s.ball).sort((a, b) => a.t0 - b.t0);
  const option = selection.option ? scenario.options[selection.option] : null;
  const duration = option ? option.end : scenario.decisionT;
  const at = (role: string, t: number) => trackAt(tracks[role], t);

  const frameOf = (side: 'attack' | 'defence'): TeamSide =>
    side === 'attack' ? ctx.side : ctx.side === 'home' ? 'away' : 'home';

  const actors: ReplayActor[] = scenario.roles.map((r) => ({
    id: r.id,
    kind: 'player',
    side: frameOf(r.team),
    label: byFlank(r.label, ctx.flank),
    shirtNumber: null,
    name: '',
    playerId: null,
    confidence: null,
    evidence: '',
  }));
  actors.push({ id: BALL, kind: 'ball', side: null, label: 'Ball', shirtNumber: null, name: '', playerId: null, confidence: null, evidence: '' });

  // --- ball track + pass arrows ------------------------------------------
  const ballKeys = new Map<number, ReplayPoint>();
  const paths: ReplayPath[] = [];
  const pathHold: Record<string, number> = {};
  const withOffset = (p: ReplayPoint): ReplayPoint => ({ x: Math.min(100, p.x + CARRY_OFFSET), y: p.y });

  for (const leg of legs) {
    if (leg.kind === 'carry') {
      const steps = Math.max(1, Math.round((leg.t1 - leg.t0) / CARRY_STEP));
      for (let i = 0; i <= steps; i++) {
        const t = round3(leg.t0 + ((leg.t1 - leg.t0) * i) / steps);
        const p = at(leg.by, t);
        if (p) ballKeys.set(t, withOffset(p));
      }
      continue;
    }
    const start = at(leg.from, leg.t0);
    const endRole = typeof leg.to === 'string' ? at(leg.to, leg.t1) : null;
    const end = endRole ? withOffset(endRole) : typeof leg.to === 'string' ? null : { x: leg.to[0], y: leg.to[1] };
    if (!start || !end) continue;
    const from = withOffset(start);
    for (let i = 0; i <= PASS_STEPS; i++) {
      const s = i / PASS_STEPS;
      ballKeys.set(round3(leg.t0 + (leg.t1 - leg.t0) * s), { x: from.x + (end.x - from.x) * s, y: from.y + (end.y - from.y) * s });
    }
    const id = `pass-${paths.length + 1}`;
    paths.push({
      id,
      kind: leg.style,
      startT: leg.t0,
      endT: leg.t1,
      from: start,
      to: typeof leg.to === 'string' ? (endRole ?? end) : { x: leg.to[0], y: leg.to[1] },
      fromActorId: leg.from,
      toActorId: typeof leg.to === 'string' ? leg.to : null,
      note: leg.note ?? '',
      confidence: null,
      source: 'user',
    });
    pathHold[id] = leg.hold ?? DEFAULT_HOLD;
  }

  // --- movement arrows ----------------------------------------------------
  for (const segment of segments) {
    for (const arrow of segment.arrows) {
      const from = at(arrow.actor, arrow.t0);
      const to = arrow.to ? { x: arrow.to[0], y: arrow.to[1] } : at(arrow.actor, arrow.t1);
      if (!from || !to) continue;
      const id = `move-${arrow.id}`;
      paths.push({
        id,
        kind: 'movement',
        startT: arrow.t0,
        endT: arrow.t1,
        from,
        to,
        fromActorId: arrow.actor,
        toActorId: null,
        note: arrow.note ?? '',
        confidence: null,
        source: 'user',
      });
      pathHold[id] = arrow.hold ?? DEFAULT_HOLD;
    }
  }

  // --- keyframes ------------------------------------------------------------
  const frames = new Map<number, ReplayKeyframe>();
  const place = (t: number, actorId: string, p: ReplayPoint) => {
    const key = round3(t);
    const frame = frames.get(key) ?? { id: '', t: key, positions: {} };
    frame.positions[actorId] = { x: round3(p.x), y: round3(p.y), confidence: null, source: 'user' };
    frames.set(key, frame);
  };
  for (const [role, waypoints] of Object.entries(tracks)) for (const [t, x, y] of waypoints) place(t, role, { x, y });
  for (const [t, p] of ballKeys) place(t, BALL, p);
  // The ball is a track of its own: isolate it the same way (see `isolateDecision`).
  if (selection.option) {
    const at0 = round3(scenario.decisionT);
    const decision = frames.get(at0)?.positions[BALL];
    const later = [...frames.values()].some((k) => k.t > at0 && k.t <= at0 + DECISION_HOLD && k.positions[BALL]);
    if (decision && !later) place(at0 + DECISION_HOLD, BALL, decision);
  }
  const keyframes = [...frames.values()].sort((a, b) => a.t - b.t).map((k, i) => ({ ...k, id: `kf-${i + 1}` }));

  // --- captions ---------------------------------------------------------------
  const beats = segments.flatMap((s) => s.beats).sort((a, b) => a.t - b.t);
  const annotations: ReplayAnnotation[] = beats.map((b, i) => ({
    id: `beat-${i + 1}`,
    t: b.t,
    label: b.text,
    point: null,
    eventType: null,
  }));

  if (scenario.minNoteLengthM !== undefined) {
    for (const p of paths) if (p.note && distanceM(p.from, p.to) < scenario.minNoteLengthM) p.note = '';
  }

  const author: TacticalReplay = {
    id: `scenario-${scenario.id}`,
    title: scenario.title,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    origin: 'manual',
    tracking: null,
    attackingSide: 'home',
    attackingSideAssumed: false,
    source: null,
    original: null,
    event: {
      type: 'progression',
      description: scenario.outcomes[selection.outcome].summary,
      startSeconds: 0,
      endSeconds: duration,
      matchClock: '',
      period: '',
      outcome: scenario.outcomes[selection.outcome].label,
      confidence: null,
      evidence: [],
      uncertainty: [scenario.caveat],
    },
    actors,
    keyframes,
    paths,
    annotations,
    notes: '',
  };

  // The line a chosen option ends with: what the geometry at the landing supports.
  if (option && selection.option) {
    const last = legs.filter((l): l is Extract<BallLeg, { kind: 'pass' }> => l.kind === 'pass' && l.t0 >= scenario.decisionT)[0];
    if (last) {
      const spec = scenario.options[selection.option].byOutcome?.[selection.outcome]?.verdict ?? scenario.options[selection.option].verdict;
      const text = describeOption({
        scenario,
        spec,
        style: last.style,
        flank: ctx.flank,
        atRelease: samplePositions(author, last.t0),
        atArrival: samplePositions(author, legEndT(last)),
        target: last.to,
        passer: last.from,
      });
      if (text) {
        author.annotations = [...author.annotations, { id: 'verdict', t: legEndT(last), label: text, point: null, eventType: null }];
      }
    }
  }

  const mapPoint = (p: ReplayPoint) => authorToCanonical(p, ctx);
  const replay: TacticalReplay = {
    ...author,
    attackingSide: ctx.side,
    keyframes: author.keyframes.map((k) => ({
      ...k,
      positions: Object.fromEntries(
        Object.entries(k.positions).map(([id, pos]) => {
          const c = mapPoint(pos);
          return [id, { ...pos, x: c.x, y: c.y }];
        }),
      ),
    })),
    paths: author.paths.map((p) => ({ ...p, from: mapPoint(p.from), to: mapPoint(p.to) })),
  };

  const firstPass = legs.find((l): l is Extract<BallLeg, { kind: 'pass' }> => l.kind === 'pass' && l.t0 >= scenario.decisionT);
  const stages = resolveStages(scenario, selection, duration, firstPass ? firstPass.t1 : null);
  const stepMarks = [...new Set(stages.filter((s) => s.available).map((s) => s.start).concat(duration))].sort((a, b) => a - b);
  const badges: Record<string, string> = {};
  for (const r of scenario.roles) {
    const text = r.number !== undefined ? String(byFlank(r.number, ctx.flank)) : r.badge !== undefined ? byFlank(r.badge, ctx.flank) : '';
    badges[r.id] = text;
  }

  return { scenario, selection, context: ctx, replay, author, duration, decisionT: scenario.decisionT, stages, badges, pathHold, stepMarks };
}

/** The stage that contains `t` (the decision stage once the pass has been chosen to be played). */
export function stageAt(build: ScenarioBuild, t: number): ResolvedStage {
  let current = build.stages[0];
  for (const s of build.stages) if (s.available && t >= s.start - 1e-9) current = s;
  return current;
}

/** Space highlights at `t`, in the canonical frame of `build.replay`. */
export function spacesAt(build: ScenarioBuild, t: number): SpaceHighlight[] {
  const positions = samplePositions(build.author, t);
  return evaluateSpaces(build.scenario, build.selection, positions, t).map((h) => ({
    ...h,
    points: h.points.map((p) => authorToCanonical(p, build.context)),
  }));
}

/**
 * Where to draw each highlight's label at `t`: inside its outline, away from
 * every player and the ball, in the canonical frame of `build.replay`.
 */
export function labelPositions(build: ScenarioBuild, t: number, highlights: readonly SpaceHighlight[]): Record<string, ReplayPoint> {
  const players = Object.values(samplePositions(build.replay, t));
  // Arrow captions are drawn at the middle of their arrow: keep space labels off them too.
  const captions = visibleReplayAt(build, t)
    .paths.filter((p) => p.note)
    .map((p) => ({ x: (p.from.x + p.to.x) / 2, y: (p.from.y + p.to.y) / 2 }));
  return placeLabels(highlights, [...players, ...captions]);
}

export interface MarkingSegment {
  id: string;
  from: ReplayPoint;
  to: ReplayPoint;
}

/** Marking lines at `t` between defender and attacker, canonical frame. */
export function markingAt(build: ScenarioBuild, t: number): MarkingSegment[] {
  const positions = samplePositions(build.author, t);
  return evaluateMarking(build.scenario, build.selection, positions, t).map((m) => ({
    id: m.id,
    from: authorToCanonical(positions[m.defenderId], build.context),
    to: authorToCanonical(positions[m.attackerId], build.context),
  }));
}

/** The replay as it should look at `t`: arrows that are not current any more are dropped. */
export function visibleReplayAt(build: ScenarioBuild, t: number): TacticalReplay {
  const paths = build.replay.paths.filter((p) => {
    const hold = build.pathHold[p.id] ?? DEFAULT_HOLD;
    // Strict at the end: a reaction arrow with no hold is gone by the moment it completes.
    return t >= p.startT && (hold > 0 ? t < p.endT + hold : t < p.endT);
  });
  return { ...build.replay, paths };
}
