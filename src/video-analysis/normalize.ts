import { isReplayEventType } from '@/domain/replay/eventTypes';
import {
  MAX_ACTORS,
  MAX_ANNOTATIONS,
  MAX_EVIDENCE_ITEMS,
  MAX_KEYFRAMES,
  MAX_LONG_TEXT,
  MAX_PATHS,
  MAX_TEXT,
} from '@/domain/replay/limits';
import type { ReplayAnalysis, ReplayEventType } from '@/domain/types';
import type { VideoAnalysisWire } from './schema';

/**
 * Turns the model's structurally-valid answer into a bounded, internally
 * consistent analysis. It clamps and drops, never invents: anything changed is
 * reported in `warnings` so the user can see the answer was not taken at face value.
 */

const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);
const unit = (n: number) => clamp(n, 0, 1);
const coord = (n: number) => clamp(n, 0, 100);
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const text = (s: string, max = MAX_TEXT) => s.trim().slice(0, max);
const optText = (s: string | null, max = MAX_TEXT) => (s === null ? null : text(s, max) || null);
const shirt = (n: number | null) => (n === null || !Number.isFinite(n) ? null : Math.round(n) >= 0 && Math.round(n) <= 999 ? Math.round(n) : null);
const eventType = (t: string): ReplayEventType => (isReplayEventType(t) ? t : 'uncertain');

export function normalizeAnalysis(raw: VideoAnalysisWire, opts: { durationSeconds: number | null }): ReplayAnalysis {
  const warnings: string[] = raw.warnings.map((w) => text(w)).filter(Boolean).slice(0, 12);
  const note = (message: string) => {
    if (!warnings.includes(message)) warnings.push(message);
  };
  const maxT = opts.durationSeconds ?? Number.POSITIVE_INFINITY;
  let clamped = 0;
  const time = (s: number) => {
    const t = round3(clamp(s, 0, maxT));
    if (t !== round3(s)) clamped += 1;
    return t;
  };
  const point = (x: number, y: number) => {
    const p = { x: round3(coord(x)), y: round3(coord(y)) };
    if (p.x !== round3(x) || p.y !== round3(y)) clamped += 1;
    return p;
  };

  // Actors: unique ids, bounded.
  const seen = new Set<string>();
  const actors: ReplayAnalysis['actors'] = [];
  for (const a of raw.actors) {
    const id = a.id.trim().slice(0, 40);
    if (!id || seen.has(id)) {
      note('An actor with a missing or repeated id was ignored.');
      continue;
    }
    if (actors.length >= MAX_ACTORS) {
      note(`Only the first ${MAX_ACTORS} players were kept.`);
      break;
    }
    seen.add(id);
    actors.push({
      id,
      kind: a.kind,
      team: a.kind === 'ball' ? 'unknown' : a.team,
      kit: optText(a.kit, 80),
      shirtNumber: shirt(a.shirtNumber),
      name: optText(a.name, 80),
      role: optText(a.role, 80),
      identityConfidence: unit(a.identityConfidence),
      identityEvidence: optText(a.identityEvidence),
    });
  }
  if (actors.filter((a) => a.kind === 'ball').length > 1) {
    note('The model reported more than one ball; only the first was kept.');
    const firstBall = actors.findIndex((a) => a.kind === 'ball');
    for (let i = actors.length - 1; i >= 0; i--) if (actors[i].kind === 'ball' && i !== firstBall) actors.splice(i, 1);
  }
  const known = new Set(actors.map((a) => a.id));

  // Keyframes: known actors only, time order, bounded.
  let droppedPositions = 0;
  const keyframes: ReplayAnalysis['keyframes'] = [];
  for (const k of [...raw.keyframes].sort((a, b) => a.timeSeconds - b.timeSeconds)) {
    const positions = k.positions.flatMap((p) => {
      if (!known.has(p.actorId)) {
        droppedPositions += 1;
        return [];
      }
      return [{ actorId: p.actorId, ...point(p.x, p.y), confidence: unit(p.confidence), basis: p.basis }];
    });
    if (positions.length === 0) continue;
    if (keyframes.length >= MAX_KEYFRAMES) {
      note(`Only the first ${MAX_KEYFRAMES} keyframes were kept.`);
      break;
    }
    keyframes.push({ timeSeconds: time(k.timeSeconds), note: optText(k.note), positions });
  }
  if (droppedPositions > 0) note(`${droppedPositions} position${droppedPositions === 1 ? '' : 's'} referred to players the model never listed and were dropped.`);

  const trajectories: ReplayAnalysis['trajectories'] = raw.trajectories.slice(0, MAX_PATHS).map((t) => {
    const startSeconds = time(t.startSeconds);
    return {
      kind: t.kind,
      actorId: t.actorId !== null && known.has(t.actorId) ? t.actorId : null,
      targetActorId: t.targetActorId !== null && known.has(t.targetActorId) ? t.targetActorId : null,
      startSeconds,
      endSeconds: Math.max(startSeconds, time(t.endSeconds)),
      from: point(t.from.x, t.from.y),
      to: point(t.to.x, t.to.y),
      outcome: t.outcome,
      confidence: unit(t.confidence),
    };
  });
  if (raw.trajectories.length > MAX_PATHS) note(`Only the first ${MAX_PATHS} trajectories were kept.`);

  const primary = raw.primaryEvent;
  const primaryEvent: ReplayAnalysis['primaryEvent'] = primary
    ? (() => {
        const startSeconds = time(primary.startSeconds);
        return {
          type: eventType(primary.type),
          description: text(primary.description, MAX_LONG_TEXT),
          startSeconds,
          endSeconds: Math.max(startSeconds, time(primary.endSeconds)),
          matchClock: optText(primary.matchClock, 40),
          period: optText(primary.period, 40),
          attackingTeam: optText(primary.attackingTeam),
          defendingTeam: optText(primary.defendingTeam),
          outcome: optText(primary.outcome),
          confidence: unit(primary.confidence),
          evidence: primary.evidence.map((e) => text(e)).filter(Boolean).slice(0, MAX_EVIDENCE_ITEMS),
          unknowns: primary.unknowns.map((e) => text(e)).filter(Boolean).slice(0, MAX_EVIDENCE_ITEMS),
        };
      })()
    : null;

  const otherEvents: ReplayAnalysis['otherEvents'] = raw.otherEvents.slice(0, 20).map((e) => {
    const startSeconds = time(e.startSeconds);
    return {
      type: eventType(e.type),
      description: text(e.description),
      startSeconds,
      endSeconds: Math.max(startSeconds, time(e.endSeconds)),
      confidence: unit(e.confidence),
    };
  });
  const timeline: ReplayAnalysis['timeline'] = raw.timeline.slice(0, MAX_ANNOTATIONS).map((m) => ({
    timeSeconds: time(m.timeSeconds),
    label: text(m.label),
    eventType: m.eventType === null ? null : eventType(m.eventType),
  }));

  if (primaryEvent && keyframes.length === 0) note('The model described an event but gave no positions; add players and positions in the editor.');
  if (clamped > 0) note(`${clamped} time or position value${clamped === 1 ? '' : 's'} were outside the clip or pitch and were clamped.`);

  return {
    summary: text(raw.summary, MAX_LONG_TEXT),
    primaryEvent,
    otherEvents,
    actors,
    keyframes,
    trajectories,
    timeline,
    warnings: warnings.slice(0, 20),
  };
}
