/**
 * Parsers for the official Indian Super League website (https://www.indiansuperleague.com).
 *
 * They read ONLY what a visitor's browser receives for the public club, squad and player pages
 * (the server-rendered HTML, including the widget data embedded in that same document). They never
 * call the site's `/api` or `/apiv3` endpoints, which its robots.txt disallows.
 *
 * Pure string → value functions: no network, no files. Every function fails with a message that
 * says what was missing, so a site redesign is reported instead of silently producing bad data.
 */

export const ISL_ORIGIN = 'https://www.indiansuperleague.com';

export class IslParseError extends Error {}

/** The substring of `text` that is the balanced JSON value starting at `start` (a `{` or `[`). */
function balancedJson(text: string, start: number): string {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new IslParseError('Unterminated JSON value in the page.');
}

function jsonAfter(html: string, marker: string): unknown | null {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.slice(at + marker.length).search(/[{[]/);
  if (start < 0) return null;
  const from = at + marker.length + start;
  try {
    return JSON.parse(balancedJson(html, from));
  } catch (error) {
    throw new IslParseError(`Could not read the embedded data after "${marker}": ${(error as Error).message}`);
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}

const clean = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
const orNull = (value: unknown): string | null => clean(value) || null;

/**
 * Absolute URL on the site for a site-relative path, without the cache-buster it appends to static
 * assets (`?v=103.31` or a bare `?103.31`; it changes on every deploy and would churn every refresh).
 */
export function absoluteUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  try {
    const url = new URL(path, ISL_ORIGIN);
    if (url.pathname.startsWith('/static-assets/')) url.search = '';
    else url.searchParams.delete('v');
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

// --- clubs and season -------------------------------------------------------------------------

export interface IslClubLink {
  sourceId: string;
  name: string;
  /** Path of the club overview page, e.g. `/clubs/656-bengaluru-fc-profile`. */
  path: string;
}

/** The clubs listed in the site's club switcher (the same list on every page). */
export function parseClubList(html: string): IslClubLink[] {
  const clubs = new Map<string, IslClubLink>();
  const re = /<a href="(\/clubs\/(\d+)-[a-z0-9-]+-profile)"[^>]*title="([^"]+)"[^>]*class="club-anchor"/g;
  for (const m of html.matchAll(re)) {
    clubs.set(m[2], { sourceId: m[2], name: clean(decodeEntities(m[3])), path: m[1] });
  }
  if (clubs.size === 0) throw new IslParseError('No clubs found in the club switcher (the page layout may have changed).');
  return [...clubs.values()];
}

export interface IslFixturesInfo {
  /** `{series_id: "2026-27"}` for every series named on the page. */
  seasons: Map<string, string>;
  /** Club source id → official abbreviation as printed on fixtures (e.g. `BFC`). */
  abbreviations: Map<string, { name: string; abbreviation: string }>;
}

/** Season label(s) and club abbreviations from the fixtures page. */
export function parseFixtures(html: string): IslFixturesInfo {
  const seasons = new Map<string, string>();
  for (const m of html.matchAll(/"series_id":"(\d+)","tour_name":"[^"]*","series_name":"([^"]+)"/g)) {
    const label = /(\d{4})-(\d{2})\b/.exec(m[2]);
    if (label) seasons.set(m[1], `${label[1]}-${label[2]}`);
  }
  const abbreviations = new Map<string, { name: string; abbreviation: string }>();
  for (const m of html.matchAll(/"name":"([^"]+)","short_name":"([^"]+)","id":"(\d+)"/g)) {
    abbreviations.set(m[3], { name: clean(m[1]), abbreviation: clean(m[2]) });
  }
  if (seasons.size === 0) throw new IslParseError('The fixtures page does not name a season.');
  return { seasons, abbreviations };
}

// --- squad page -------------------------------------------------------------------------------

interface IslSquadPlayer {
  sourceId: string;
  fullName: string;
  shortName: string | null;
  /** `Goalkeeper` / `Defender` / `Midfielder` / `Forward` as published, or the raw text. */
  positionName: string | null;
  nationality: string | null;
  /** The number displayed on the squad card; null when unpublished (the site uses -1/0). */
  shirtNumber: number | null;
  /** The raw card text, kept for the audit trail. */
  shirtNumberText: string | null;
  headshotUrl: string | null;
  profileUrl: string | null;
}

interface IslStaffMember {
  sourceId: string | null;
  name: string;
  role: string;
  nationality: string | null;
  photoUrl: string | null;
}

export interface IslSquadPage {
  clubSourceId: string;
  clubName: string;
  /** The competition series the squad belongs to (matches `IslFixturesInfo.seasons`). */
  seriesId: string | null;
  venue: string | null;
  logoUrl: string | null;
  officialSiteUrl: string | null;
  players: IslSquadPlayer[];
  staff: IslStaffMember[];
  /** Things that looked wrong but did not stop parsing (e.g. a squad entry without a card). */
  warnings: string[];
}

interface RawWidgetPlayer {
  player_id: number | string;
  full_name?: string;
  short_name?: string;
  player_short_name?: string;
  position_name?: string;
  country_name?: string;
  jersey_number?: number | string | null;
}

interface RawWidgetStaff {
  player_id?: number | string | null;
  short_name?: string;
  full_name?: string;
  role_name?: string;
  country_name?: string;
}

interface Card {
  numberText: string;
  imagePath: string | null;
  profilePath: string | null;
  isStaff: boolean;
}

const PLACEHOLDER_IMAGE = /lazy-load|placeholder|default/i;

function parseCards(html: string): Map<string, Card> {
  const cards = new Map<string, Card>();
  // Each card is a `squad-item`; the next one (or the end of the list) delimits it.
  const parts = html.split('<div class="swiper-slide squad-item').slice(1);
  for (const part of parts) {
    const chunk = part.slice(0, 2500);
    const profile = /href="(\/players\/(?:goalkeeper|defender|midfielder|forward)-(\d+)-[^"]*)"/.exec(chunk);
    const image = /<img src="([^"]+)"/.exec(chunk);
    const number = /<span class="player-number">([^<]*)<\/span>/.exec(chunk);
    const isStaff = /staff-members/.test(part.slice(0, 120));
    const imagePath = image && !PLACEHOLDER_IMAGE.test(image[1]) ? image[1] : null;
    if (profile) {
      cards.set(profile[2], { numberText: clean(number?.[1]), imagePath, profilePath: profile[1], isStaff });
    } else if (isStaff && imagePath) {
      // Staff cards link nowhere; they are matched by the id in their image name.
      const id = /\/(\d+)\.[a-z]+/i.exec(imagePath);
      if (id) cards.set(`staff:${id[1]}`, { numberText: '', imagePath, profilePath: null, isStaff: true });
    }
  }
  return cards;
}

export function parseSquadPage(html: string): IslSquadPage {
  const widget = jsonAfter(html, 'window.squadDetailsWidgetData = ') as Record<string, unknown> | null;
  if (!widget) throw new IslParseError('The squad widget data is missing (the page layout may have changed).');

  const source = (widget.sourceObjectDetails ?? {}) as Record<string, unknown>;
  const clubSourceId = clean(source.source_object_id);
  const clubName = clean(source.source_object_entity_display_name);
  if (!clubSourceId || !clubName) throw new IslParseError('The squad page does not identify its club.');

  const raw = (widget.rawData ?? {}) as { players?: RawWidgetPlayer[] };
  const rawPlayers = Array.isArray(raw.players) ? raw.players : [];
  const rawStaff = (Array.isArray(widget.supportStaff) ? widget.supportStaff : []) as RawWidgetStaff[];

  const warnings: string[] = [];
  const cards = parseCards(html);

  const players: IslSquadPlayer[] = [];
  for (const p of rawPlayers) {
    const sourceId = clean(String(p.player_id ?? ''));
    if (!/^\d+$/.test(sourceId)) {
      warnings.push(`A squad entry without a usable player id was skipped (${clean(p.full_name) || 'unnamed'}).`);
      continue;
    }
    const card = cards.get(sourceId);
    if (!card) warnings.push(`${clean(p.full_name) || sourceId}: listed in the squad data but has no card on the page (no headshot or profile link).`);
    const cardNumber = card?.numberText ?? String(p.jersey_number ?? '');
    const numeric = /^-?\d+$/.test(cardNumber) ? Number(cardNumber) : NaN;
    players.push({
      sourceId,
      fullName: clean(p.full_name) || clean(p.player_short_name) || clean(p.short_name),
      shortName: orNull(p.short_name) && clean(p.short_name) !== clean(p.full_name) ? clean(p.short_name) : null,
      positionName: orNull(p.position_name),
      nationality: orNull(p.country_name),
      shirtNumber: Number.isInteger(numeric) && numeric > 0 ? numeric : null,
      shirtNumberText: cardNumber || null,
      headshotUrl: absoluteUrl(card?.imagePath),
      profileUrl: absoluteUrl(card?.profilePath),
    });
  }

  const staff: IslStaffMember[] = rawStaff
    .map((s): IslStaffMember => {
      const sourceId = s.player_id !== undefined && s.player_id !== null ? clean(String(s.player_id)) : null;
      const card = sourceId ? cards.get(`staff:${sourceId}`) : undefined;
      return {
        sourceId,
        name: clean(s.full_name) || clean(s.short_name),
        role: clean(s.role_name),
        nationality: orNull(s.country_name),
        photoUrl: absoluteUrl(card?.imagePath),
      };
    })
    .filter((s) => s.name !== '');

  const seriesMatch = /"squad_filter":\{"series_id":"(\d+)"/.exec(html);
  const venueMatch = /class="card-content-item venue"><p class="label"><\/p> <p class="text">([^<]*)</.exec(html);
  const logoMatch = new RegExp(`/static-assets/images/club/${clubSourceId}\\.png[^"]*`).exec(html);
  const siteMatch = /href="(https?:\/\/[^"]+)"[^>]*title="Official website[^"]*"/i.exec(html);

  return {
    clubSourceId,
    clubName,
    seriesId: seriesMatch ? seriesMatch[1] : null,
    venue: venueMatch ? orNull(decodeEntities(venueMatch[1])) : null,
    logoUrl: absoluteUrl(logoMatch?.[0]),
    officialSiteUrl: siteMatch ? siteMatch[1] : null,
    players,
    staff,
    warnings,
  };
}

// --- player profile ---------------------------------------------------------------------------

export interface IslPlayerProfile {
  sourceId: string;
  fullName: string | null;
  /** ISO `YYYY-MM-DD`, or null when absent or implausible. */
  dateOfBirth: string | null;
  nationality: string | null;
  notes: string[];
}

/** `DD-MM-YYYY[ HH:mm:ss]` (the format the site uses) → `YYYY-MM-DD`, or null. */
export function parseSiteDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})(?:\s+\d{2}:\d{2}:\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  // A footballer born before 1950 or after 2015 is far more likely a placeholder than a fact.
  if (year < 1950 || year > 2015) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Reads the biography from a profile page. Some profiles ship an empty `pagePlayerData` in their
 * server-rendered HTML (the browser would fetch it later from a data API this importer does not
 * call); those return no date of birth and a note, not an error.
 */
export function parsePlayerProfile(html: string, expectedSourceId?: string): IslPlayerProfile {
  const marker = '"pagePlayerData":';
  let bio: Record<string, unknown> | undefined;
  for (let at = html.indexOf(marker); at >= 0 && !bio; at = html.indexOf(marker, at + marker.length)) {
    const data = jsonAfter(html.slice(at), marker) as { bio?: Record<string, unknown> } | null;
    if (data?.bio && typeof data.bio === 'object') bio = data.bio;
  }
  if (!bio) {
    if (!expectedSourceId) throw new IslParseError('The player profile has no biography data (the page layout may have changed).');
    return {
      sourceId: expectedSourceId,
      fullName: null,
      dateOfBirth: null,
      nationality: null,
      notes: ['The profile page has no biography data in its server-rendered HTML, so no date of birth is available.'],
    };
  }
  const sourceId = clean(String(bio.player_id ?? ''));
  if (!/^\d+$/.test(sourceId)) throw new IslParseError('The player profile has no player id.');
  if (expectedSourceId && sourceId !== expectedSourceId) {
    throw new IslParseError(`The profile page is for player ${sourceId}, not ${expectedSourceId}.`);
  }
  const notes: string[] = [];
  const rawDob = bio.date_of_birth;
  const dateOfBirth = parseSiteDate(rawDob);
  if (rawDob && dateOfBirth === null) notes.push(`Date of birth "${String(rawDob)}" was not usable and was ignored.`);
  return { sourceId, fullName: orNull(bio.full_name), dateOfBirth, nationality: orNull(bio.nationality), notes };
}
