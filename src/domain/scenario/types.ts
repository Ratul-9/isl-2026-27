/**
 * Structured tactic scenarios: a staged, branching, animated version of a
 * tactical pattern. A scenario is plain data (plus the rule vocabulary in
 * `spaces.ts`); `build.ts` compiles it into an ordinary `TacticalReplay` so the
 * existing replay engine (interpolation, clock, pitch, controls) plays it.
 *
 * Everything is authored in the ATTACKING team's frame on the LEFT flank:
 * x 0 = own goal line → 100 = the goal it attacks, y 0 = its own left
 * touchline, both in the replay's 0–100 units (×1.05 m along, ×0.68 m across).
 * Mirroring to the right flank and rotating to the attacking side happen once,
 * in `build.ts`.
 */

export type Flank = 'left' | 'right';
/** Ids are chosen by each scenario ('A'/'B', 'cross', 'switch', …); their order in the records is the display order. */
export type OutcomeId = string;
export type OptionId = string;
type ScenarioTeam = 'attack' | 'defence';

/** [t seconds, x, y]. */
export type Waypoint = readonly [t: number, x: number, y: number];
/** [x, y]. */
export type Pt = readonly [x: number, y: number];

export type ByFlank<T> = T | Readonly<Record<Flank, T>>;

export interface ScenarioRole {
  /** Also the replay actor id. */
  id: string;
  team: ScenarioTeam;
  /** The fixed shirt number of this role (see roles.ts). Drawn on the marker as the badge, never as a squad number. */
  number?: ByFlank<number>;
  /** One or two characters drawn on the marker when there is no `number`. */
  badge?: ByFlank<string>;
  /** How captions refer to the role ("the No. 8"); defaults to `label`. */
  short?: ByFlank<string>;
  /** Shown under the marker (≤ 14 characters, the marker label limit). */
  label: ByFlank<string>;
  /** Used in captions and the accessible name. */
  description: ByFlank<string>;
}

export type BallLeg =
  | { kind: 'carry'; by: string; t0: number; t1: number }
  | {
      kind: 'pass';
      from: string;
      /** A role (the arrow follows the receiver) or a fixed point. */
      to: string | Pt;
      t0: number;
      t1: number;
      style: 'pass' | 'lofted' | 'shot';
      note?: string;
      /** Seconds the arrow stays on screen after it lands. */
      hold?: number;
    };

/** A dashed movement arrow that draws out while the run happens. */
interface RunArrow {
  id: string;
  actor: string;
  t0: number;
  t1: number;
  /** Defaults to where the actor is at `t1`. */
  to?: Pt;
  note?: string;
  hold?: number;
}

/** A caption shown from `t` until the next one. */
interface Beat {
  t: number;
  text: string;
}

export interface Segment {
  tracks: Record<string, Waypoint[]>;
  ball: BallLeg[];
  arrows: RunArrow[];
  beats: Beat[];
}

/** How the sentence at the end of an option is built from the geometry at that moment. */
export type VerdictSpec =
  /** A lofted ball to a point: who is within reach of where it lands, and the pressure on the kicker. */
  | { type: 'delivery' }
  /** A pass to a role: the lane at release and how close the nearest defender is when he receives. */
  | { type: 'receiver'; next?: { time: string; tight: string; closed: string } }
  /** A pass to a role, then how the lanes from him to the listed roles look. */
  | { type: 'lanes'; to: string[] }
  /** The planned pass is not on: the ball is kept instead. `declined` is the role it was meant for. */
  | { type: 'retain'; declined: string };

export interface OutcomeDef extends Segment {
  label: string;
  /** Text of the picker button. */
  tab: string;
  /** What the defender chose, in one line. */
  summary: string;
}

export interface OptionDef extends Segment {
  title: string;
  /** What the option does. */
  summary: string;
  /** Situations in which it is the sensible choice. Not a rule. */
  fitsWhen: string;
  /** What can go wrong. */
  risk: string;
  /** When the branch finishes (seconds). */
  end: number;
  /** How the sentence at the landing is built. */
  verdict: VerdictSpec;
  /** Replaces tracks/ball (and the verdict) for this option when the defence chose that outcome earlier. */
  byOutcome?: Partial<
    Record<
      OutcomeId,
      Partial<Segment> & {
        verdict?: VerdictSpec;
        /** Replace the option's tracks, ball, arrows and beats outright instead of merging (the option is not played as authored). */
        replace?: boolean;
      }
    >
  >;
}

interface StageDef {
  id: string;
  title: string;
  /** One line shown in the stage strip. */
  summary: string;
  /** Coaching points: why the movement is made. */
  coaching: string[];
  /** Resolved against the chosen outcome; stages that differ per outcome give one span each. */
  span: readonly [number, number] | Readonly<Record<OutcomeId, readonly [number, number]>>;
  /** Extra coaching that applies only to one outcome. */
  outcomeNotes?: Partial<Record<OutcomeId, string>>;
}

interface RuleBase {
  id: string;
  /** Seconds. The highlight can only appear inside this window. */
  window: readonly [number, number];
  /** Only for these outcomes (all when absent). */
  outcomes?: OutcomeId[];
  /** Only while this option is chosen (`null` = none yet). All when absent. */
  options?: (OptionId | null)[];
  label: string;
  /** A shorter text for the pitch itself, where space is tight (the list keeps `label`). */
  shortLabel?: string;
}

/**
 * The vocabulary of pitch-geometry highlights. Each one is evaluated from the
 * players' sampled positions at the current time; none is an AI estimate.
 */
export type SpaceRule = RuleBase &
  (
    | {
        /** The outside channel ahead of an overlapping runner. */
        type: 'channel';
        runner: string;
      }
    | {
        /**
         * A passing lane. `ground`: every defender near the line counts. `cross`: only those near the kicker.
         * `lofted`: those near either end (the kicker and the receiver's marker).
         */
        type: 'lane';
        mode: 'ground' | 'cross' | 'lofted';
        /** A role, or 'ball'. */
        from: string;
        to: string | Pt;
      }
    | {
        /** The gap between two defenders and whether an attacker is still marked. */
        type: 'gap';
        between: readonly [string, string];
        attacker: string;
      }
    | { type: 'cover'; anchor: string; radiusM: readonly [number, number] }
    | { type: 'exposed'; runner: string }
    | { type: 'pocket'; anchor: string }
    | {
        /** Attackers against the defenders inside the zone they occupy: "4v2". */
        type: 'overload';
        attackers: string[];
      }
    | {
        /**
         * A fixed rectangle (x0, x1, y0, y1), drawn only when no defender is inside or nearer than `showAtM`,
         * and as open from `openAtM`.
         */
        type: 'zone';
        rect: readonly [number, number, number, number];
        showAtM: number;
        openAtM: number;
      }
    | { type: 'target'; at: Pt; radiusM: number }
  );

/** A thin line showing who a defender is marking, for the time it applies. */
interface MarkingDef {
  id: string;
  defender: string;
  attacker: string;
  window: readonly [number, number];
  outcomes?: OutcomeId[];
}

export interface TacticScenario {
  id: string;
  title: string;
  /** Roles in draw order (attackers first, ball is added by the compiler). */
  roles: ScenarioRole[];
  /** The last moment shared by every outcome; outcomes diverge after it. */
  forkT: number;
  /** The moment the ball carrier chooses; options branch from it. */
  decisionT: number;
  base: Segment;
  outcomes: Record<OutcomeId, OutcomeDef>;
  options: Record<OptionId, OptionDef>;
  stages: StageDef[];
  /** Which outcome is selected first. */
  defaultOutcome: OutcomeId;
  /** Heading of the outcome picker, and of the option picker. */
  outcomeHeading: string;
  decisionPrompt: string;
  /** The pause stage shown at the decision point (its label defaults to "Decision"). */
  decisionStage: { label?: string; title: string; summary: string; coaching: string[] };
  /** The stage that starts when the chosen option's first pass lands (absent: the decision stage runs on). */
  resolveStage?: { title: string; summary: string; coaching: string[] };
  spaces: SpaceRule[];
  marking: MarkingDef[];
  /**
   * Arrows shorter than this (metres) are drawn without their text: a caption on a short arrow sits under its own
   * markers. The captions and stage notes carry the explanation. Absent: every note is drawn.
   */
  minNoteLengthM?: number;
  /** What a defence can do to neutralise the pattern. */
  counters: string[];
  /** Plain statement that the scene is an illustration. */
  caveat: string;
}

export function byFlank<T>(value: ByFlank<T>, flank: Flank): T {
  if (typeof value === 'object' && value !== null && 'left' in value && 'right' in value) {
    return (value as Readonly<Record<Flank, T>>)[flank];
  }
  return value as T;
}
