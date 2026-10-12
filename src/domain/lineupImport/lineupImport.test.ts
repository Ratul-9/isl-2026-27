import { describe, expect, it } from 'vitest';
import { FORMATIONS, getFormation } from '../formations';
import { parseDocument, serializeDocumentForTest } from './testSupport';
import { assignStarters, formationLines } from './assign';
import {
  addPlayer,
  assignSlot,
  draftFromExtraction,
  emptyDraftTeam,
  moveToStarters,
  moveToSubstitutes,
  removePlayer,
  setFormation,
  updatePlayer,
  validateDraftTeam,
} from './draft';
import { BENGALURU_GROUND_TRUTH, SC_DELHI_GROUND_TRUTH } from './fixtures';
import { cleanPlayerName, normalizePosition, parseFormation } from './formation';
import { imageToTeamFrame } from './orientation';
import { buildMatchFromDrafts, EMPTY_METADATA, LineupImportError } from './toMatch';
import type { ExtractedLineup, GoalkeeperEdge } from './types';
import type { FormationId, Point } from '../types';
import { analyzeEvents } from '../events';
import { validateSquadIntegrity } from '../squad';

let n = 0;
const key = () => `k${++n}`;
let idCounter = 0;
const newId = (prefix: string) => `${prefix}_t${++idCounter}`;

describe('formation text', () => {
  it.each([
    ['4-3-3', '4-3-3'],
    ['4 – 3 – 3', '4-3-3'],
    ['4/2/3/1', '4-2-3-1'],
    ['442', '4-4-2'],
    ['5-3-2 formation', '5-3-2'],
    ['  3-4-2-1 ', '3-4-2-1'],
  ])('reads %s', (text, id) => {
    expect(parseFormation(text)).toEqual({ kind: 'supported', id });
  });

  it('never guesses: unsupported or unreadable shapes are reported', () => {
    expect(parseFormation('4-1-2-3')).toMatchObject({ kind: 'unsupported', raw: '4-1-2-3' });
    expect(parseFormation('4-4-3')).toMatchObject({ kind: 'unsupported', reason: expect.stringContaining('11 outfield') });
    expect(parseFormation('attacking')).toMatchObject({ kind: 'unsupported' });
    expect(parseFormation(null)).toEqual({ kind: 'none' });
    expect(parseFormation('   ')).toEqual({ kind: 'none' });
  });
});

describe('position and name cleanup', () => {
  it('maps displayed positions to DizPitch codes and leaves unknowns unmapped', () => {
    expect(normalizePosition('gk')).toBe('GK');
    expect(normalizePosition('L.W.')).toBe('LW');
    expect(normalizePosition('DM')).toBe('CDM');
    expect(normalizePosition('Midfielder')).toBeNull();
    expect(normalizePosition('')).toBeNull();
  });

  it('strips display markers but keeps the name itself intact', () => {
    expect(cleanPlayerName('GURPREET(GK)(C)')).toEqual({ name: 'GURPREET', captain: true, goalkeeper: true });
    expect(cleanPlayerName('GOGOU(C)')).toMatchObject({ name: 'GOGOU', captain: true, goalkeeper: false });
    expect(cleanPlayerName('MANOJ MD.')).toMatchObject({ name: 'MANOJ MD.' });
    expect(cleanPlayerName('PEÑA').name).toBe('PEÑA');
    expect(cleanPlayerName("N'GOLO  KANTÉ").name).toBe("N'GOLO KANTÉ");
  });
});

describe('graphic orientation → team frame', () => {
  const p = (x: number, y: number): Point => ({ x, y });
  it('handles all four goal edges', () => {
    // Own goal at the bottom: attacking up; image left is the team's left.
    expect(imageToTeamFrame(p(0.1, 0.9), 'bottom')).toEqual({ x: expect.closeTo(0.1), y: 0.1 });
    // Own goal at the top: attacking down; image right is the team's left.
    expect(imageToTeamFrame(p(0.9, 0.1), 'top')).toEqual({ x: 0.1, y: expect.closeTo(0.1) });
    expect(imageToTeamFrame(p(0.1, 0.1), 'left')).toEqual({ x: 0.1, y: 0.1 });
    expect(imageToTeamFrame(p(0.9, 0.9), 'right')).toEqual({ x: expect.closeTo(0.1), y: expect.closeTo(0.1) });
  });
});

describe('assigning starters to formation slots', () => {
  /** The inverse of imageToTeamFrame, for generating synthetic graphics. depth: 0–1 over the whole pitch. */
  const teamToImage = (depth: number, lateral: number, edge: GoalkeeperEdge): Point => {
    switch (edge) {
      case 'bottom':
        return { x: lateral, y: 1 - depth };
      case 'top':
        return { x: 1 - lateral, y: depth };
      case 'left':
        return { x: depth, y: lateral };
      case 'right':
        return { x: 1 - depth, y: 1 - lateral };
    }
  };

  it('reproduces every preset from a rendered graphic, in any orientation, with shuffled and noisy input', () => {
    const edges: GoalkeeperEdge[] = ['bottom', 'top', 'left', 'right'];
    for (const f of FORMATIONS) {
      const template = getFormation(f.id).slots;
      for (const edge of edges) {
        // Each template slot becomes a graphic position (own half stretched over the whole pitch).
        const players = template.map((s, slot) => {
          const at = teamToImage(Math.min(0.98, s.x * 2), s.y, edge);
          return { slot, x: at.x + ((slot * 7) % 5) * 0.002, y: at.y - ((slot * 3) % 4) * 0.002, goalkeeper: slot === 0 };
        });
        const shuffled = [...players].sort((a, b) => ((a.slot * 37) % 11) - ((b.slot * 37) % 11));
        const result = assignStarters(shuffled.map((q) => ({ x: q.x, y: q.y, goalkeeper: q.goalkeeper })), f.id, edge);
        expect(result.confident).toBe(true);
        // Slots with the same role-line/lateral order may be permuted only within identical positions.
        shuffled.forEach((q, i) => {
          const got = result.slots[i] as number;
          expect(template[got].position, `${f.id} ${edge}`).toBe(template[q.slot].position);
          expect(Math.abs(template[got].y - template[q.slot].y)).toBeLessThan(0.0001);
        });
        expect(new Set(result.slots).size).toBe(11);
      }
    }
  });

  it('finds the goalkeeper as the deepest player when none is marked', () => {
    const r = assignStarters(
      [
        { x: 0.5, y: 0.3, goalkeeper: false },
        { x: 0.5, y: 0.9, goalkeeper: false },
        ...Array.from({ length: 9 }, (_, i) => ({ x: 0.1 + i * 0.1, y: 0.5, goalkeeper: false })),
      ],
      '4-4-2',
      'bottom',
    );
    expect(r.slots[1]).toBe(0);
  });

  it('flags missing coordinates and the wrong number of outfield players', () => {
    const noCoords = assignStarters(
      Array.from({ length: 11 }, (_, i) => ({ x: null, y: null, goalkeeper: i === 0 })),
      '4-3-3',
      null,
    );
    expect(noCoords.confident).toBe(false);
    expect(noCoords.slots[0]).toBe(0);
    expect(new Set(noCoords.slots).size).toBe(11);

    const nine = assignStarters(
      Array.from({ length: 9 }, (_, i) => ({ x: i / 10, y: 0.5, goalkeeper: i === 0 })),
      '4-4-2',
      'bottom',
    );
    expect(nine.confident).toBe(false);
    expect(nine.reason).toMatch(/needs 10 outfield players but 8 were read/);
  });

  it('reads formation lines from the preset name', () => {
    expect(formationLines('4-2-3-1' as FormationId)).toEqual([4, 2, 3, 1]);
  });
});

describe('the supplied reference graphics (hand-transcribed ground truth)', () => {
  it('Bengaluru FC: 4-3-3 with the right player in every slot', () => {
    const team = draftFromExtraction(BENGALURU_GROUND_TRUTH, key);
    expect(team.formation).toBe('4-3-3');
    expect(team.formationStatus).toEqual({ kind: 'detected' });
    expect(team.assignmentUncertain).toBe(false);
    const template = getFormation('4-3-3').slots;
    const at = (slot: number) => team.starters.find((p) => p.slot === slot)!.name;
    expect(template.map((_, i) => `${template[i].position}:${at(i)}`)).toEqual([
      'GK:GURPREET',
      'LB:NAOREM',
      'LCB:SANA',
      'RCB:KOCH',
      'RB:SHIVALDO',
      'LCM:MARTÍNEZ',
      'CDM:FANAI',
      'RCM:SURESH',
      'LW:ASHIQUE',
      'ST:PEROVIC',
      'RW:RYAN',
    ]);
    expect(team.substitutes).toHaveLength(9);
    expect(team.starters.find((p) => p.name === 'GURPREET')).toMatchObject({ captain: true, position: 'GK', shirtNumber: 1 });
  });

  it('SC Delhi: 5-3-2 with a back five and two forwards', () => {
    const team = draftFromExtraction(SC_DELHI_GROUND_TRUTH, key);
    expect(team.formation).toBe('5-3-2');
    const template = getFormation('5-3-2').slots;
    const at = (slot: number) => team.starters.find((p) => p.slot === slot)!.name;
    expect(template.map((_, i) => `${template[i].position}:${at(i)}`)).toEqual([
      'GK:FERNANDES',
      'LWB:TOMBA',
      'LCB:MANOJ MD.',
      'CB:DUVAN',
      'RCB:NDUKA',
      'RWB:GOGOU',
      'LCM:PEÑA',
      'CM:AZHAR',
      'RCM:HNAMTE',
      'ST:RODRIGUINHO',
      'ST:AIMEN',
    ]);
    expect(team.substitutes.map((s) => s.shirtNumber)).toEqual([6, 8, 15, 18, 27, 30, 31, 66, 99]);
    expect(team.starters.find((p) => p.name === 'GOGOU')?.captain).toBe(true);
  });

  it('reads multi-part names and punctuation exactly', () => {
    const team = draftFromExtraction(SC_DELHI_GROUND_TRUTH, key);
    expect(team.substitutes.find((s) => s.shirtNumber === 99)?.name).toBe('CARLOS MANUEL DOS SANTOS FORTES');
    expect(team.substitutes.find((s) => s.shirtNumber === 30)?.name).toBe('T. DIAMOND SINGH');
    expect(team.starters.find((s) => s.shirtNumber === 10)?.name).toBe('PEÑA');
  });

  it('both reference lineups validate with only advisory warnings', () => {
    for (const [lineup, label] of [[BENGALURU_GROUND_TRUTH, 'Home'], [SC_DELHI_GROUND_TRUTH, 'Away']] as const) {
      const issues = validateDraftTeam(draftFromExtraction(lineup, key), label);
      expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
      // The team name only appears on the badge, which must be surfaced for confirmation.
      expect(issues.map((i) => i.code)).toContain('team-name-from-crest');
    }
  });
});

describe('creating the match', () => {
  const home = () => draftFromExtraction(BENGALURU_GROUND_TRUTH, key);
  const away = () => draftFromExtraction(SC_DELHI_GROUND_TRUTH, key);

  it('builds a normal DizPitch match that survives a save/load round trip', () => {
    const match = buildMatchFromDrafts(home(), away(), { ...EMPTY_METADATA, competition: 'ISL', venue: 'Kanteerava' }, newId);
    expect(match.competition).toBe('ISL');
    expect(match.home).toMatchObject({ name: 'Bengaluru FC', coach: 'JOSE MUNOZ ZOYO', formation: { kind: 'preset', id: '4-3-3' } });
    expect(match.away).toMatchObject({ name: 'Sporting Club Delhi', formation: { kind: 'preset', id: '5-3-2' } });
    expect(match.home.players).toHaveLength(20);
    expect(match.home.bench).toHaveLength(9);
    expect(match.home.slots.filter((s) => s.playerId)).toHaveLength(11);
    expect(validateSquadIntegrity(match.home)).toEqual([]);
    expect(validateSquadIntegrity(match.away)).toEqual([]);

    // Slots carry the formation's positions and coordinates (home attacks right, away is rotated).
    const striker = match.home.players.find((p) => p.name === 'PEROVIC')!;
    const slot = match.home.slots.find((s) => s.playerId === striker.id)!;
    expect(slot.position).toBe('ST');
    expect(slot.x).toBeCloseTo(0.45, 2);
    const awayKeeper = match.away.slots.find((s) => s.position === 'GK')!;
    expect(awayKeeper.x).toBeGreaterThan(0.9);

    // Exactly like a manual match: valid, no events, derived lineup equals the starting XI.
    const analysis = analyzeEvents(match);
    expect(analysis.lineups.home.onPitch).toHaveLength(11);
    const reloaded = parseDocument(serializeDocumentForTest(match));
    expect(reloaded.ok && reloaded.match).toEqual(match);
  });

  it('keeps every detected player and keeps substitutes separate', () => {
    const match = buildMatchFromDrafts(home(), away(), EMPTY_METADATA, newId);
    const names = [...BENGALURU_GROUND_TRUTH.starters, ...BENGALURU_GROUND_TRUTH.substitutes].map((p) => p.name.replace(/\(.*$/, ''));
    expect(match.home.players.map((p) => p.name).sort()).toEqual([...names].sort());
    const benchNames = match.home.bench.map((id) => match.home.players.find((p) => p.id === id)!.name);
    expect(benchNames).toEqual(BENGALURU_GROUND_TRUTH.substitutes.map((s) => s.name));
    expect(match.home.players.find((p) => p.name === 'GURPREET')?.notes).toBe('Captain');
  });

  it('leaves unavailable metadata blank', () => {
    const match = buildMatchFromDrafts(home(), away(), EMPTY_METADATA, newId);
    expect(match).toMatchObject({ competition: '', date: '', kickoffTime: '', venue: '' });
    expect(match.officials).toEqual({ referee: '', assistant1: '', assistant2: '', fourthOfficial: '' });
  });

  it('refuses to build while a blocking problem remains', () => {
    const broken = updatePlayer(home(), home().starters[1].key, {});
    const dup = { ...broken, starters: broken.starters.map((p, i) => (i === 2 ? { ...p, shirtNumber: broken.starters[1].shirtNumber } : p)) };
    expect(() => buildMatchFromDrafts(dup, away(), EMPTY_METADATA, newId)).toThrow(LineupImportError);
  });
});

describe('review edits', () => {
  const base = () => draftFromExtraction(BENGALURU_GROUND_TRUTH, key);

  it('changing the formation re-assigns from the graphic and marks it chosen', () => {
    const t = setFormation(base(), '4-2-3-1');
    expect(t.formation).toBe('4-2-3-1');
    expect(t.formationStatus).toEqual({ kind: 'chosen' });
    expect(t.starters.map((p) => p.slot).sort((a, b) => (a as number) - (b as number))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // The goalkeeper stays the goalkeeper.
    expect(t.starters.find((p) => p.name === 'GURPREET')?.slot).toBe(0);
  });

  it('moves players between starters and substitutes without losing anyone', () => {
    let t = base();
    const sana = t.starters.find((p) => p.name === 'SANA')!;
    t = moveToSubstitutes(t, sana.key);
    expect(t.starters).toHaveLength(10);
    expect(t.substitutes.at(-1)).toMatchObject({ name: 'SANA', slot: null });
    t = moveToStarters(t, sana.key);
    expect(t.starters).toHaveLength(11);
    expect(t.starters.find((p) => p.key === sana.key)?.slot).toBe(2); // takes the freed slot
    expect(new Set(t.starters.map((p) => p.slot)).size).toBe(11);
  });

  it('swapping slots exchanges two starters', () => {
    let t = base();
    const a = t.starters.find((p) => p.name === 'SANA')!;
    const b = t.starters.find((p) => p.name === 'KOCH')!;
    t = assignSlot(t, a.key, b.slot);
    expect(t.starters.find((p) => p.key === a.key)?.slot).toBe(b.slot);
    expect(t.starters.find((p) => p.key === b.key)?.slot).toBe(a.slot);
  });

  it('flags and blocks duplicate numbers, missing numbers and overfull squads; adding/removing works', () => {
    let t = base();
    const [first, second] = t.substitutes;
    t = updatePlayer(t, second.key, { shirtNumber: first.shirtNumber });
    let codes = validateDraftTeam(t, 'Home').map((i) => i.code);
    expect(codes.filter((c) => c === 'duplicate-number')).toHaveLength(2);

    t = addPlayer(t, 'substitute', 'new1');
    codes = validateDraftTeam(t, 'Home').map((i) => i.code);
    expect(codes).toContain('missing-name');
    expect(codes).toContain('missing-number');
    t = removePlayer(t, 'new1');

    for (let i = 0; i < 3; i++) t = addPlayer(t, 'substitute', `x${i}`);
    expect(validateDraftTeam(t, 'Home').map((i) => i.code)).toContain('too-many-substitutes');
  });

  it('never drops uncertain data: it is kept and flagged until edited', () => {
    const odd: ExtractedLineup = {
      ...BENGALURU_GROUND_TRUTH,
      formation: '4-1-2-3',
      starters: BENGALURU_GROUND_TRUTH.starters.map((s, i) => (i === 3 ? { ...s, name: 'K?CH', uncertain: true, shirtNumber: null } : s)),
    };
    const t = draftFromExtraction(odd, key);
    expect(t.starters).toHaveLength(11);
    expect(t.formationStatus).toEqual({ kind: 'unsupported', raw: '4-1-2-3' });
    const codes = validateDraftTeam(t, 'Home').map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['uncertain-player', 'missing-number', 'formation-unsupported']));
    const fixed = updatePlayer(t, t.starters[3].key, { name: 'KOCH', shirtNumber: 3 });
    expect(fixed.starters[3].uncertain).toBe(false);
  });

  it('an empty manual draft is valid to start from and warns about everything missing', () => {
    const codes = validateDraftTeam(emptyDraftTeam(), 'Home').map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['missing-team-name', 'missing-coach', 'incomplete-xi', 'formation-missing']));
    expect(validateDraftTeam(emptyDraftTeam(), 'Home').some((i) => i.severity === 'error')).toBe(false);
  });
});
