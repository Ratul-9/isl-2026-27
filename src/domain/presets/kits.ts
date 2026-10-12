/**
 * Kit themes: the colours and simple pattern used to draw a preset club's players as jerseys on the pitch.
 *
 * Pure data and maths (no React, DOM or storage). A theme is a small ORIGINAL vector design inspired by the club's
 * colours; it is not a reproduction of any retail shirt, sponsor or crest. Hex values are our own approximations of
 * the named colours, not official brand values. Themes are looked up by `Team.preset.presetId`, so matches that
 * were created before this feature existed get jerseys too, and custom teams never have a theme.
 */

type KitPattern = 'solid' | 'halves' | 'stripes' | 'panel' | 'gradient' | 'piping';
export type KitVariant = 'home' | 'away';

/** How well the club's colours are backed by a cited text. See `KIT_SOURCES`. */
type KitVerification = 'documented' | 'partial' | 'unverified';

export interface KitTheme {
  primary: string;
  secondary: string;
  /** Piping / trim colour for patterns that use one; null = use `secondary`. */
  accent: string | null;
  numberColour: string;
  outline: string;
  pattern: KitPattern;
  /** Collar colour; null = `secondary`. */
  collar: string | null;
  /** Sleeve colour; null = same as the body. */
  sleeves: string | null;
  /** Used by the `gradient` pattern. */
  gradient: { from: string; to: string } | null;
}

export interface KitSource {
  label: string;
  url: string;
}

export interface ClubKits {
  verification: KitVerification;
  home: KitTheme;
  /** A documented away kit; null means the generic fallback away kit is derived from the home colours. */
  away: KitTheme | null;
  /** What could not be verified, shown to the user. */
  unverified: string[];
  sources: string[];
}

const WIKI = (page: string): KitSource => ({ label: `Wikipedia: ${page.replace(/_/g, ' ')}`, url: `https://en.wikipedia.org/wiki/${page}` });

/** Sources cited by `ClubKits.sources` (keys). Every colour claim traces to one of these. */
export const KIT_SOURCES: Record<string, KitSource> = {
  mbsg: WIKI('Mohun_Bagan_Super_Giant'),
  kbfc: WIKI('Kerala_Blasters_FC'),
  bfc: WIKI('Bengaluru_FC'),
  mcfc: WIKI('Mumbai_City_FC'),
  ebfc: WIKI('East_Bengal_Club'),
  fcg: WIKI('FC_Goa'),
  cfc: WIKI('Chennaiyin_FC'),
  cfcKit: {
    label: 'Sportskeeda: Chennaiyin FC 2021-22 kit (blue home, white away)',
    url: 'https://sportskeeda.com/indian-football/news-it-connects-past-present-fan-designed-chennaiyin-fc-s-jersey-isl-2021-22-outlines-thought-process',
  },
  ofc: {
    label: 'Odisha FC: home colours are black and purple',
    url: 'https://www.odishafc.com/clubshop',
  },
  neufc: {
    label: 'Khel Now: NorthEast United jersey launch (red with black accents)',
    url: 'https://khelnow.com/football/indian-football-isl-northeast-united-jersey-launch',
  },
  pfc: WIKI('Punjab_FC'),
  cbsc: WIKI('Churchill_Brothers_SC'),
  kshi: WIKI('Inter_Kashi_FC'),
  scd: {
    label: 'Footy Headlines: SC Delhi 26-27 kits (single fan site, not confirmed by the club)',
    url: 'https://www.footyheadlines.com/1114769937/sc-delhi-26-27-home-away-third-kits-released.html',
  },
};

const theme = (t: Partial<KitTheme> & Pick<KitTheme, 'primary' | 'secondary' | 'numberColour'>): KitTheme => ({
  accent: null,
  outline: '#0b1220',
  pattern: 'solid',
  collar: null,
  sleeves: null,
  gradient: null,
  ...t,
});

/** Curated per preset team id. Seasons share the club's colour identity; see `unverified` for the gaps. */
const CLUB_KITS: Record<string, ClubKits> = {
  // Mohun Bagan Super Giant: green and maroon; away "predominantly white with green-maroon imprints".
  'isl-club-1874': {
    verification: 'documented',
    home: theme({ primary: '#0e7c42', secondary: '#7a1d3b', numberColour: '#ffffff', pattern: 'halves', outline: '#08210f' }),
    away: theme({ primary: '#f6f7f4', secondary: '#0e7c42', accent: '#7a1d3b', numberColour: '#0a4a27', pattern: 'piping', collar: '#7a1d3b', outline: '#334155' }),
    unverified: ['Exact hex values and the current season’s layout of the green and maroon.'],
    sources: ['mbsg'],
  },
  // Kerala Blasters: yellow and blue.
  'isl-club-498': {
    verification: 'documented',
    home: theme({ primary: '#f7c600', secondary: '#1d3fa8', numberColour: '#14308a', collar: '#1d3fa8', sleeves: null, outline: '#3b2f00' }),
    away: null,
    unverified: ['The current away kit (the only documented away kit is from 2023 and is not used).'],
    sources: ['kbfc'],
  },
  // Bengaluru FC: the club colour is blue. The secondary colour is not stated in the sources.
  'isl-club-656': {
    verification: 'partial',
    home: theme({
      primary: '#1f56c6',
      secondary: '#ffffff',
      accent: '#ffffff',
      numberColour: '#ffffff',
      pattern: 'gradient',
      gradient: { from: '#2f6ae0', to: '#123a8f' },
      collar: '#ffffff',
      outline: '#0a1f4d',
    }),
    away: null,
    unverified: ['Secondary colour (white used), away and third kits.'],
    sources: ['bfc'],
  },
  // Mumbai City FC: sky blue since 2020. The secondary colour is not stated in the sources.
  'isl-club-506': {
    verification: 'partial',
    home: theme({ primary: '#6cb8e8', secondary: '#0b2e5c', numberColour: '#0b2e5c', collar: '#0b2e5c', outline: '#0b3a66' }),
    away: null,
    unverified: ['Secondary colour (navy used), current away kit.'],
    sources: ['mcfc'],
  },
  // East Bengal: red (primary) and yellow (secondary).
  'isl-club-1102': {
    verification: 'documented',
    home: theme({ primary: '#d3161c', secondary: '#f9c80e', numberColour: '#111111', pattern: 'stripes', collar: '#111111', outline: '#3a0608' }),
    away: null,
    unverified: ['The away kit ("varies every year").'],
    sources: ['ebfc'],
  },
  // FC Goa: blue and orange; the main kit has been orange since 2017-18.
  'isl-club-496': {
    verification: 'partial',
    home: theme({ primary: '#ee6a1a', secondary: '#1b3f8b', numberColour: '#ffffff', collar: '#1b3f8b', sleeves: '#1b3f8b', outline: '#4a1d00' }),
    away: null,
    unverified: ['Trim colours of the current home kit and the current away kit.'],
    sources: ['fcg'],
  },
  // Chennaiyin FC: "traditional blue (home) and white (away)".
  'isl-club-505': {
    verification: 'partial',
    home: theme({ primary: '#1c55bd', secondary: '#ffffff', accent: '#ffffff', numberColour: '#ffffff', pattern: 'piping', collar: '#ffffff', outline: '#0a1f4d' }),
    away: theme({ primary: '#f6f7f8', secondary: '#1c55bd', accent: '#1c55bd', numberColour: '#143d8a', pattern: 'piping', collar: '#1c55bd', outline: '#334155' }),
    unverified: ['Secondary colours of the current season; shades are approximations.'],
    sources: ['cfc', 'cfcKit'],
  },
  // Odisha FC: the club states black and purple as its home colours.
  'isl-club-1499': {
    verification: 'documented',
    home: theme({ primary: '#17121f', secondary: '#7b2fbe', accent: '#7b2fbe', numberColour: '#ffffff', pattern: 'piping', collar: '#7b2fbe', sleeves: '#17121f', outline: '#000000' }),
    away: null,
    unverified: ['Away and third kits; the shop page is undated.'],
    sources: ['ofc'],
  },
  // NorthEast United: red with black accents (2026-27 launch report).
  'isl-club-504': {
    verification: 'partial',
    home: theme({ primary: '#d51f2a', secondary: '#111111', accent: '#111111', numberColour: '#ffffff', pattern: 'piping', collar: '#111111', outline: '#3a0608' }),
    away: null,
    unverified: ['Earlier seasons used a different palette; the away kit.'],
    sources: ['neufc'],
  },
  // Punjab FC: orange base "often paired with black or white accents"; away usually white.
  'isl-club-1252': {
    verification: 'partial',
    home: theme({
      primary: '#f28c1b',
      secondary: '#111111',
      numberColour: '#111111',
      pattern: 'gradient',
      gradient: { from: '#f6a13a', to: '#d8700a' },
      collar: '#111111',
      sleeves: '#111111',
      outline: '#3d2000',
    }),
    away: theme({ primary: '#f6f7f8', secondary: '#f28c1b', accent: '#111111', numberColour: '#111111', pattern: 'piping', collar: '#f28c1b', outline: '#334155' }),
    unverified: ['Which accent colour the current season uses; away trim colour.'],
    sources: ['pfc'],
  },
  // Churchill Brothers: a red home kit ("The Red Machines"); red-and-black crest.
  'isl-club-1101': {
    verification: 'partial',
    home: theme({ primary: '#c8102e', secondary: '#111111', numberColour: '#ffffff', collar: '#111111', sleeves: null, outline: '#3a0610' }),
    away: null,
    unverified: ['Secondary colour (black from the crest), away kit.'],
    sources: ['cbsc'],
  },
  // Inter Kashi: no kit colours found. Only the crest is described (red, black and white).
  'isl-club-2354': {
    verification: 'unverified',
    home: theme({ primary: '#b3202a', secondary: '#111111', numberColour: '#ffffff', pattern: 'panel', collar: '#111111', outline: '#2a0508' }),
    away: null,
    unverified: ['Every kit colour: taken from the description of the club crest (red, black and white), not from a kit.'],
    sources: ['kshi'],
  },
  // Sporting Club Delhi: red base, black and yellow trim; away off-white with gold and black panels (one fan site).
  'isl-club-3234': {
    verification: 'partial',
    home: theme({ primary: '#c8202b', secondary: '#111111', accent: '#f3c316', numberColour: '#ffffff', pattern: 'piping', collar: '#111111', outline: '#3a0608' }),
    away: theme({ primary: '#f2efe6', secondary: '#c9a227', accent: '#111111', numberColour: '#111111', pattern: 'panel', collar: '#111111', outline: '#334155' }),
    unverified: ['Both kits come from a single fan site and are not confirmed by the club.'],
    sources: ['scd'],
  },
};

/** Whether a preset team has jersey colours. Custom teams (no preset id) never do. */
export function hasKitTheme(presetId: string | null | undefined): boolean {
  return !!presetId && presetId in CLUB_KITS;
}

export function clubKits(presetId: string | null | undefined): ClubKits | null {
  return presetId ? (CLUB_KITS[presetId] ?? null) : null;
}

/** Every preset team id with a theme (used by tests and the dataset check). */
export function kitThemedPresetIds(): string[] {
  return Object.keys(CLUB_KITS);
}

// --- colour maths ------------------------------------------------------------------------------

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio between two `#rrggbb` colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function lab(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map(linear);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** Perceptual distance (CIE76 ΔE) between two colours; below ~30 they are easy to confuse on a pitch. */
export function colourDistance(a: string, b: string): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

const KIT_CLASH_DISTANCE = 30;

// --- resolution --------------------------------------------------------------------------------

export interface ResolvedKit {
  /** Stable key for the shared SVG definitions, e.g. `isl-club-1874-home`. */
  key: string;
  variant: KitVariant;
  theme: KitTheme;
  /** The away kit was derived (no documented away kit), so it is a generic stand-in, not an official kit. */
  isFallback: boolean;
  verification: KitVerification;
}

/** A plain stand-in away kit built from the home colours: a light shirt with the club's primary as trim. */
export function fallbackAwayKit(home: KitTheme): KitTheme {
  const light = luminance(home.primary) > 0.65;
  if (light) {
    return theme({ primary: '#1c2b4a', secondary: '#ffffff', accent: '#ffffff', numberColour: '#ffffff', pattern: 'piping', collar: '#ffffff', outline: '#050a14' });
  }
  return theme({
    primary: '#f4f5f6',
    secondary: home.primary,
    accent: home.primary,
    // The club colour when it reads well on the light shirt, otherwise near-black.
    numberColour: contrastRatio(home.primary, '#f4f5f6') >= 4.5 ? home.primary : '#111827',
    pattern: 'piping',
    collar: home.primary,
    outline: '#334155',
  });
}

export function kitFor(presetId: string | null | undefined, variant: KitVariant): ResolvedKit | null {
  const kits = clubKits(presetId);
  if (!kits || !presetId) return null;
  if (variant === 'home') return { key: `${presetId}-home`, variant, theme: kits.home, isFallback: false, verification: kits.verification };
  const documented = kits.away !== null;
  return {
    key: `${presetId}-away`,
    variant,
    theme: kits.away ?? fallbackAwayKit(kits.home),
    isFallback: !documented,
    verification: documented ? kits.verification : 'unverified',
  };
}

export interface KitChoices {
  home: ResolvedKit | null;
  away: ResolvedKit | null;
}

/**
 * The kit each side wears. An explicit choice wins; otherwise each side wears its home kit, except that the away
 * side switches to its away kit when the two home shirts would be hard to tell apart (so the sides always differ).
 */
export function chooseKits(
  home: { presetId: string | null | undefined; kit?: KitVariant },
  away: { presetId: string | null | undefined; kit?: KitVariant },
): KitChoices {
  const homeKit = kitFor(home.presetId, home.kit ?? 'home');
  let awayVariant: KitVariant = away.kit ?? 'home';
  if (away.kit === undefined && homeKit) {
    const tentative = kitFor(away.presetId, 'home');
    if (tentative && colourDistance(tentative.theme.primary, homeKit.theme.primary) < KIT_CLASH_DISTANCE) awayVariant = 'away';
  }
  return { home: homeKit, away: kitFor(away.presetId, awayVariant) };
}

/** True when the two sides' selected shirts are too similar to tell apart quickly (shown as a hint). */
export function kitsClash(a: ResolvedKit | null, b: ResolvedKit | null): boolean {
  return !!a && !!b && colourDistance(a.theme.primary, b.theme.primary) < KIT_CLASH_DISTANCE;
}

/** The colour behind the number, for halo selection: the number sits on the body and, for patterned shirts, both colours. */
export function numberBackdrops(t: KitTheme): string[] {
  if (t.pattern === 'halves' || t.pattern === 'stripes' || t.pattern === 'panel') return [t.primary, t.secondary];
  return [t.primary];
}
