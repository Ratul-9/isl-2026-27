import { clampPoint, fromTeamFrame, fromView, toView } from '../geometry';
import type { Orientation } from '../geometry';
import type { Point, ReplayPoint, TeamSide } from '../types';

/**
 * Replay coordinates are 0–100 per axis in the CANONICAL pitch frame (x along
 * the length from the left goal line, y across from the top touchline), i.e.
 * the app's normalised 0–1 frame × 100. Pure.
 */

const REPLAY_MAX = 100;

function clampReplayCoord(value: number): number {
  if (!Number.isFinite(value)) return REPLAY_MAX / 2;
  return Math.min(REPLAY_MAX, Math.max(0, value));
}

export function clampReplayPoint(p: ReplayPoint): ReplayPoint {
  return { x: clampReplayCoord(p.x), y: clampReplayCoord(p.y) };
}

/** Replay 0–100 → the app's normalised 0–1 canonical point. */
export function replayToCanonical(p: ReplayPoint): Point {
  const c = clampReplayPoint(p);
  return { x: c.x / REPLAY_MAX, y: c.y / REPLAY_MAX };
}

/** Stored positions are rounded to 1/1000 of a unit (≈ 1 mm of pitch), so conversions leave no float noise. */
const roundReplay = (n: number) => Math.round(n * 1000) / 1000;

export function canonicalToReplay(p: Point): ReplayPoint {
  const c = clampReplayPoint({ x: p.x * REPLAY_MAX, y: p.y * REPLAY_MAX });
  return { x: roundReplay(c.x), y: roundReplay(c.y) };
}

/**
 * A point in ONE team's attacking frame (x = 0 own goal line → 100 the goal it
 * attacks; y = 0 its own left touchline) → the canonical replay frame.
 */
export function teamFrameToReplay(p: ReplayPoint, side: TeamSide): ReplayPoint {
  return canonicalToReplay(fromTeamFrame(replayToCanonical(p), side));
}

/** Turns a point 180° about the pitch centre (switching which end a team attacks). */
export function rotateReplayPoint(p: ReplayPoint): ReplayPoint {
  const c = clampReplayPoint(p);
  return { x: REPLAY_MAX - c.x, y: REPLAY_MAX - c.y };
}

/** Replay point → SVG view units (metres) for the given orientation. */
export function replayToView(p: ReplayPoint, orientation: Orientation): Point {
  return toView(replayToCanonical(p), orientation);
}

/** SVG view units → replay point, clamped to the pitch. */
export function viewToReplay(v: Point, orientation: Orientation): ReplayPoint {
  return canonicalToReplay(clampPoint(fromView(v, orientation)));
}
