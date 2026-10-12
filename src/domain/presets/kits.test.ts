import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chooseKits, clubKits, colourDistance, contrastRatio, fallbackAwayKit, hasKitTheme, kitFor, kitsClash, KIT_SOURCES, kitThemedPresetIds, numberBackdrops } from './kits';
import type { KitTheme } from './kits';
import { isNumberUnknown } from './snapshot';
import type { Player } from '../types';

const dataset = JSON.parse(readFileSync('public/presets/isl/2026-27.json', 'utf8')) as { teams: { id: string; officialName: string }[] };
const HEX = /^#[0-9a-f]{6}$/i;
const allThemes = (t: KitTheme) => [t.primary, t.secondary, t.accent, t.numberColour, t.outline, t.collar, t.sleeves, t.gradient?.from, t.gradient?.to].filter((c): c is string => !!c);

describe('kit themes', () => {
  it('covers exactly the clubs of the committed 2026-27 dataset', () => {
    expect(kitThemedPresetIds().sort()).toEqual(dataset.teams.map((t) => t.id).sort());
    for (const team of dataset.teams) expect(hasKitTheme(team.id)).toBe(true);
    expect(hasKitTheme('custom-team')).toBe(false);
    expect(hasKitTheme(undefined)).toBe(false);
  });

  it('uses valid colours and cites a known source for every club', () => {
    for (const id of kitThemedPresetIds()) {
      const kits = clubKits(id)!;
      for (const theme of [kits.home, kits.away, fallbackAwayKit(kits.home)]) {
        if (!theme) continue;
        for (const c of allThemes(theme)) expect(c, `${id}`).toMatch(HEX);
      }
      expect(kits.sources.length).toBeGreaterThan(0);
      for (const key of kits.sources) expect(KIT_SOURCES[key], `${id} source ${key}`).toBeDefined();
      // Honesty: anything not fully documented says what is missing.
      if (kits.verification !== 'documented') expect(kits.unverified.length).toBeGreaterThan(0);
    }
  });

  it('keeps the shirt number readable on every colour behind it (home, away and the generic away kit)', () => {
    for (const id of kitThemedPresetIds()) {
      const kits = clubKits(id)!;
      for (const theme of [kits.home, kits.away, fallbackAwayKit(kits.home)]) {
        if (!theme) continue;
        for (const backdrop of numberBackdrops(theme)) {
          expect(contrastRatio(theme.numberColour, backdrop), `${id}: ${theme.numberColour} on ${backdrop}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('gives each club its own recognisable home design', () => {
    const designs = kitThemedPresetIds().map((id) => {
      const t = clubKits(id)!.home;
      return `${t.primary}|${t.secondary}|${t.pattern}`;
    });
    expect(new Set(designs).size).toBe(designs.length);
    // Mohun Bagan: green and maroon.
    const mb = clubKits('isl-club-1874')!.home;
    expect([mb.primary, mb.secondary]).toEqual(['#0e7c42', '#7a1d3b']);
  });

  it('is deterministic', () => {
    expect(kitFor('isl-club-1874', 'away')).toEqual(kitFor('isl-club-1874', 'away'));
  });
});

describe('choosing kits', () => {
  it('wears the home kit unless the two shirts clash, then the away side changes', () => {
    const plain = chooseKits({ presetId: 'isl-club-1874' }, { presetId: 'isl-club-498' });
    expect(plain.home?.variant).toBe('home');
    expect(plain.away?.variant).toBe('home');
    expect(kitsClash(plain.home, plain.away)).toBe(false);

    // Two red clubs: the away side switches to its away kit.
    const reds = chooseKits({ presetId: 'isl-club-504' }, { presetId: 'isl-club-1101' });
    expect(reds.home?.variant).toBe('home');
    expect(reds.away?.variant).toBe('away');
    expect(kitsClash(reds.home, reds.away)).toBe(false);
  });

  it('lets an explicit choice win, even into a clash', () => {
    const forced = chooseKits({ presetId: 'isl-club-504' }, { presetId: 'isl-club-1101', kit: 'home' });
    expect(forced.away?.variant).toBe('home');
    expect(kitsClash(forced.home, forced.away)).toBe(true);
    const swapped = chooseKits({ presetId: 'isl-club-1874', kit: 'away' }, { presetId: 'isl-club-498' });
    expect(swapped.home?.variant).toBe('away');
  });

  it('marks a derived away kit as a stand-in and a documented one as not', () => {
    expect(kitFor('isl-club-498', 'away')).toMatchObject({ isFallback: true, verification: 'unverified' });
    expect(kitFor('isl-club-1874', 'away')).toMatchObject({ isFallback: false });
  });

  it('gives no kit to a custom team', () => {
    const mixed = chooseKits({ presetId: undefined }, { presetId: 'isl-club-1874' });
    expect(mixed.home).toBeNull();
    expect(mixed.away).not.toBeNull();
    expect(chooseKits({ presetId: undefined }, { presetId: undefined })).toEqual({ home: null, away: null });
  });

  it('measures colour distance sensibly', () => {
    expect(colourDistance('#ff0000', '#ff0000')).toBe(0);
    expect(colourDistance('#ffffff', '#000000')).toBeGreaterThan(90);
    expect(colourDistance('#d51f2a', '#c8102e')).toBeLessThan(30);
  });
});

describe('unknown shirt numbers', () => {
  const player = (origin: Player['origin'], shirtNumber: number): Player => ({ id: 'p', name: 'A', shirtNumber, preferredPosition: 'ST', notes: '', origin });
  const base = { presetId: 'x', season: '2026-27', sourcePosition: null, nationality: null, dateOfBirth: null, photoUrl: null, profileUrl: null };

  it('treats the temporary number as unknown until the user corrects it', () => {
    const imported = { name: 'A', shirtNumber: null, position: 'ST' as const };
    expect(isNumberUnknown(player({ ...base, imported, assignedNumber: 99 }, 99))).toBe(true);
    expect(isNumberUnknown(player({ ...base, imported, assignedNumber: 99 }, 17))).toBe(false);
    // Created before assignedNumber existed: cannot tell, so stays unknown (never prints an invented number).
    expect(isNumberUnknown(player({ ...base, imported }, 99))).toBe(true);
    expect(isNumberUnknown(player({ ...base, imported: { ...imported, shirtNumber: 9 } }, 9))).toBe(false);
    expect(isNumberUnknown(player(undefined, 99))).toBe(false);
  });
});
