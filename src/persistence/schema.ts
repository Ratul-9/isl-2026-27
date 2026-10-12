import { z } from 'zod';
import { DRAWING_KINDS, MAX_NOTE_LENGTH, MAX_FREEHAND_POINTS } from '@/domain/drawings';
import { MARKER_LABELS, MAX_EVENT_TEXT } from '@/domain/events';
import { FORMATIONS } from '@/domain/formations';
import { SLOT_COUNT } from '@/domain/layout';
import {
  isValidDateString,
  isValidTimeString,
  MATCH_STATUSES,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
} from '@/domain/match';
import { POSITIONS } from '@/domain/positions';
import { REPLAY_EVENT_TYPES } from '@/domain/replay/eventTypes';
import { MAX_MANUAL_POINTS, MAX_TRACKING_FRAMES, MAX_TRACKS } from '@/domain/tracking/limits';
import {
  MAX_ACTORS,
  MAX_ANNOTATIONS,
  MAX_EVIDENCE_ITEMS,
  MAX_KEYFRAMES,
  MAX_LONG_TEXT as MAX_REPLAY_LONG_TEXT,
  MAX_PATHS,
  MAX_REPLAY_SECONDS,
  MAX_REPLAYS_PER_MATCH,
  MAX_TEXT as MAX_REPLAY_TEXT,
  MAX_TITLE as MAX_REPLAY_TITLE,
} from '@/domain/replay/limits';
import { MAX_NOTES_LENGTH, MAX_PLAYERS, MAX_POOL_PLAYERS, MAX_SHIRT_NUMBER, MAX_SUBSTITUTES, MIN_SHIRT_NUMBER } from '@/domain/squad';
import { PERIOD_ORDER, PLAYING_PERIODS } from '@/domain/time';
import type {
  FormationId,
  GoalType,
  Match,
  MatchStatus,
  PeriodMarker,
  PositionCode,
  Period,
  PlayingPeriod,
  DrawingKind,
  ReplayEventType,
  ReplayPathKind,
} from '@/domain/types';

/**
 * The single source of truth for what a stored or imported match may contain
 * (invariant 9). Unknown properties are stripped, so a file from a slightly
 * newer build still loads; structural problems are reported with their path.
 */

export const FORMAT_ID = 'dizpitch.match';
export const CURRENT_SCHEMA_VERSION = 5;

const MAX_EVENTS = 2000;
const MAX_DRAWINGS = 1000;
const MAX_SAVED_LAYOUTS = 100;
const MAX_TEXT = 200;
const MAX_LONG_TEXT = 2000;

/** `z.enum` needs a non-empty tuple; our option lists are static and non-empty. */
function enumOf<T extends string>(values: readonly T[]) {
  return z.enum(values as unknown as [T, ...T[]]);
}

const id = z.string().min(1).max(100);
const text = (max = MAX_TEXT) => z.string().max(max);
const unit = z.number().min(0).max(1);
const point = z.object({ x: unit, y: unit });
const position = enumOf<PositionCode>(POSITIONS.map((p) => p.code));
const formationId = enumOf<FormationId>(FORMATIONS.map((f) => f.id));
const period = enumOf<Period>(PERIOD_ORDER);
const playingPeriod = enumOf<PlayingPeriod>(PLAYING_PERIODS);
const drawingKind = enumOf<DrawingKind>(DRAWING_KINDS);
const goalType = enumOf<GoalType>(['normal', 'penalty', 'freeKick', 'header', 'ownGoal']);
const marker = enumOf<PeriodMarker>(Object.keys(MARKER_LABELS) as PeriodMarker[]);
const status = enumOf<MatchStatus>(MATCH_STATUSES.map((s) => s.value));

// --- team presets (schema version 4; jersey display fields added in 5) ------------------------------------------------------------
// Snapshots of a preset's data inside a match; every field is optional at the object level so that
// matches without presets are unchanged. Image URLs are bounded here and allow-listed when rendered.
const imageUrl = z.string().max(500).nullable();

const playerOrigin = z.object({
  presetId: id,
  season: text(20),
  imported: z.object({
    name: text(80),
    shirtNumber: z.number().int().min(MIN_SHIRT_NUMBER).max(MAX_SHIRT_NUMBER).nullable(),
    position,
  }),
  assignedNumber: z.number().int().min(MIN_SHIRT_NUMBER).max(MAX_SHIRT_NUMBER).optional(),
  sourcePosition: text(40).nullable(),
  nationality: text(60).nullable(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  photoUrl: imageUrl,
  profileUrl: z.string().max(500).nullable(),
});

const teamOrigin = z.object({
  presetId: id,
  league: text(40),
  season: text(20),
  snapshotAt: text(40),
  verifiedAt: text(40).nullable(),
  officialName: text(80),
  shortName: text(60).nullable(),
  abbreviation: text(12).nullable(),
  city: text(80).nullable(),
  logoUrl: imageUrl,
  profileUrl: z.string().max(500).nullable(),
  coach: z.object({ name: text(80), photoUrl: imageUrl }).nullable(),
});

const player = z.object({
  id,
  name: text(80),
  shirtNumber: z.number().int().min(MIN_SHIRT_NUMBER).max(MAX_SHIRT_NUMBER),
  preferredPosition: position,
  notes: text(MAX_NOTES_LENGTH),
  origin: playerOrigin.optional(),
});

const slot = z.object({
  id,
  playerId: id.nullable(),
  position,
  x: unit,
  y: unit,
});

const formationRef = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('preset'), id: formationId }),
  z.object({ kind: z.literal('saved'), id }),
]);

const team = z.object({
  id,
  name: text(60),
  coach: text(80),
  players: z.array(player).max(MAX_PLAYERS),
  slots: z.array(slot).length(SLOT_COUNT),
  bench: z.array(id).max(MAX_SUBSTITUTES),
  formation: formationRef,
  pool: z.array(player).max(MAX_POOL_PLAYERS).optional(),
  preset: teamOrigin.optional(),
  kit: enumOf<'home' | 'away'>(['home', 'away']).optional(),
});

const savedLayout = z.object({
  id,
  name: text(40).min(1),
  baseFormation: formationId,
  slots: z.array(z.object({ position, x: unit, y: unit })).length(SLOT_COUNT),
});

const drawing = z.object({
  id,
  kind: drawingKind,
  from: point,
  to: point,
  points: z.array(point).max(MAX_FREEHAND_POINTS).optional(),
  fromPlayerId: id.optional(),
  toPlayerId: id.optional(),
  note: text(MAX_NOTE_LENGTH).optional(),
  source: z.object({ patternId: text(60), teamId: id }).optional(),
});

const eventBase = { id, period, matchTimeMs: z.number().min(0).max(1e9) };
const event = z.discriminatedUnion('type', [
  z.object({
    ...eventBase,
    type: z.literal('goal'),
    teamId: id,
    scorerId: id.optional(),
    assistId: id.optional(),
    goalType,
    notes: text(MAX_LONG_TEXT).optional(),
  }),
  z.object({
    ...eventBase,
    type: z.literal('substitution'),
    teamId: id,
    outPlayerId: id,
    inPlayerId: id,
    reason: text().optional(),
  }),
  z.object({ ...eventBase, type: z.literal('yellowCard'), teamId: id, playerId: id, notes: text(MAX_LONG_TEXT).optional() }),
  z.object({ ...eventBase, type: z.literal('redCard'), teamId: id, playerId: id, notes: text(MAX_LONG_TEXT).optional() }),
  z.object({ ...eventBase, type: z.literal('note'), text: text(MAX_EVENT_TEXT), teamId: id.optional() }),
  z.object({ ...eventBase, type: z.literal('periodMarker'), marker }),
]);

const clock = z.object({
  period,
  elapsedMs: z.number().min(0).max(1e9),
  runningSinceEpochMs: z.number().min(0).nullable(),
  endedPeriod: playingPeriod.nullable(),
});

// --- tactical replays (schema version 2) ------------------------------------------------
const replayEventType = enumOf<ReplayEventType>(REPLAY_EVENT_TYPES);
const replayPathKind = enumOf<ReplayPathKind>(['pass', 'lofted', 'shot', 'movement']);
const side = enumOf<'home' | 'away'>(['home', 'away']);
const provenance = enumOf<'ai' | 'user'>(['ai', 'user']);
const replayCoord = z.number().min(0).max(100);
const replayPoint = z.object({ x: replayCoord, y: replayCoord });
const replaySeconds = z.number().min(0).max(MAX_REPLAY_SECONDS);
const replayText = (max = MAX_REPLAY_TEXT) => z.string().max(max);

const replayActor = z.object({
  id,
  kind: enumOf<'player' | 'ball'>(['player', 'ball']),
  side: side.nullable(),
  label: replayText(40),
  shirtNumber: z.number().int().min(0).max(999).nullable(),
  name: text(80),
  playerId: id.nullable(),
  confidence: unit.nullable(),
  evidence: replayText(),
});

const replayKeyframe = z.object({
  id,
  t: replaySeconds,
  positions: z.record(id, replayPoint.extend({ confidence: unit.nullable(), source: provenance })),
});

const replayPath = z.object({
  id,
  kind: replayPathKind,
  startT: replaySeconds,
  endT: replaySeconds,
  from: replayPoint,
  to: replayPoint,
  fromActorId: id.nullable(),
  toActorId: id.nullable(),
  note: replayText(60),
  confidence: unit.nullable(),
  source: provenance,
});

const replayAnnotation = z.object({
  id,
  t: replaySeconds,
  label: replayText(),
  point: replayPoint.nullable(),
  eventType: replayEventType.nullable(),
});

const clipSeconds = z.number().min(0).max(24 * 3600);
const analysisActorId = z.string().min(1).max(40);
const nullableText = (max = MAX_REPLAY_TEXT) => z.string().max(max).nullable();

/** The unedited AI analysis, stored for provenance (bounded; same shape the video service normalises to). */
const replayAnalysis = z.object({
  summary: replayText(MAX_REPLAY_LONG_TEXT),
  primaryEvent: z
    .object({
      type: replayEventType,
      description: replayText(MAX_REPLAY_LONG_TEXT),
      startSeconds: clipSeconds,
      endSeconds: clipSeconds,
      matchClock: nullableText(40),
      period: nullableText(40),
      attackingTeam: nullableText(),
      defendingTeam: nullableText(),
      outcome: nullableText(),
      confidence: unit,
      evidence: z.array(replayText()).max(MAX_EVIDENCE_ITEMS),
      unknowns: z.array(replayText()).max(MAX_EVIDENCE_ITEMS),
    })
    .nullable(),
  otherEvents: z
    .array(
      z.object({
        type: replayEventType,
        description: replayText(),
        startSeconds: clipSeconds,
        endSeconds: clipSeconds,
        confidence: unit,
      }),
    )
    .max(20),
  actors: z
    .array(
      z.object({
        id: analysisActorId,
        kind: enumOf<'player' | 'ball'>(['player', 'ball']),
        team: enumOf<'attacking' | 'defending' | 'unknown'>(['attacking', 'defending', 'unknown']),
        kit: nullableText(80),
        shirtNumber: z.number().int().min(0).max(999).nullable(),
        name: nullableText(80),
        role: nullableText(80),
        identityConfidence: unit,
        identityEvidence: nullableText(),
      }),
    )
    .max(MAX_ACTORS),
  keyframes: z
    .array(
      z.object({
        timeSeconds: clipSeconds,
        note: nullableText(),
        positions: z
          .array(
            z.object({
              actorId: analysisActorId,
              x: replayCoord,
              y: replayCoord,
              confidence: unit,
              basis: enumOf<'observed' | 'estimated'>(['observed', 'estimated']),
            }),
          )
          .max(MAX_ACTORS),
      }),
    )
    .max(MAX_KEYFRAMES),
  trajectories: z
    .array(
      z.object({
        kind: enumOf<'pass' | 'lofted_pass' | 'shot' | 'run'>(['pass', 'lofted_pass', 'shot', 'run']),
        actorId: analysisActorId.nullable(),
        targetActorId: analysisActorId.nullable(),
        startSeconds: clipSeconds,
        endSeconds: clipSeconds,
        from: replayPoint,
        to: replayPoint,
        outcome: enumOf<'completed' | 'intercepted' | 'blocked' | 'saved' | 'goal' | 'off_target' | 'unknown'>([
          'completed',
          'intercepted',
          'blocked',
          'saved',
          'goal',
          'off_target',
          'unknown',
        ]),
        confidence: unit,
      }),
    )
    .max(MAX_PATHS),
  timeline: z
    .array(z.object({ timeSeconds: clipSeconds, label: replayText(), eventType: replayEventType.nullable() }))
    .max(MAX_ANNOTATIONS),
  warnings: z.array(replayText()).max(20),
});

// --- computer-vision tracking (schema version 3) ------------------------------------------
const finite = z.number().finite();
const mat3 = z.array(finite).length(9);
const trackingFrames = <T extends z.ZodType>(item: T) => z.array(item).max(MAX_TRACKING_FRAMES);

const trackEdit = z.object({
  kind: enumOf<'position' | 'rejected'>(['position', 'rejected']),
  point: replayPoint.nullable(),
  at: z.string().max(40),
});

const trackingTrack = z.object({
  id: z.string().min(1).max(40),
  trackerId: z.number().int().min(0).nullable(),
  objectType: enumOf<'player' | 'goalkeeper' | 'referee' | 'ball'>(['player', 'goalkeeper', 'referee', 'ball']),
  team: enumOf<'A' | 'B' | 'unknown'>(['A', 'B', 'unknown']).nullable(),
  side: side.nullable(),
  playerId: id.nullable(),
  hidden: z.boolean(),
  mergedFrom: z.array(z.number().int().min(0)).max(200),
  obs: z.object({
    frame: trackingFrames(z.number().int().min(0)),
    bbox: trackingFrames(z.tuple([finite, finite, finite, finite])),
    foot: trackingFrames(z.tuple([finite, finite])),
    pitch: trackingFrames(replayPoint.nullable()),
    confidence: trackingFrames(unit.nullable()),
    source: trackingFrames(enumOf<'detected' | 'interpolated'>(['detected', 'interpolated'])),
  }),
  edits: z.record(z.string().regex(/^\d+$/), trackEdit),
});

const trackingData = z.object({
  schemaVersion: z.literal(1),
  source: z.object({ fileName: text(120), width: z.number().int().positive(), height: z.number().int().positive(), fps: z.number().positive(), durationS: z.number().min(0) }),
  segment: z.object({
    startMs: z.number().min(0),
    endMs: z.number().min(0),
    frameStride: z.number().int().positive(),
    processedFrames: z.number().int().min(0).max(MAX_TRACKING_FRAMES),
  }),
  frameTimesMs: trackingFrames(z.number().min(0)),
  calibration: z.object({
    status: enumOf<'calibrated' | 'partial' | 'unavailable'>(['calibrated', 'partial', 'unavailable']),
    method: replayText(),
    perFrame: z.object({
      source: trackingFrames(enumOf<'keypoints' | 'propagated' | 'manual' | 'none'>(['keypoints', 'propagated', 'manual', 'none'])),
      errorM: trackingFrames(z.number().min(0).nullable()),
      shot: trackingFrames(z.number().int().min(0)),
    }),
    homography: trackingFrames(mat3.nullable()),
    cameraMotion: trackingFrames(mat3),
    notes: z.array(replayText()).max(20),
    autoRejected: z.boolean(),
    manual: z.record(
      z.string().regex(/^\d+$/),
      z.object({
        referenceFrame: z.number().int().min(0),
        points: z
          .array(z.object({ image: z.tuple([finite, finite]), pitchM: z.tuple([finite, finite]), landmark: z.string().min(1).max(60) }))
          .min(4)
          .max(MAX_MANUAL_POINTS),
        errorM: z.number().min(0).nullable(),
      }),
    ),
  }),
  teams: z.object({
    clusters: z.array(z.object({ id: enumOf<'A' | 'B'>(['A', 'B']), colorHex: z.string().regex(/^#[0-9a-f]{6}$/i) })).max(2),
    sideOf: z.object({ A: side.nullable(), B: side.nullable() }),
  }),
  tracks: z.array(trackingTrack).max(MAX_TRACKS),
  models: z.array(z.object({ role: text(40), name: replayText(), licence: replayText() })).max(10),
  device: text(20),
  warnings: z.array(replayText(MAX_REPLAY_LONG_TEXT)).max(30),
});

const replay = z.object({
  id,
  title: z.string().max(MAX_REPLAY_TITLE),
  createdAt: z.string().max(40),
  updatedAt: z.string().max(40),
  origin: enumOf<'ai' | 'manual' | 'tracking'>(['ai', 'manual', 'tracking']),
  tracking: trackingData.nullable(),
  attackingSide: side,
  attackingSideAssumed: z.boolean(),
  source: z
    .object({
      fileName: text(120),
      mimeType: text(80),
      sizeBytes: z.number().int().min(0),
      durationSeconds: z.number().min(0).nullable(),
      analysedAt: z.string().max(40),
      model: text(80),
      samplingFps: z.number().min(0).max(24).nullable(),
    })
    .nullable(),
  original: replayAnalysis.nullable(),
  event: z.object({
    type: replayEventType,
    description: replayText(MAX_REPLAY_LONG_TEXT),
    startSeconds: replaySeconds,
    endSeconds: replaySeconds,
    matchClock: replayText(40),
    period: replayText(40),
    outcome: replayText(),
    confidence: unit.nullable(),
    evidence: z.array(replayText()).max(MAX_EVIDENCE_ITEMS),
    uncertainty: z.array(replayText()).max(MAX_EVIDENCE_ITEMS + 20),
  }),
  actors: z.array(replayActor).max(MAX_ACTORS),
  keyframes: z.array(replayKeyframe).max(MAX_KEYFRAMES),
  paths: z.array(replayPath).max(MAX_PATHS),
  annotations: z.array(replayAnnotation).max(MAX_ANNOTATIONS),
  notes: replayText(MAX_REPLAY_LONG_TEXT),
});

const date = z.string().refine((v) => v === '' || isValidDateString(v), 'Expected a date as YYYY-MM-DD (or empty)');
const time = z.string().refine((v) => v === '' || isValidTimeString(v), 'Expected a 24-hour time as HH:mm (or empty)');

export const matchSchema = z.object({
  id,
  name: text(80),
  competition: text(80),
  date,
  kickoffTime: time,
  venue: text(80),
  durationMinutes: z.number().int().min(MIN_DURATION_MINUTES).max(MAX_DURATION_MINUTES),
  notes: text(MAX_LONG_TEXT),
  status,
  officials: z.object({
    referee: text(80),
    assistant1: text(80),
    assistant2: text(80),
    fourthOfficial: text(80),
  }),
  home: team,
  away: team,
  drawings: z.array(drawing).max(MAX_DRAWINGS),
  savedLayouts: z.array(savedLayout).max(MAX_SAVED_LAYOUTS),
  events: z.array(event).max(MAX_EVENTS),
  clock,
  replays: z.array(replay).max(MAX_REPLAYS_PER_MATCH),
  playerDisplay: enumOf<'circles' | 'jerseys'>(['circles', 'jerseys']).optional(),
});

/** Compile-time proof that the schema output is exactly the domain `Match`. */
export function asMatch(parsed: z.infer<typeof matchSchema>): Match {
  return parsed satisfies Match;
}
