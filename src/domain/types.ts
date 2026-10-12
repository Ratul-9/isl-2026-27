/**
 * Core entity types.
 *
 * Phase 1: match setup. Phase 2: slot coordinates, formations, saved layouts,
 * pattern-generated drawings. Later phases add drawing tools (3), events +
 * clock (4) and a schema version (6).
 */

export type Id = string;

export type TeamSide = 'home' | 'away';

/** Normalised pitch point in the canonical frame (see `geometry.ts`). */
export interface Point {
  x: number;
  y: number;
}

export type FormationId =
  | '4-3-3'
  | '4-2-3-1'
  | '4-4-2'
  | '4-1-4-1'
  | '4-3-2-1'
  | '3-5-2'
  | '3-4-3'
  | '3-4-2-1'
  | '5-3-2'
  | '5-4-1';

/** The layout a team's slots were last arranged from. */
export type FormationRef = { kind: 'preset'; id: FormationId } | { kind: 'saved'; id: Id };

export type PositionCode =
  | 'GK'
  | 'LB'
  | 'LCB'
  | 'CB'
  | 'RCB'
  | 'RB'
  | 'LWB'
  | 'RWB'
  | 'CDM'
  | 'LCM'
  | 'CM'
  | 'RCM'
  | 'LM'
  | 'RM'
  | 'CAM'
  | 'LW'
  | 'RW'
  | 'CF'
  | 'ST';

/** Where a player currently sits in the matchday squad. */
export type LineupRole = 'starter' | 'substitute';

export type MatchStatus =
  | 'scheduled'
  | 'inProgress'
  | 'completed'
  | 'postponed'
  | 'abandoned';

export interface Player {
  id: Id;
  name: string;
  shirtNumber: number;
  preferredPosition: PositionCode;
  notes: string;
  /** Present only for players copied from a team preset (see `PlayerOrigin`); absent = entered by hand. */
  origin?: PlayerOrigin;
}

/**
 * What a preset player looked like when a match was created from the preset. It is a snapshot
 * (invariant 45): updating the preset never changes it, and it keeps the imported values so
 * later manual corrections stay distinguishable from imported data.
 */
export interface PlayerOrigin {
  /** Id of the `PlayerPreset` this was copied from (stable across seasons and clubs). */
  presetId: string;
  season: string;
  /** Values as imported. `shirtNumber` is null when the source gave no usable number (a temporary one was assigned). */
  imported: { name: string; shirtNumber: number | null; position: PositionCode };
  /**
   * The temporary shirt number the snapshot gave this player because the source had none. While `shirtNumber` still
   * equals it, the number is unknown (jerseys show no number). Absent in matches created before schema v5.
   */
  assignedNumber?: number;
  /** Position as the source states it ("Defender"); `imported.position` is only the nearest DizPitch code. */
  sourcePosition: string | null;
  nationality: string | null;
  /** ISO `YYYY-MM-DD`. */
  dateOfBirth: string | null;
  /** Official image URL, referenced (never downloaded or stored). */
  photoUrl: string | null;
  profileUrl: string | null;
}

/**
 * One of a team's 11 starting-XI slots. The slot owns the pitch position; a
 * player occupies it (or `playerId` is null while unfilled). Coordinates are
 * absolute canonical-frame values.
 */
export interface LineupSlot {
  id: Id;
  playerId: Id | null;
  /** Position played in this lineup; set by the formation, manually overridable. */
  position: PositionCode;
  x: number;
  y: number;
}

export interface Team {
  id: Id;
  name: string;
  /** Coach or manager's full name. */
  coach: string;
  /** Registered squad, at most MAX_PLAYERS. */
  players: Player[];
  /** Exactly SLOT_COUNT (11) slots; filled slots are the starting XI. */
  slots: LineupSlot[];
  formation: FormationRef;
  /** Substitutes in bench order, at most MAX_SUBSTITUTES. */
  bench: Id[];
  /**
   * Registered players who are not (yet) in the matchday squad above, e.g. the rest of a club's
   * full squad. Invisible to the board and to events until moved into `players`. Absent = none.
   */
  pool?: Player[];
  /** Present when the team was created from a team preset: a snapshot of the preset's team data. */
  preset?: TeamOrigin;
  /** Which kit this side wears in jersey display. Absent = automatic (home kit, away kit on a colour clash). */
  kit?: 'home' | 'away';
}

/** Snapshot of the preset team a match team was created from (name/coach stay freely editable). */
export interface TeamOrigin {
  presetId: string;
  league: string;
  season: string;
  /** ISO time the snapshot was taken. */
  snapshotAt: string;
  /** ISO time the preset's data was last verified against its source, when known. */
  verifiedAt: string | null;
  officialName: string;
  shortName: string | null;
  abbreviation: string | null;
  city: string | null;
  logoUrl: string | null;
  profileUrl: string | null;
  /** The head coach as imported (the editable `Team.coach` may differ). */
  coach: { name: string; photoUrl: string | null } | null;
}

export interface Officials {
  referee: string;
  assistant1: string;
  assistant2: string;
  fourthOfficial: string;
}

export interface MatchInfo {
  /** Optional display name; falls back to "Home vs Away". */
  name: string;
  competition: string;
  /** ISO calendar date `YYYY-MM-DD`, or empty when not set. */
  date: string;
  /** 24h `HH:mm`, or empty when not set. */
  kickoffTime: string;
  venue: string;
  durationMinutes: number;
  notes: string;
  status: MatchStatus;
}

/** A position in a layout template, in the team frame. */
export interface TemplateSlot {
  position: PositionCode;
  x: number;
  y: number;
}

/** A user-saved custom arrangement, reusable by either team. */
export interface SavedLayout {
  id: Id;
  name: string;
  /** Preset this arrangement started from; used if the layout is deleted. */
  baseFormation: FormationId;
  slots: TemplateSlot[];
}

/**
 * pass = yellow arrow, lofted = yellow curved arrow labelled "LD", shot = red
 * arrow, movement = dashed arrow (off-ball run), freehand = annotation line.
 */
export type DrawingKind = 'pass' | 'lofted' | 'shot' | 'movement' | 'freehand';

/**
 * A tactical drawing. Coordinates are canonical and independent of player
 * positions; player ids are hints only (arrows do not follow players).
 */
export interface Drawing {
  id: Id;
  kind: DrawingKind;
  from: Point;
  to: Point;
  /** Freehand only: the sampled path (from/to equal its first/last point). */
  points?: Point[];
  fromPlayerId?: Id;
  toPlayerId?: Id;
  /** Optional short annotation shown beside the drawing. */
  note?: string;
  /** Set when generated by a tactical pattern, so re-applying can replace it. */
  source?: { patternId: string; teamId: Id };
}

// --- Match clock and events (Phase 4) ---------------------------------------

/** Match phases in chronological order. Halves and extra-time halves are "playing" periods. */
export type Period =
  | 'notStarted'
  | 'firstHalf'
  | 'halfTime'
  | 'secondHalf'
  | 'extraTimeFirstHalf'
  | 'extraTimeSecondHalf'
  | 'fullTime';

export type PlayingPeriod = 'firstHalf' | 'secondHalf' | 'extraTimeFirstHalf' | 'extraTimeSecondHalf';

/**
 * Persisted clock. While running, elapsed = elapsedMs + (now − runningSinceEpochMs);
 * the UI never accumulates ticks. During a break, `elapsedMs` holds the final
 * elapsed time of `endedPeriod`.
 */
export interface ClockState {
  period: Period;
  /** Elapsed time within the current (or just-ended) playing period, at the last start/pause. */
  elapsedMs: number;
  runningSinceEpochMs: number | null;
  /** The playing period that most recently ended (for HT/FT read-outs). */
  endedPeriod: PlayingPeriod | null;
}

export type GoalType = 'normal' | 'penalty' | 'freeKick' | 'header' | 'ownGoal';

export type PeriodMarker =
  | 'kickoff'
  | 'halfTime'
  | 'secondHalfKickoff'
  | 'endOfNormalTime'
  | 'extraTimeKickoff'
  | 'extraTimeHalfTime'
  | 'extraTimeSecondHalfKickoff'
  | 'fullTime';

interface EventBase {
  id: Id;
  period: Period;
  /**
   * Match time in ms on the continuous scale (second half starts at the half
   * length, etc.). Stoppage time continues past the period's nominal end, so
   * order by (period, matchTimeMs), never by matchTimeMs alone.
   */
  matchTimeMs: number;
}

export type MatchEvent = EventBase &
  (
    | {
        type: 'goal';
        /** Team CREDITED with the goal. For an own goal this is the opponent of the scorer's team. */
        teamId: Id;
        /** For an own goal, the responsible player from the other squad. Optional otherwise. */
        scorerId?: Id;
        assistId?: Id;
        goalType: GoalType;
        notes?: string;
      }
    | { type: 'substitution'; teamId: Id; outPlayerId: Id; inPlayerId: Id; reason?: string }
    | { type: 'yellowCard' | 'redCard'; teamId: Id; playerId: Id; notes?: string }
    | { type: 'note'; text: string; teamId?: Id }
    | { type: 'periodMarker'; marker: PeriodMarker }
  );

export type MatchEventType = MatchEvent['type'];

// --- Tactical replays ----------------------------------------------------------------
//
// An explanatory reconstruction of one short event, built from an AI analysis of a video
// clip (or annotated by hand). Positions are ESTIMATES in the canonical pitch frame, scaled
// 0–100 (x along the length from the left goal line, y across from the top touchline). They
// are never tracking data. Stored with the match; the source video is not.

export type ReplayEventType =
  | 'kickoff'
  | 'restart'
  | 'pass'
  | 'progression'
  | 'shot'
  | 'shotOnTarget'
  | 'goal'
  | 'save'
  | 'corner'
  | 'freeKick'
  | 'throwIn'
  | 'foul'
  | 'penalty'
  | 'offside'
  | 'tackle'
  | 'interception'
  | 'yellowCard'
  | 'redCard'
  | 'substitution'
  | 'other'
  | 'uncertain';

/** Paths reuse the arrow kinds (and styles) of tactical drawings. */
export type ReplayPathKind = Exclude<DrawingKind, 'freehand'>;

export interface ReplayPoint {
  /** 0–100 along the pitch length (canonical frame). */
  x: number;
  /** 0–100 across the pitch (canonical frame). */
  y: number;
}

export type ReplaySourceKind = 'ai' | 'user';

export interface ReplayPosition extends ReplayPoint {
  /** 0–1, or null when unknown. */
  confidence: number | null;
  source: ReplaySourceKind;
}

export interface ReplayActor {
  /** Unique within the replay. */
  id: Id;
  kind: 'player' | 'ball';
  /** Which team the actor belongs to, or null when that could not be determined. */
  side: TeamSide | null;
  /** Short label shown on the pitch when no name/number is known (e.g. "Attacker 2"). */
  label: string;
  shirtNumber: number | null;
  /** Empty when unidentified. Never guessed. */
  name: string;
  /** Optional link to a squad player of `side`; a hint, may dangle. */
  playerId: Id | null;
  confidence: number | null;
  evidence: string;
}

export interface ReplayKeyframe {
  id: Id;
  /** Seconds from the start of the replay. */
  t: number;
  /** Actors without an entry hold their previous/next known position. */
  positions: Record<Id, ReplayPosition>;
}

export interface ReplayPath {
  id: Id;
  kind: ReplayPathKind;
  startT: number;
  endT: number;
  from: ReplayPoint;
  to: ReplayPoint;
  /** When set, the end follows that actor (at startT / endT) instead of the fixed point. */
  fromActorId: Id | null;
  toActorId: Id | null;
  note: string;
  confidence: number | null;
  source: ReplaySourceKind;
}

export interface ReplayAnnotation {
  id: Id;
  t: number;
  label: string;
  /** Optional pin on the pitch. */
  point: ReplayPoint | null;
  eventType: ReplayEventType | null;
}

export interface ReplayEvent {
  type: ReplayEventType;
  description: string;
  /** Where the event sits in the source clip, in seconds. The replay starts at `startSeconds`. */
  startSeconds: number;
  endSeconds: number;
  /** Visible match clock / period, only when it was read from the footage. */
  matchClock: string;
  period: string;
  outcome: string;
  confidence: number | null;
  evidence: string[];
  /** What could not be determined. */
  uncertainty: string[];
}

export interface ReplaySource {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  /** ISO time of the analysis. */
  analysedAt: string;
  model: string;
  /** Frame rate the model was asked to sample at. */
  samplingFps: number | null;
}

/** The AI's answer as validated and bounded, kept verbatim for provenance (`original`). */
export interface ReplayAnalysis {
  summary: string;
  primaryEvent: {
    type: ReplayEventType;
    description: string;
    startSeconds: number;
    endSeconds: number;
    matchClock: string | null;
    period: string | null;
    attackingTeam: string | null;
    defendingTeam: string | null;
    outcome: string | null;
    confidence: number;
    evidence: string[];
    unknowns: string[];
  } | null;
  otherEvents: { type: ReplayEventType; description: string; startSeconds: number; endSeconds: number; confidence: number }[];
  actors: {
    id: string;
    kind: 'player' | 'ball';
    team: 'attacking' | 'defending' | 'unknown';
    kit: string | null;
    shirtNumber: number | null;
    name: string | null;
    role: string | null;
    identityConfidence: number;
    identityEvidence: string | null;
  }[];
  keyframes: {
    timeSeconds: number;
    note: string | null;
    positions: { actorId: string; x: number; y: number; confidence: number; basis: 'observed' | 'estimated' }[];
  }[];
  trajectories: {
    kind: 'pass' | 'lofted_pass' | 'shot' | 'run';
    actorId: string | null;
    targetActorId: string | null;
    startSeconds: number;
    endSeconds: number;
    from: ReplayPoint;
    to: ReplayPoint;
    outcome: 'completed' | 'intercepted' | 'blocked' | 'saved' | 'goal' | 'off_target' | 'unknown';
    confidence: number;
  }[];
  timeline: { timeSeconds: number; label: string; eventType: ReplayEventType | null }[];
  warnings: string[];
}

// --- Computer-vision tracking (cv-service) ------------------------------------------------
//
// Tracks from a detector + tracker run on a broadcast clip, stored compactly per track as observation columns.
// Image coordinates (bbox/foot, source pixels) are kept separately from pitch coordinates (DizPitch 0-100).
// User corrections are SPARSE edits over the detections, so detected / interpolated / manual data stay distinct.

type TrackObjectType = 'player' | 'goalkeeper' | 'referee' | 'ball';
export type TeamClusterId = 'A' | 'B';
type ObservationSource = 'detected' | 'interpolated';
type CalibrationFrameSource = 'keypoints' | 'propagated' | 'manual' | 'none';

interface TrackEdit {
  /** A user-placed pitch position (0-100) at this frame, or a rejection of the observation there. */
  kind: 'position' | 'rejected';
  point: ReplayPoint | null;
  /** ISO time of the edit. */
  at: string;
}

export interface TrackingTrack {
  /** Unique within the analysis ("t12", "ball"). */
  id: string;
  /** The tracker's id. NOT a shirt number. Null for the ball. */
  trackerId: number | null;
  objectType: TrackObjectType;
  /** Colour cluster from the service; null for referees and the ball. */
  team: TeamClusterId | 'unknown' | null;
  /** User override of the side; null = follow the cluster mapping. */
  side: TeamSide | null;
  /** Optional link to a squad player of the track's side (user-made; never automatic). */
  playerId: Id | null;
  hidden: boolean;
  /** Tracker ids joined into this track (automatic stitching or user merges). */
  mergedFrom: number[];
  obs: {
    frame: number[];
    bbox: [number, number, number, number][];
    foot: [number, number][];
    /** Pitch position from the AUTOMATIC calibration (0-100), or null. */
    pitch: (ReplayPoint | null)[];
    confidence: (number | null)[];
    source: ObservationSource[];
  };
  /** Frame index (as a string key) -> correction. */
  edits: Record<string, TrackEdit>;
}

export interface ManualCalibration {
  /** Frame the landmarks were clicked on. Applies to that frame's shot via the camera motion. */
  referenceFrame: number;
  points: { image: [number, number]; pitchM: [number, number]; landmark: string }[];
  /** Median leave-one-out error in metres (5+ points), else null. */
  errorM: number | null;
}

export interface TrackingData {
  schemaVersion: 1;
  source: { fileName: string; width: number; height: number; fps: number; durationS: number };
  segment: { startMs: number; endMs: number; frameStride: number; processedFrames: number };
  /** Milliseconds from the segment start, per processed frame. */
  frameTimesMs: number[];
  calibration: {
    status: 'calibrated' | 'partial' | 'unavailable';
    method: string;
    perFrame: { source: CalibrationFrameSource[]; errorM: (number | null)[]; shot: number[] };
    /** Row-major 3x3 image -> pitch METRES (105 x 68 template), automatic; null when uncalibrated. */
    homography: (number[] | null)[];
    /** Row-major 3x3 frame -> first frame of the shot (camera-motion compensation). */
    cameraMotion: number[][];
    notes: string[];
    /** The user rejected the automatic calibration (its pitch positions are not used). */
    autoRejected: boolean;
    /** Manual calibrations by shot index (as a string key). */
    manual: Record<string, ManualCalibration>;
  };
  teams: { clusters: { id: TeamClusterId; colorHex: string }[]; sideOf: Record<TeamClusterId, TeamSide | null> };
  tracks: TrackingTrack[];
  models: { role: string; name: string; licence: string }[];
  device: string;
  warnings: string[];
}

export interface TacticalReplay {
  id: Id;
  title: string;
  createdAt: string;
  updatedAt: string;
  origin: 'ai' | 'manual' | 'tracking';
  /** Computer-vision tracking data; only for origin 'tracking' (actors/keyframes are then unused). */
  tracking: TrackingData | null;
  /** Positions are stored in the canonical frame; this records which side the analysed attack belongs to. */
  attackingSide: TeamSide;
  /** True while the attacking team was not identified and `attackingSide` is only a default. */
  attackingSideAssumed: boolean;
  source: ReplaySource | null;
  /** The unedited AI analysis, or null for a manual replay. */
  original: ReplayAnalysis | null;
  event: ReplayEvent;
  actors: ReplayActor[];
  keyframes: ReplayKeyframe[];
  paths: ReplayPath[];
  annotations: ReplayAnnotation[];
  notes: string;
}

export interface Match extends MatchInfo {
  id: Id;
  officials: Officials;
  home: Team;
  away: Team;
  drawings: Drawing[];
  savedLayouts: SavedLayout[];
  /** Insertion order is the tie-breaker for events at the same period and time. */
  events: MatchEvent[];
  clock: ClockState;
  /** Saved tactical replays; independent of the board, events and squads. */
  replays: TacticalReplay[];
  /** How players are drawn on the pitch. Absent = circles. Jerseys only apply to teams created from a preset. */
  playerDisplay?: 'circles' | 'jerseys';
}
