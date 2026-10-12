import type { ReplayAnalysis, ReplaySource, TacticalReplay } from '../types';
import { replayFromAnalysis } from './build';

/**
 * TEST FIXTURES ONLY. A hand-written plausible analysis of an imaginary clip
 * (a through pass and a shot), in the shape the AI service returns. It is
 * never used by the app and must not be presented as real AI output.
 * Positions are in the ATTACKING team's frame (x 0 = own goal line → 100).
 */
export function sampleAnalysis(): ReplayAnalysis {
  return {
    summary: 'A midfielder plays a through ball and the striker shoots; the keeper saves.',
    primaryEvent: {
      type: 'shotOnTarget',
      description: 'Through ball to the striker, who shoots low to the keeper’s left; saved.',
      startSeconds: 4,
      endSeconds: 10,
      matchClock: "67:12",
      period: 'second half',
      attackingTeam: 'team in blue',
      defendingTeam: 'team in white',
      outcome: 'saved',
      confidence: 0.7,
      evidence: ['Ball travels from the midfielder to the striker between 5.0s and 6.0s', 'Keeper dives at 9.0s'],
      unknowns: ['Shirt numbers not visible'],
    },
    otherEvents: [{ type: 'save', description: 'Keeper saves low to his left.', startSeconds: 9, endSeconds: 10, confidence: 0.6 }],
    actors: [
      { id: 'a1', kind: 'player', team: 'attacking', kit: 'blue', shirtNumber: 8, name: 'Number Eight', role: 'central midfielder', identityConfidence: 0.8, identityEvidence: 'Shirt 8 visible at 4.5s' },
      { id: 'a2', kind: 'player', team: 'attacking', kit: 'blue', shirtNumber: 9, name: 'Guess Name', role: 'striker', identityConfidence: 0.3, identityEvidence: null },
      { id: 'd1', kind: 'player', team: 'defending', kit: 'white', shirtNumber: null, name: null, role: 'centre back', identityConfidence: 0, identityEvidence: null },
      { id: 'gk', kind: 'player', team: 'defending', kit: 'green', shirtNumber: 1, name: null, role: 'goalkeeper', identityConfidence: 0.4, identityEvidence: 'Goalkeeper kit' },
      { id: 'ball', kind: 'ball', team: 'unknown', kit: null, shirtNumber: null, name: null, role: null, identityConfidence: 1, identityEvidence: null },
    ],
    keyframes: [
      {
        timeSeconds: 4,
        note: 'Midfielder in possession',
        positions: [
          { actorId: 'a1', x: 55, y: 50, confidence: 0.7, basis: 'observed' },
          { actorId: 'a2', x: 68, y: 40, confidence: 0.5, basis: 'estimated' },
          { actorId: 'd1', x: 74, y: 45, confidence: 0.5, basis: 'estimated' },
          { actorId: 'gk', x: 98, y: 50, confidence: 0.6, basis: 'observed' },
          { actorId: 'ball', x: 55, y: 50, confidence: 0.7, basis: 'observed' },
        ],
      },
      {
        timeSeconds: 6,
        note: 'Through ball received',
        positions: [
          { actorId: 'a2', x: 82, y: 46, confidence: 0.5, basis: 'estimated' },
          { actorId: 'd1', x: 78, y: 48, confidence: 0.4, basis: 'estimated' },
          { actorId: 'ball', x: 82, y: 46, confidence: 0.6, basis: 'estimated' },
        ],
      },
      {
        timeSeconds: 9,
        note: 'Shot saved',
        positions: [
          { actorId: 'gk', x: 97, y: 44, confidence: 0.5, basis: 'estimated' },
          { actorId: 'ball', x: 97, y: 44, confidence: 0.5, basis: 'estimated' },
        ],
      },
    ],
    trajectories: [
      { kind: 'pass', actorId: 'a1', targetActorId: 'a2', startSeconds: 5, endSeconds: 6, from: { x: 55, y: 50 }, to: { x: 82, y: 46 }, outcome: 'completed', confidence: 0.6 },
      { kind: 'shot', actorId: 'a2', targetActorId: null, startSeconds: 7.5, endSeconds: 9, from: { x: 82, y: 46 }, to: { x: 100, y: 44 }, outcome: 'saved', confidence: 0.6 },
    ],
    timeline: [
      { timeSeconds: 5, label: 'Through ball', eventType: 'pass' },
      { timeSeconds: 7.5, label: 'Shot', eventType: 'shotOnTarget' },
      { timeSeconds: 9, label: 'Save', eventType: 'save' },
    ],
    warnings: ['Camera angle makes depth hard to judge; positions are approximate.'],
  };
}

export const SAMPLE_SOURCE: ReplaySource = {
  fileName: 'clip.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 1_234_567,
  durationSeconds: 12,
  analysedAt: '2026-10-12T09:00:00.000Z',
  model: 'gemini-test',
  samplingFps: 5,
};

/** A deterministic id factory: `act-1`, `kf-2`, … */
export function counterIds(): (prefix: string) => string {
  let n = 0;
  return (prefix) => `${prefix}-${++n}`;
}

export function sampleReplay(overrides: Partial<Parameters<typeof replayFromAnalysis>[1]> = {}): TacticalReplay {
  return replayFromAnalysis(sampleAnalysis(), {
    id: 'rpl-1',
    newId: counterIds(),
    now: '2026-10-12T09:00:00.000Z',
    source: SAMPLE_SOURCE,
    attackingSide: 'home',
    ...overrides,
  });
}
