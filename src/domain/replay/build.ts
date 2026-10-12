import type {
  Id,
  ReplayActor,
  ReplayAnalysis,
  ReplayAnnotation,
  ReplayEvent,
  ReplayKeyframe,
  ReplayPath,
  ReplayPathKind,
  ReplayPoint,
  ReplayPosition,
  ReplaySource,
  TacticalReplay,
  TeamSide,
} from '../types';
import { teamFrameToReplay } from './coords';
import { REPLAY_EVENT_LABELS } from './eventTypes';
import { IDENTITY_MIN_CONFIDENCE, KEYFRAME_EPSILON_SECONDS, MAX_TITLE } from './limits';

/**
 * Turns a validated analysis (positions in the ATTACKING team's frame,
 * timestamps in clip seconds) into an editable replay (canonical frame,
 * replay-relative seconds). Pure: ids and time are injected.
 */

export interface BuildContext {
  id: Id;
  newId: (prefix: string) => Id;
  /** ISO timestamp for createdAt/updatedAt. */
  now: string;
  source: ReplaySource | null;
  /** Which side the analysed attack belongs to, when known. Otherwise home is assumed and flagged. */
  attackingSide?: TeamSide;
  title?: string;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Clip timestamp → replay time. The replay starts at `originSeconds` of the clip and never runs backwards. */
export function mapClipTime(clipSeconds: number, originSeconds: number): number {
  if (!Number.isFinite(clipSeconds) || !Number.isFinite(originSeconds)) return 0;
  return round3(Math.max(0, clipSeconds - originSeconds));
}

const PATH_KIND: Record<ReplayAnalysis['trajectories'][number]['kind'], ReplayPathKind> = {
  pass: 'pass',
  lofted_pass: 'lofted',
  shot: 'shot',
  run: 'movement',
};

const OUTCOME_LABEL: Record<ReplayAnalysis['trajectories'][number]['outcome'], string> = {
  completed: 'completed',
  intercepted: 'intercepted',
  blocked: 'blocked',
  saved: 'saved',
  goal: 'goal',
  off_target: 'off target',
  unknown: '',
};

function defaultTitle(event: ReplayEvent): string {
  const base = REPLAY_EVENT_LABELS[event.type];
  const title = event.matchClock ? `${base} · ${event.matchClock}` : base;
  return title.slice(0, MAX_TITLE);
}

/** A replay with no analysis behind it, for annotating by hand. */
export function emptyReplay(ctx: Omit<BuildContext, 'source'>): TacticalReplay {
  const event: ReplayEvent = {
    type: 'other',
    description: '',
    startSeconds: 0,
    endSeconds: 6,
    matchClock: '',
    period: '',
    outcome: '',
    confidence: null,
    evidence: [],
    uncertainty: [],
  };
  return {
    id: ctx.id,
    title: ctx.title ?? 'New tactical replay',
    createdAt: ctx.now,
    updatedAt: ctx.now,
    origin: 'manual',
    tracking: null,
    attackingSide: ctx.attackingSide ?? 'home',
    attackingSideAssumed: ctx.attackingSide === undefined,
    source: null,
    original: null,
    event,
    actors: [{ id: ctx.newId('act'), kind: 'ball', side: null, label: 'Ball', shirtNumber: null, name: '', playerId: null, confidence: null, evidence: '' }],
    keyframes: [],
    paths: [],
    annotations: [],
    notes: '',
  };
}

export function replayFromAnalysis(analysis: ReplayAnalysis, ctx: BuildContext): TacticalReplay {
  const side: TeamSide = ctx.attackingSide ?? 'home';
  const opponent: TeamSide = side === 'home' ? 'away' : 'home';
  const primary = analysis.primaryEvent;

  const fallbackEnd = ctx.source?.durationSeconds ?? analysis.timeline.reduce((m, t) => Math.max(m, t.timeSeconds), 0);
  const event: ReplayEvent = primary
    ? {
        type: primary.type,
        description: primary.description,
        startSeconds: primary.startSeconds,
        endSeconds: Math.max(primary.endSeconds, primary.startSeconds),
        matchClock: primary.matchClock ?? '',
        period: primary.period ?? '',
        outcome: primary.outcome ?? '',
        confidence: primary.confidence,
        evidence: [...primary.evidence],
        uncertainty: [...primary.unknowns, ...analysis.warnings],
      }
    : {
        type: 'uncertain',
        description: analysis.summary,
        startSeconds: 0,
        endSeconds: Math.max(0, fallbackEnd),
        matchClock: '',
        period: '',
        outcome: '',
        confidence: null,
        evidence: [],
        uncertainty: ['No football event could be identified in this clip.', ...analysis.warnings],
      };
  const origin = event.startSeconds;
  const t = (clip: number) => mapClipTime(clip, origin);
  const place = (p: ReplayPoint): ReplayPoint => teamFrameToReplay(p, side);

  // Actors. A name or shirt number is kept only when the model was confident and gave evidence.
  const counters = { attacking: 0, defending: 0, unknown: 0 };
  const actorIds = new Map<string, Id>();
  const actors: ReplayActor[] = analysis.actors.map((a) => {
    const id = ctx.newId('act');
    actorIds.set(a.id, id);
    if (a.kind === 'ball') {
      return { id, kind: 'ball', side: null, label: 'Ball', shirtNumber: null, name: '', playerId: null, confidence: a.identityConfidence, evidence: '' };
    }
    counters[a.team] += 1;
    const labelBase = a.team === 'attacking' ? 'Attacker' : a.team === 'defending' ? 'Defender' : 'Player';
    const trusted = a.identityConfidence >= IDENTITY_MIN_CONFIDENCE && !!a.identityEvidence;
    return {
      id,
      kind: 'player',
      side: a.team === 'attacking' ? side : a.team === 'defending' ? opponent : null,
      label: `${labelBase} ${counters[a.team]}`,
      shirtNumber: trusted ? a.shirtNumber : null,
      name: trusted ? (a.name ?? '') : '',
      playerId: null,
      confidence: a.identityConfidence,
      evidence: a.identityEvidence ?? '',
    };
  });

  // Keyframes: merged when two land on the same replay time.
  const frames: ReplayKeyframe[] = [];
  for (const k of [...analysis.keyframes].sort((a, b) => a.timeSeconds - b.timeSeconds)) {
    const time = t(k.timeSeconds);
    const positions: Record<Id, ReplayPosition> = {};
    for (const p of k.positions) {
      const actorId = actorIds.get(p.actorId);
      if (!actorId) continue;
      const point = place({ x: p.x, y: p.y });
      positions[actorId] = { ...point, confidence: p.confidence, source: 'ai' };
    }
    if (Object.keys(positions).length === 0) continue;
    const last = frames[frames.length - 1];
    if (last && Math.abs(last.t - time) < KEYFRAME_EPSILON_SECONDS) {
      last.positions = { ...last.positions, ...positions };
    } else {
      frames.push({ id: ctx.newId('kf'), t: time, positions });
    }
  }

  const paths: ReplayPath[] = analysis.trajectories.map((tr) => {
    const startT = t(tr.startSeconds);
    return {
      id: ctx.newId('path'),
      kind: PATH_KIND[tr.kind],
      startT,
      endT: Math.max(startT, t(tr.endSeconds)),
      from: place(tr.from),
      to: place(tr.to),
      fromActorId: tr.actorId ? (actorIds.get(tr.actorId) ?? null) : null,
      toActorId: tr.targetActorId ? (actorIds.get(tr.targetActorId) ?? null) : null,
      note: OUTCOME_LABEL[tr.outcome],
      confidence: tr.confidence,
      source: 'ai',
    };
  });

  const annotations: ReplayAnnotation[] = [...analysis.timeline]
    .sort((a, b) => a.timeSeconds - b.timeSeconds)
    .map((m) => ({ id: ctx.newId('note'), t: t(m.timeSeconds), label: m.label, point: null, eventType: m.eventType }));

  const replay: TacticalReplay = {
    id: ctx.id,
    title: ctx.title ?? '',
    createdAt: ctx.now,
    updatedAt: ctx.now,
    origin: 'ai',
    tracking: null,
    attackingSide: side,
    attackingSideAssumed: ctx.attackingSide === undefined,
    source: ctx.source,
    original: analysis,
    event,
    actors,
    keyframes: frames,
    paths,
    annotations,
    notes: '',
  };
  return { ...replay, title: replay.title || defaultTitle(event) };
}
