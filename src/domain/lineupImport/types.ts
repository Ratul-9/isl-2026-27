import type { FormationId, PositionCode } from '../types';

/**
 * Lineup import: what an extraction provider reports, and the editable draft
 * the user reviews before a match is created. Pure types, no framework code.
 */

/** Which edge of the lineup graphic's pitch the team's own goal is at. */
export type GoalkeeperEdge = 'top' | 'bottom' | 'left' | 'right';

type NameSource = 'text' | 'crest' | 'unknown';

/** One player exactly as read from the image (nothing normalised away). */
export interface ExtractedPlayer {
  name: string;
  shirtNumber: number | null;
  /** Position text as displayed (e.g. "GK", "LB"), if the graphic shows one. */
  position: string | null;
  /** Position on the graphic's pitch, 0–1 from its left/top edge; null if not determinable. */
  x: number | null;
  y: number | null;
  captain: boolean;
  /** The reader was not sure about this entry (blurry, partially hidden, guessed). */
  uncertain: boolean;
  note: string | null;
}

export interface ExtractedLineup {
  teamName: string | null;
  /** Where the team name was read: written text, only the badge/crest, or unknown. */
  teamNameSource: NameSource;
  coach: string | null;
  /** Formation text exactly as displayed ("4-3-3"), or null when not displayed. */
  formation: string | null;
  goalkeeperEdge: GoalkeeperEdge | null;
  starters: ExtractedPlayer[];
  substitutes: ExtractedPlayer[];
  /** Free-text caveats from the reader (illegible parts, cropped panels…). */
  warnings: string[];
}

// --- review draft ----------------------------------------------------------

type FormationStatus =
  /** Displayed formation text matched a DizPitch preset. */
  | { kind: 'detected' }
  /** The user chose or confirmed it during review. */
  | { kind: 'chosen' }
  /** Not displayed or not readable: a default is shown but must be confirmed. */
  | { kind: 'missing' }
  /** Displayed, but DizPitch has no preset for it (raw text kept). */
  | { kind: 'unsupported'; raw: string };

export interface DraftPlayer {
  /** Local key for the review UI only; real ids are created at match creation. */
  key: string;
  name: string;
  shirtNumber: number | null;
  /** Position played, if displayed or set by the user. */
  position: PositionCode | null;
  /** Raw displayed position text that could not be mapped to a DizPitch position. */
  unmappedPosition: string | null;
  /** Index into the formation's 11 slots (starters only). */
  slot: number | null;
  /** Where it was on the source graphic (kept so a formation change can re-assign). */
  imageX: number | null;
  imageY: number | null;
  captain: boolean;
  /** Reader was unsure; stays flagged until the user edits the entry. */
  uncertain: boolean;
  note: string | null;
  origin: 'extracted' | 'manual';
}

export interface DraftTeam {
  teamName: string;
  teamNameSource: NameSource;
  coach: string;
  formation: FormationId;
  formationStatus: FormationStatus;
  goalkeeperEdge: GoalkeeperEdge | null;
  starters: DraftPlayer[];
  substitutes: DraftPlayer[];
  /** Reader caveats, shown in review. */
  warnings: string[];
  /** The assignment of starters to slots was not confident. */
  assignmentUncertain: boolean;
}

type IssueSeverity = 'error' | 'warning';

export interface DraftIssue {
  severity: IssueSeverity;
  /** Stable id for tests and UI keys. */
  code: string;
  message: string;
  /** Player the issue refers to, if any. */
  playerKey?: string;
}

export interface MatchMetadata {
  competition: string;
  date: string;
  kickoffTime: string;
  venue: string;
  referee: string;
  assistant1: string;
  assistant2: string;
  fourthOfficial: string;
}
