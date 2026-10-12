/**
 * Team presets: reusable, season-scoped reference data (a club, its head coach and squad).
 *
 * Presets are TEMPLATES. A match never links to one live: creating a match copies a snapshot
 * (`snapshot.ts`), so editing a match cannot change a preset and refreshing a preset cannot
 * change an existing match. Nothing here depends on React, the DOM or storage.
 */

/** Where a record came from. `official` = read from an official league page; `manual` = supplied by hand with a source. */
export type PresetVerification = 'official' | 'manual' | 'unverified';

/** The coarse positions the official site publishes. */
export const SOURCE_POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'] as const;
export type SourcePosition = (typeof SOURCE_POSITIONS)[number];

interface PresetSource {
  url: string;
  /** ISO time the page was read. */
  retrievedAt: string;
}

export interface PlayerPreset {
  /** Stable internal id, derived from the source's player id so a transfer keeps the identity (e.g. `isl-player-19150`). */
  id: string;
  /** The source's own id for this player. */
  sourceId: string;
  /** Full name as published. */
  name: string;
  /** Name as the site displays it on the squad card (often a surname), when different. */
  displayName: string | null;
  /** Null when the source gives none or an unusable number. */
  shirtNumber: number | null;
  position: SourcePosition | null;
  nationality: string | null;
  /** ISO `YYYY-MM-DD`, only when published. */
  dateOfBirth: string | null;
  headshotUrl: string | null;
  profileUrl: string | null;
  verification: PresetVerification;
  /** Data-quality remarks recorded at import (conflicting fields, corrections applied). */
  notes: string[];
  source: PresetSource;
}

export interface CoachPreset {
  sourceId: string | null;
  name: string;
  role: string;
  nationality: string | null;
  photoUrl: string | null;
  verification: PresetVerification;
  notes: string[];
  source: PresetSource;
}

export interface TeamPreset {
  /** Stable internal id, season-independent (e.g. `isl-club-656`). */
  id: string;
  sourceId: string;
  officialName: string;
  displayName: string;
  /** Not published by the official site; only set by a manual import or override. */
  shortName: string | null;
  abbreviation: string | null;
  city: string | null;
  venue: string | null;
  logoUrl: string | null;
  /** The club's official page on the league site. */
  profileUrl: string | null;
  coach: CoachPreset | null;
  players: PlayerPreset[];
  verification: PresetVerification;
  notes: string[];
  source: PresetSource;
}

export interface PresetSourceRef {
  name: string;
  url: string;
  retrievedAt: string;
}

/** One season of one league: the unit that is imported, validated, diffed and served. */
export interface SeasonPresets {
  format: 'dizpitch.teampresets';
  schemaVersion: 1;
  league: { id: string; name: string };
  /** `2026-27` */
  season: string;
  /** ISO time this file was produced. */
  generatedAt: string;
  /** How it was produced (importer name/version, or `manual`). */
  generator: string;
  sources: PresetSourceRef[];
  teams: TeamPreset[];
}

export interface PresetManifestEntry {
  league: { id: string; name: string };
  season: string;
  /** Path relative to the manifest, e.g. `isl/2026-27.json`. */
  file: string;
  teams: number;
  players: number;
  generatedAt: string;
}

/** `public/presets/index.json`: which seasons have been imported. */
export interface PresetManifest {
  format: 'dizpitch.presetindex';
  schemaVersion: 1;
  seasons: PresetManifestEntry[];
}
