import { FORMATIONS } from '../formations';
import type { FormationId, PositionCode } from '../types';
import { POSITIONS } from '../positions';

export type ParsedFormation =
  | { kind: 'supported'; id: FormationId }
  | { kind: 'unsupported'; raw: string; reason: string }
  | { kind: 'none' };

/**
 * Reads the formation text shown on a lineup graphic. Accepts "4-3-3",
 * "4 – 3 – 3", "4/3/3", "433" and similar; never guesses: a shape that has
 * no DizPitch preset is reported as unsupported instead of being coerced.
 */
export function parseFormation(text: string | null | undefined): ParsedFormation {
  const raw = (text ?? '').trim();
  if (raw === '') return { kind: 'none' };

  // Unify separators; drop trailing words such as "formation".
  const cleaned = raw.replace(/[‐-―−]/g, '-').replace(/[\s/.,·]+/g, '-').replace(/formation/gi, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  let digits: number[] | null = null;
  if (/^\d(-\d)+$/.test(cleaned)) digits = cleaned.split('-').map(Number);
  else if (/^\d{3,5}$/.test(cleaned)) digits = cleaned.split('').map(Number);
  if (!digits) return { kind: 'unsupported', raw, reason: `"${raw}" is not a recognisable formation.` };

  const sum = digits.reduce((a, b) => a + b, 0);
  if (sum !== 10) {
    return { kind: 'unsupported', raw, reason: `${digits.join('-')} has ${sum} outfield players, not 10.` };
  }
  const id = digits.join('-');
  const preset = FORMATIONS.find((f) => f.id === id);
  if (preset) return { kind: 'supported', id: preset.id };
  return { kind: 'unsupported', raw, reason: `DizPitch has no ${id} preset.` };
}

const ALIASES: Record<string, PositionCode> = {
  GK: 'GK',
  GKP: 'GK',
  GOALKEEPER: 'GK',
  LB: 'LB',
  RB: 'RB',
  LWB: 'LWB',
  RWB: 'RWB',
  CB: 'CB',
  LCB: 'LCB',
  RCB: 'RCB',
  CDM: 'CDM',
  DM: 'CDM',
  CM: 'CM',
  LCM: 'LCM',
  RCM: 'RCM',
  CAM: 'CAM',
  AM: 'CAM',
  LM: 'LM',
  RM: 'RM',
  LW: 'LW',
  RW: 'RW',
  CF: 'CF',
  ST: 'ST',
  FW: 'ST',
  SS: 'CF',
};

/** Maps displayed position text to a DizPitch position, or null when it is not a specific position. */
export function normalizePosition(text: string | null | undefined): PositionCode | null {
  const key = (text ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  if (key === '') return null;
  if (ALIASES[key]) return ALIASES[key];
  return POSITIONS.find((p) => p.code === key)?.code ?? null;
}

/** Strips display decoration from a player name: "GURPREET(GK)(C)" → "GURPREET". */
export function cleanPlayerName(raw: string): { name: string; captain: boolean; goalkeeper: boolean } {
  let name = raw;
  let captain = false;
  let goalkeeper = false;
  // Repeated bracketed markers such as (C), (GK), (VC).
  name = name.replace(/\(\s*(c|capt?|captain)\s*\)/gi, () => ((captain = true), ''));
  name = name.replace(/\(\s*gk\s*\)/gi, () => ((goalkeeper = true), ''));
  name = name.replace(/\(\s*v\.?\s*c\s*\)/gi, '');
  return { name: name.replace(/\s+/g, ' ').trim(), captain, goalkeeper };
}
