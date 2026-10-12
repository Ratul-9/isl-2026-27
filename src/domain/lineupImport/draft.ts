import { getFormation } from '../formations';
import { DEFAULT_FORMATION } from '../formations';
import { MAX_PLAYERS, MAX_SHIRT_NUMBER, MAX_STARTERS, MAX_SUBSTITUTES, MIN_SHIRT_NUMBER } from '../squad';
import type { FormationId, PositionCode } from '../types';
import { assignStarters } from './assign';
import { cleanPlayerName, normalizePosition, parseFormation } from './formation';
import type { DraftIssue, DraftPlayer, DraftTeam, ExtractedLineup, ExtractedPlayer } from './types';

/** Pure operations on the review draft. IDs/keys come from the caller. */

type KeyMaker = () => string;

function toDraftPlayer(p: ExtractedPlayer, key: string): { player: DraftPlayer; goalkeeper: boolean } {
  const cleaned = cleanPlayerName(p.name);
  const shown = normalizePosition(p.position);
  const goalkeeper = cleaned.goalkeeper || shown === 'GK';
  const number = p.shirtNumber !== null && Number.isFinite(p.shirtNumber) ? Math.trunc(p.shirtNumber) : null;
  return {
    goalkeeper,
    player: {
      key,
      name: cleaned.name,
      shirtNumber: number,
      position: shown ?? (goalkeeper ? 'GK' : null),
      unmappedPosition: shown === null && p.position && p.position.trim() !== '' && !goalkeeper ? p.position.trim() : null,
      slot: null,
      imageX: p.x !== null && p.x >= 0 && p.x <= 1 ? p.x : null,
      imageY: p.y !== null && p.y >= 0 && p.y <= 1 ? p.y : null,
      captain: p.captain || cleaned.captain,
      uncertain: p.uncertain || cleaned.name === '',
      note: p.note?.trim() ? p.note.trim() : null,
      origin: 'extracted',
    },
  };
}

/** Turns raw extraction output into an editable draft. Nothing is dropped. */
export function draftFromExtraction(extracted: ExtractedLineup, makeKey: KeyMaker): DraftTeam {
  const parsed = parseFormation(extracted.formation);
  const formation: FormationId = parsed.kind === 'supported' ? parsed.id : DEFAULT_FORMATION;
  const starters = extracted.starters.map((p) => toDraftPlayer(p, makeKey()));
  const substitutes = extracted.substitutes.map((p) => toDraftPlayer(p, makeKey()).player);

  const team: DraftTeam = {
    teamName: extracted.teamName?.trim() ?? '',
    teamNameSource: extracted.teamName ? extracted.teamNameSource : 'unknown',
    coach: extracted.coach?.trim() ?? '',
    formation,
    formationStatus:
      parsed.kind === 'supported'
        ? { kind: 'detected' }
        : parsed.kind === 'unsupported'
          ? { kind: 'unsupported', raw: parsed.raw }
          : { kind: 'missing' },
    goalkeeperEdge: extracted.goalkeeperEdge,
    starters: starters.map((s) => s.player),
    substitutes,
    warnings: [...extracted.warnings],
    assignmentUncertain: false,
  };
  return reassign(team, starters.map((s) => s.goalkeeper));
}

/** Re-runs automatic slot assignment from the graphic positions. */
function reassign(team: DraftTeam, goalkeeperFlags?: boolean[]): DraftTeam {
  const flags = goalkeeperFlags ?? team.starters.map((p) => p.position === 'GK');
  const result = assignStarters(
    team.starters.map((p, i) => ({ x: p.imageX, y: p.imageY, goalkeeper: flags[i] ?? false })),
    team.formation,
    team.goalkeeperEdge,
  );
  const template = getFormation(team.formation).slots;
  return {
    ...team,
    assignmentUncertain: !result.confident || team.starters.length !== MAX_STARTERS,
    starters: team.starters.map((p, i) => {
      const slot = result.slots[i];
      return {
        ...p,
        slot,
        // The displayed position wins; otherwise the slot's role is shown as a suggestion (not stored).
        position: p.position ?? (slot !== null ? template[slot].position : null),
      };
    }),
  };
}

/**
 * Changes the formation and re-assigns starters from the graphic. Positions
 * the user (or the graphic) set explicitly are kept; ones inferred from the
 * previous formation's slots are recomputed.
 */
export function setFormation(team: DraftTeam, formation: FormationId): DraftTeam {
  const previous = getFormation(team.formation).slots;
  const starters = team.starters.map((p) => {
    const inferred = p.slot !== null && p.position === previous[p.slot]?.position && p.origin === 'extracted' && p.unmappedPosition === null;
    return inferred && p.position !== 'GK' ? { ...p, position: null } : p;
  });
  return reassign({ ...team, starters, formation, formationStatus: { kind: 'chosen' } });
}

export function updatePlayer(team: DraftTeam, key: string, patch: Partial<Pick<DraftPlayer, 'name' | 'shirtNumber' | 'position' | 'captain'>>): DraftTeam {
  const edit = (p: DraftPlayer): DraftPlayer => (p.key === key ? { ...p, ...patch, uncertain: false } : p);
  return { ...team, starters: team.starters.map(edit), substitutes: team.substitutes.map(edit) };
}

/** Puts a starter into a slot; if another starter is there, they swap. */
export function assignSlot(team: DraftTeam, key: string, slot: number | null): DraftTeam {
  const mover = team.starters.find((p) => p.key === key);
  if (!mover) return team;
  const template = getFormation(team.formation).slots;
  const occupant = slot === null ? undefined : team.starters.find((p) => p.slot === slot && p.key !== key);
  const withPosition = (p: DraftPlayer, to: number | null): DraftPlayer => ({
    ...p,
    slot: to,
    // A position inferred from the old slot follows the new slot.
    position: p.unmappedPosition === null && (p.position === null || (p.slot !== null && p.position === template[p.slot]?.position))
      ? to !== null
        ? template[to].position
        : null
      : p.position,
    uncertain: false,
  });
  return {
    ...team,
    assignmentUncertain: false,
    starters: team.starters.map((p) => {
      if (p.key === key) return withPosition(p, slot);
      if (occupant && p.key === occupant.key) return withPosition(p, mover.slot);
      return p;
    }),
  };
}

function firstFreeSlot(team: DraftTeam): number | null {
  const used = new Set(team.starters.map((p) => p.slot));
  for (let i = 0; i < MAX_STARTERS; i++) if (!used.has(i)) return i;
  return null;
}

export function moveToSubstitutes(team: DraftTeam, key: string): DraftTeam {
  const player = team.starters.find((p) => p.key === key);
  if (!player) return team;
  return {
    ...team,
    starters: team.starters.filter((p) => p.key !== key),
    substitutes: [...team.substitutes, { ...player, slot: null, imageX: null, imageY: null }],
  };
}

export function moveToStarters(team: DraftTeam, key: string): DraftTeam {
  const player = team.substitutes.find((p) => p.key === key);
  if (!player) return team;
  const slot = firstFreeSlot(team);
  const template = getFormation(team.formation).slots;
  return {
    ...team,
    substitutes: team.substitutes.filter((p) => p.key !== key),
    starters: [...team.starters, { ...player, slot, position: player.position ?? (slot !== null ? template[slot].position : null) }],
  };
}

export function addPlayer(team: DraftTeam, role: 'starter' | 'substitute', key: string): DraftTeam {
  const blank: DraftPlayer = {
    key,
    name: '',
    shirtNumber: null,
    position: null,
    unmappedPosition: null,
    slot: null,
    imageX: null,
    imageY: null,
    captain: false,
    uncertain: false,
    note: null,
    origin: 'manual',
  };
  if (role === 'substitute') return { ...team, substitutes: [...team.substitutes, blank] };
  const slot = firstFreeSlot(team);
  return { ...team, starters: [...team.starters, { ...blank, slot }] };
}

export function removePlayer(team: DraftTeam, key: string): DraftTeam {
  return {
    ...team,
    starters: team.starters.filter((p) => p.key !== key),
    substitutes: team.substitutes.filter((p) => p.key !== key),
  };
}

/** An empty draft for manual entry (no extraction available or wanted). */
export function emptyDraftTeam(): DraftTeam {
  return {
    teamName: '',
    teamNameSource: 'unknown',
    coach: '',
    formation: DEFAULT_FORMATION,
    formationStatus: { kind: 'missing' },
    goalkeeperEdge: null,
    starters: [],
    substitutes: [],
    warnings: [],
    assignmentUncertain: false,
  };
}

// --- validation ----------------------------------------------------------------

export function positionAt(team: DraftTeam, slot: number): PositionCode {
  return getFormation(team.formation).slots[slot].position;
}

/**
 * Everything wrong or doubtful about a draft team. `error`s block creating
 * the match; `warning`s must be acknowledged by the user.
 */
export function validateDraftTeam(team: DraftTeam, label: string): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const add = (severity: DraftIssue['severity'], code: string, message: string, playerKey?: string) =>
    issues.push({ severity, code, message: `${label}: ${message}`, playerKey });

  const all = [...team.starters, ...team.substitutes];
  if (team.starters.length > MAX_STARTERS) add('error', 'too-many-starters', `${team.starters.length} starters; a team has at most ${MAX_STARTERS}. Move extras to the substitutes.`);
  if (team.substitutes.length > MAX_SUBSTITUTES) add('error', 'too-many-substitutes', `${team.substitutes.length} substitutes; DizPitch allows at most ${MAX_SUBSTITUTES}.`);
  if (all.length > MAX_PLAYERS) add('error', 'too-many-players', `${all.length} players; a squad has at most ${MAX_PLAYERS}.`);

  const numbers = new Map<number, DraftPlayer[]>();
  for (const p of all) {
    if (p.name.trim() === '') add('error', 'missing-name', 'a player has no name.', p.key);
    if (p.shirtNumber === null) {
      add('error', 'missing-number', `${p.name || 'A player'} has no shirt number.`, p.key);
    } else if (!Number.isInteger(p.shirtNumber) || p.shirtNumber < MIN_SHIRT_NUMBER || p.shirtNumber > MAX_SHIRT_NUMBER) {
      add('error', 'invalid-number', `${p.name || 'A player'} has shirt number ${p.shirtNumber}; use ${MIN_SHIRT_NUMBER}–${MAX_SHIRT_NUMBER}.`, p.key);
    } else {
      numbers.set(p.shirtNumber, [...(numbers.get(p.shirtNumber) ?? []), p]);
    }
    if (p.uncertain && p.name.trim() !== '') add('warning', 'uncertain-player', `${p.name} was read with low confidence; check name and number.`, p.key);
  }
  for (const [number, players] of numbers) {
    if (players.length > 1) {
      for (const p of players) add('error', 'duplicate-number', `shirt number ${number} is used by ${players.map((x) => x.name || 'an unnamed player').join(' and ')}.`, p.key);
    }
  }

  const slots = new Map<number, DraftPlayer[]>();
  for (const p of team.starters) {
    if (p.slot === null) add('error', 'no-slot', `${p.name || 'A starter'} has no position on the pitch.`, p.key);
    else slots.set(p.slot, [...(slots.get(p.slot) ?? []), p]);
  }
  for (const [slot, players] of slots) {
    if (players.length > 1) {
      for (const p of players) add('error', 'duplicate-slot', `${players.map((x) => x.name || 'an unnamed player').join(' and ')} are both assigned to ${positionAt(team, slot)}.`, p.key);
    }
  }

  if (team.teamName.trim() === '') add('warning', 'missing-team-name', 'no team name. It can be filled in later in Setup.');
  if (team.teamName.trim() !== '' && team.teamNameSource === 'crest') add('warning', 'team-name-from-crest', `the name "${team.teamName}" was read from the badge only; check the full name.`);
  if (team.coach.trim() === '') add('warning', 'missing-coach', 'no head coach was found.');
  if (team.starters.length < MAX_STARTERS) add('warning', 'incomplete-xi', `only ${team.starters.length} of ${MAX_STARTERS} starters.`);
  if (team.formationStatus.kind === 'missing') add('warning', 'formation-missing', `no formation was displayed; ${team.formation} is a placeholder until you confirm it.`);
  if (team.formationStatus.kind === 'unsupported') add('warning', 'formation-unsupported', `the graphic shows ${team.formationStatus.raw}, which DizPitch has no preset for; choose the closest formation.`);
  if (team.assignmentUncertain && team.starters.length > 0) add('warning', 'assignment-uncertain', 'the positions on the pitch were not assigned confidently; check them.');
  const keepers = team.starters.filter((p) => p.slot === 0);
  if (team.starters.length > 0 && keepers.length === 0) add('warning', 'no-goalkeeper', 'nobody is in the goalkeeper slot.');
  for (const w of team.warnings) add('warning', 'reader-note', `reader note: ${w}`);
  return issues;
}

// --- name tidying -----------------------------------------------------------------

/** "ASHUTOSH MEHTA" → "Ashutosh Mehta". Short dotted initials ("T.", "MD.") stay as written. */
function tidyName(name: string): string {
  if (name === '' || /\p{Ll}/u.test(name)) return name; // already has lower-case: leave it alone
  return name
    .split(/(\s+)/)
    .map((token) => {
      if (/^\s+$/.test(token) || token === '') return token;
      if (/^\p{Lu}{1,3}\.$/u.test(token)) return token; // initials
      return token
        .toLowerCase()
        .replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
    })
    .join('');
}

/** Converts ALL-CAPS names (common on broadcast graphics) to normal capitalisation. Names with any lower-case letter are untouched. */
export function tidyNames(team: DraftTeam): DraftTeam {
  const fix = (p: DraftPlayer): DraftPlayer => ({ ...p, name: tidyName(p.name) });
  return {
    ...team,
    coach: tidyName(team.coach),
    teamName: tidyName(team.teamName),
    starters: team.starters.map(fix),
    substitutes: team.substitutes.map(fix),
  };
}
