import type { ExtractedLineup, ExtractedPlayer } from '@/domain/lineupImport/types';
import type { LineupExtractionOutput } from './schema';

/** Pure, browser-safe normalisation of validated provider output. */

const clamp01 = (n: number | null): number | null => (n !== null && Number.isFinite(n) && n >= 0 && n <= 1 ? n : null);
const text = (s: string | null): string | null => {
  const t = s?.replace(/\s+/g, ' ').trim();
  return t ? t : null;
};

function toPlayer(p: LineupExtractionOutput['starters'][number], warnings: string[], where: string): ExtractedPlayer | null {
  const name = text(p.name) ?? '';
  const number = p.shirtNumber !== null && Number.isFinite(p.shirtNumber) ? Math.trunc(p.shirtNumber) : null;
  if (name === '' && number === null) {
    // Nothing readable at all: say so rather than vanish.
    warnings.push(`An empty ${where} entry was ignored.`);
    return null;
  }
  return {
    name,
    shirtNumber: number,
    position: text(p.position),
    x: clamp01(p.x),
    y: clamp01(p.y),
    captain: p.captain,
    uncertain: p.uncertain || name === '' || number === null,
    note: text(p.note),
  };
}

/** Validated provider output → the app's ExtractedLineup. Keeps every detected player. */
export function normalizeOutput(out: LineupExtractionOutput): ExtractedLineup {
  const warnings = out.warnings.map((w) => text(w)).filter((w): w is string => w !== null);
  const starters = out.starters.map((p) => toPlayer(p, warnings, 'starter')).filter((p): p is ExtractedPlayer => p !== null);
  const substitutes = out.substitutes
    .map((p) => toPlayer({ ...p, x: null, y: null }, warnings, 'substitute'))
    .filter((p): p is ExtractedPlayer => p !== null);
  return {
    teamName: text(out.teamName),
    teamNameSource: text(out.teamName) ? out.teamNameSource : 'unknown',
    coach: text(out.coach),
    formation: text(out.formation),
    goalkeeperEdge: out.goalkeeperEdge,
    starters,
    substitutes,
    warnings,
  };
}
