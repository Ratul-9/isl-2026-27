/**
 * Team preset maintenance CLI.
 *
 *   npm run presets -- fetch    [--season 2026-27] [--profiles] [--apply]
 *   npm run presets -- import   --file squads.csv|squads.json [--season 2026-27] [--league isl] [--apply]
 *   npm run presets -- validate [--file public/presets/isl/2026-27.json]
 *
 * Nothing is written without `--apply`; without it the command prints what would change. See
 * docs/TEAM_PRESETS.md for the full workflow, the manual JSON/CSV formats and the rules this
 * tool follows (robots.txt, rate limiting, no bypassing of access controls).
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { PresetManifest, SeasonPresets } from '@/domain/presets/types';
import { diffSeasons, formatDiff } from '@/presets/diff';
import { buildIslSeason, ISL_LEAGUE } from '@/presets/isl/build';
import type { IslProfileInput, IslSquadInput } from '@/presets/isl/build';
import { ISL_ORIGIN, parseClubList, parseFixtures, parsePlayerProfile, parseSquadPage } from '@/presets/isl/parse';
import { isAllowed, parseRobots } from '@/presets/isl/robots';
import type { Robots } from '@/presets/isl/robots';
import { mergeTeams, seasonFromCsv } from '@/presets/manual';
import { applyOverrides, overridesSchema } from '@/presets/overrides';
import type { OverrideReport, PresetOverrides } from '@/presets/overrides';
import { checkSeasonPresets } from '@/presets/quality';
import { buildReport } from '@/presets/report';
import { MANIFEST_FORMAT, parseManifest, parseSeasonPresets, PRESET_SCHEMA_VERSION } from '@/presets/schema';

/** The league publishes 13 clubs for 2026-27; a different count is reported, not assumed wrong. */
const EXPECTED_TEAMS: Record<string, number> = { isl: 13 };

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, 'public', 'presets');
const OVERRIDES_DIR = path.join(ROOT, 'data', 'presets');
const REPORT_DIR = path.join(ROOT, 'docs', 'presets');

const DEFAULT_USER_AGENT = 'DizPitchPresetImporter/1.0 (local, non-commercial tool; honours robots.txt; one request per second)';

class CliError extends Error {}

function log(message = '') {
  process.stdout.write(`${message}\n`);
}

function seasonFile(league: string, season: string) {
  return path.join(PUBLIC_DIR, league, `${season}.json`);
}

async function readJson(file: string): Promise<unknown | null> {
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}

async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

// --- polite fetching ---------------------------------------------------------------------------

interface FetchOptions {
  userAgent: string;
  delayMs: number;
  cacheDir: string;
  refresh: boolean;
  offline: boolean;
}

interface Page {
  html: string;
  url: string;
  retrievedAt: string;
  fromCache: boolean;
}

class PoliteFetcher {
  private robots: Robots | null = null;
  private lastRequestAt = 0;
  requests = 0;

  constructor(private readonly options: FetchOptions) {}

  get delayMs() {
    return this.options.delayMs;
  }

  async init() {
    const page = await this.fetchRaw(`${ISL_ORIGIN}/robots.txt`, { skipRobots: true, allow404: true });
    this.robots = page ? parseRobots(page.html, this.options.userAgent) : { rules: [], crawlDelaySeconds: null, sitemaps: [] };
    const declared = this.robots.crawlDelaySeconds;
    if (declared !== null && declared * 1000 > this.options.delayMs) {
      this.options.delayMs = declared * 1000;
      log(`robots.txt asks for a ${declared}s crawl delay; using it.`);
    }
  }

  async get(urlOrPath: string): Promise<Page> {
    const url = new URL(urlOrPath, ISL_ORIGIN);
    if (url.origin !== ISL_ORIGIN) throw new CliError(`Refusing to fetch ${url.origin}: only ${ISL_ORIGIN} is allowed.`);
    const page = await this.fetchRaw(url.toString(), { skipRobots: false, allow404: false });
    if (!page) throw new CliError(`Could not fetch ${url}.`);
    return page;
  }

  private async fetchRaw(url: string, opts: { skipRobots: boolean; allow404: boolean }): Promise<Page | null> {
    const parsed = new URL(url);
    if (!opts.skipRobots && this.robots && !isAllowed(this.robots, `${parsed.pathname}${parsed.search}`)) {
      throw new CliError(`robots.txt disallows ${parsed.pathname}; refusing to fetch it.`);
    }
    const key = createHash('sha1').update(url).digest('hex');
    const bodyFile = path.join(this.options.cacheDir, `${key}.html`);
    const metaFile = path.join(this.options.cacheDir, `${key}.json`);
    if (!this.options.refresh && existsSync(bodyFile) && existsSync(metaFile)) {
      const meta = JSON.parse(await readFile(metaFile, 'utf8')) as { retrievedAt: string };
      return { html: await readFile(bodyFile, 'utf8'), url, retrievedAt: meta.retrievedAt, fromCache: true };
    }
    if (this.options.offline) throw new CliError(`--offline was given but ${url} is not in the cache.`);

    const wait = this.lastRequestAt + this.options.delayMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    let response: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      this.lastRequestAt = Date.now();
      this.requests += 1;
      response = await fetch(url, {
        headers: { 'user-agent': this.options.userAgent, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en' },
        signal: AbortSignal.timeout(30_000),
        redirect: 'follow',
      });
      if (response.status < 500) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    if (!response) return null;
    if (response.status === 404 && opts.allow404) return null;
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      throw new CliError(
        `${url} answered HTTP ${response.status}. The site is refusing automated access, and this tool does not try to get around that. ` +
          'Use the manual import instead (docs/TEAM_PRESETS.md) or ask the league for the data.',
      );
    }
    if (!response.ok) throw new CliError(`${url} answered HTTP ${response.status}.`);

    const html = await response.text();
    const retrievedAt = new Date().toISOString();
    await mkdir(this.options.cacheDir, { recursive: true });
    await writeFile(bodyFile, html, 'utf8');
    await writeFile(metaFile, JSON.stringify({ url, retrievedAt }), 'utf8');
    return { html, url, retrievedAt, fromCache: false };
  }
}

// --- shared steps --------------------------------------------------------------------------------

async function loadOverrides(league: string, season: string): Promise<PresetOverrides | null> {
  const file = path.join(OVERRIDES_DIR, league, `${season}.overrides.json`);
  const raw = await readJson(file);
  if (raw === null) return null;
  const parsed = overridesSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CliError(`${path.relative(ROOT, file)} is not valid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  if (parsed.data.league !== league || parsed.data.season !== season) {
    throw new CliError(`${path.relative(ROOT, file)} is for ${parsed.data.league} ${parsed.data.season}, not ${league} ${season}.`);
  }
  return parsed.data;
}

async function loadExisting(league: string, season: string): Promise<SeasonPresets | null> {
  const raw = await readJson(seasonFile(league, season));
  if (raw === null) return null;
  const parsed = parseSeasonPresets(raw);
  if (!parsed.ok) {
    log(`Note: the existing ${league}/${season}.json is not valid and will be treated as absent:`);
    for (const e of parsed.errors) log(`  ${e}`);
    return null;
  }
  return parsed.value;
}

async function updateManifest(doc: SeasonPresets) {
  const file = path.join(PUBLIC_DIR, 'index.json');
  const raw = await readJson(file);
  const current = raw !== null ? parseManifest(raw) : null;
  const seasons = current && current.ok ? current.value.seasons.filter((s) => !(s.league.id === doc.league.id && s.season === doc.season)) : [];
  seasons.push({
    league: doc.league,
    season: doc.season,
    file: `${doc.league.id}/${doc.season}.json`,
    teams: doc.teams.length,
    players: doc.teams.reduce((n, t) => n + t.players.length, 0),
    generatedAt: doc.generatedAt,
  });
  seasons.sort((a, b) => a.league.id.localeCompare(b.league.id) || b.season.localeCompare(a.season));
  const manifest: PresetManifest = { format: MANIFEST_FORMAT, schemaVersion: PRESET_SCHEMA_VERSION, seasons };
  await writeJson(file, manifest);
}

/** Validates, previews and (with --apply) writes a candidate season. Returns the process exit code. */
async function finish(args: {
  candidate: SeasonPresets;
  previous: SeasonPresets | null;
  overrides: OverrideReport | null;
  problems: string[];
  apply: boolean;
  force: boolean;
}): Promise<number> {
  const { candidate, previous, overrides, problems, apply } = args;
  const league = candidate.league.id;

  const schema = parseSeasonPresets(candidate);
  if (!schema.ok) {
    log('The candidate data does not match the preset schema:');
    for (const e of schema.errors) log(`  ${e}`);
    return 1;
  }

  const issues = checkSeasonPresets(candidate, { expectedTeams: EXPECTED_TEAMS[league] });
  for (const p of problems) issues.push({ severity: 'error', code: 'source-problem', message: p });
  const errors = issues.filter((i) => i.severity === 'error');
  const diff = diffSeasons(previous, candidate);

  log(`\n${candidate.league.name} ${candidate.season}: ${candidate.teams.length} teams, ${candidate.teams.reduce((n, t) => n + t.players.length, 0)} players.`);
  log(`Warnings: ${issues.length - errors.length}. Blocking errors: ${errors.length}.`);
  for (const e of errors) log(`  ERROR ${e.message}`);
  log('\nChanges against the current file:');
  for (const line of formatDiff(diff)) log(`  ${line}`);

  const report = buildReport({ doc: candidate, issues, diff, overrides, applied: apply && errors.length === 0, expectedTeams: EXPECTED_TEAMS[league] });

  if (!apply) {
    log('\nPreview only. Re-run with --apply to write the files.');
    return errors.length > 0 ? 1 : 0;
  }
  if (errors.length > 0) {
    log('\nNot applied: fix the blocking errors above first.');
    return 1;
  }
  if (!diff.isNew && diff.changeCount === 0 && !args.force) {
    log('\nNothing to apply (the data is unchanged).');
    return 0;
  }

  await writeJson(seasonFile(league, candidate.season), candidate);
  await updateManifest(candidate);
  await mkdir(REPORT_DIR, { recursive: true });
  const reportFile = path.join(REPORT_DIR, `${league}-${candidate.season}-import-report.md`);
  await writeFile(reportFile, report, 'utf8');
  log(`\nWrote ${path.relative(ROOT, seasonFile(league, candidate.season))}, ${path.relative(ROOT, path.join(PUBLIC_DIR, 'index.json'))} and ${path.relative(ROOT, reportFile)}.`);
  return 0;
}

// --- commands --------------------------------------------------------------------------------------

async function commandFetch(values: Record<string, string | boolean | undefined>): Promise<number> {
  const userAgent = process.env.PRESET_USER_AGENT || DEFAULT_USER_AGENT;
  const fetcher = new PoliteFetcher({
    userAgent,
    delayMs: Math.max(500, Number(values['delay-ms'] ?? 1000)),
    cacheDir: path.resolve(String(values['cache-dir'] ?? path.join(ROOT, '.cache', 'presets'))),
    refresh: Boolean(values.refresh),
    offline: Boolean(values.offline),
  });
  await fetcher.init();

  log('Reading the club list and the fixtures page…');
  const home = await fetcher.get('/');
  const clubs = parseClubList(home.html);
  const fixtures = await fetcher.get('/schedule-fixtures');
  const info = parseFixtures(fixtures.html);

  const seasonsOnSite = [...new Set(info.seasons.values())].sort();
  const season = String(values.season ?? seasonsOnSite[seasonsOnSite.length - 1]);
  if (!seasonsOnSite.includes(season)) {
    throw new CliError(`The site's fixtures name season(s) ${seasonsOnSite.join(', ')}, not ${season}. Refusing to import a season the site does not show.`);
  }
  log(`Season on the site: ${season}. Clubs listed: ${clubs.length}.`);

  const squads: IslSquadInput[] = [];
  const problems: string[] = [];
  const sources = [
    { name: 'ISL club switcher', url: home.url, retrievedAt: home.retrievedAt },
    { name: 'ISL fixtures (season and abbreviations)', url: fixtures.url, retrievedAt: fixtures.retrievedAt },
  ];

  for (const club of clubs) {
    const page = await fetcher.get(`${club.path}/squad`);
    const parsed = parseSquadPage(page.html);
    log(`  ${club.name}: ${parsed.players.length} players${page.fromCache ? ' (cached)' : ''}`);
    squads.push({ club, page: parsed, url: page.url, retrievedAt: page.retrievedAt });
    sources.push({ name: `${club.name} squad`, url: page.url, retrievedAt: page.retrievedAt });
  }

  const inFixtures = new Set(info.abbreviations.keys());
  for (const club of clubs) {
    if (!inFixtures.has(club.sourceId)) problems.push(`${club.name} is in the club switcher but does not appear in the ${season} fixtures.`);
  }

  const profiles = new Map<string, IslProfileInput>();
  if (values.profiles) {
    const all = squads.flatMap((s) => s.page.players.filter((p) => p.profileUrl !== null));
    log(`Reading ${all.length} player profile pages for dates of birth (one request per ${fetcher.delayMs} ms)…`);
    let done = 0;
    for (const p of all) {
      try {
        const page = await fetcher.get(p.profileUrl as string);
        profiles.set(p.sourceId, { profile: parsePlayerProfile(page.html, p.sourceId), url: page.url, retrievedAt: page.retrievedAt });
      } catch (error) {
        if (error instanceof CliError && /refusing automated access|robots\.txt/.test(error.message)) throw error;
        log(`  ! ${p.fullName}: ${(error as Error).message}`);
      }
      done += 1;
      if (done % 50 === 0) log(`  …${done}/${all.length}`);
    }
    sources.push({ name: 'ISL player profiles (date of birth)', url: `${ISL_ORIGIN}/players`, retrievedAt: new Date().toISOString() });
  } else {
    log('Skipping player profile pages (no dates of birth). Add --profiles to read them.');
  }
  log(`Network requests made: ${fetcher.requests}.`);

  const built = buildIslSeason({
    season,
    fixtures: info,
    squads,
    profiles,
    generatedAt: new Date().toISOString(),
    generator: `scripts/presets.ts fetch (${ISL_LEAGUE.id})`,
    sources,
  });

  const previous = await loadExisting(ISL_LEAGUE.id, season);
  // Dates of birth already on file are kept when this run did not read profiles, so a quick refresh
  // never erases what an earlier --profiles run found.
  let candidate = built.doc;
  if (!values.profiles && previous) candidate = carryForwardDatesOfBirth(candidate, previous);

  const overrides = await loadOverrides(ISL_LEAGUE.id, season);
  let overrideReport: OverrideReport | null = null;
  if (overrides) {
    const applied = applyOverrides(candidate, overrides);
    candidate = applied.doc;
    overrideReport = applied.report;
  }
  return finish({ candidate, previous, overrides: overrideReport, problems: [...problems, ...built.problems], apply: Boolean(values.apply), force: Boolean(values.force) });
}

function carryForwardDatesOfBirth(next: SeasonPresets, previous: SeasonPresets): SeasonPresets {
  const known = new Map(previous.teams.flatMap((t) => t.players).map((p) => [p.id, p.dateOfBirth]));
  return {
    ...next,
    teams: next.teams.map((t) => ({
      ...t,
      players: t.players.map((p) => (p.dateOfBirth === null && known.get(p.id) ? { ...p, dateOfBirth: known.get(p.id) ?? null } : p)),
    })),
  };
}

async function commandImport(values: Record<string, string | boolean | undefined>): Promise<number> {
  const file = values.file ? path.resolve(String(values.file)) : null;
  if (!file) throw new CliError('Give the file to import with --file (a .csv or a season .json).');
  const text = await readFile(file, 'utf8');
  const league = String(values.league ?? ISL_LEAGUE.id);
  const leagueName = league === ISL_LEAGUE.id ? ISL_LEAGUE.name : String(values['league-name'] ?? league.toUpperCase());
  const now = new Date().toISOString();

  let incoming: SeasonPresets;
  if (file.endsWith('.csv')) {
    const season = String(values.season ?? '');
    if (!/^\d{4}-\d{2}$/.test(season)) throw new CliError('A CSV import needs --season, for example --season 2026-27.');
    const result = seasonFromCsv(text, { league: { id: league, name: leagueName }, season, now, fileName: path.basename(file) });
    if (!result.doc) {
      log('The CSV could not be imported:');
      for (const e of result.errors.slice(0, 30)) log(`  ${e}`);
      return 1;
    }
    incoming = result.doc;
  } else {
    const parsed = parseSeasonPresets(JSON.parse(text) as unknown);
    if (!parsed.ok) {
      log('The JSON file does not match the preset schema:');
      for (const e of parsed.errors) log(`  ${e}`);
      return 1;
    }
    incoming = parsed.value;
  }

  const previous = await loadExisting(incoming.league.id, incoming.season);
  let candidate = mergeTeams(previous, incoming);
  const overrides = await loadOverrides(candidate.league.id, candidate.season);
  let overrideReport: OverrideReport | null = null;
  if (overrides) {
    const applied = applyOverrides(candidate, overrides);
    candidate = applied.doc;
    overrideReport = applied.report;
  }
  return finish({ candidate, previous, overrides: overrideReport, problems: [], apply: Boolean(values.apply), force: Boolean(values.force) });
}

async function commandValidate(values: Record<string, string | boolean | undefined>): Promise<number> {
  const files: string[] = [];
  if (values.file) files.push(path.resolve(String(values.file)));
  else {
    const manifest = await readJson(path.join(PUBLIC_DIR, 'index.json'));
    const parsed = manifest === null ? null : parseManifest(manifest);
    if (!parsed || !parsed.ok) throw new CliError('public/presets/index.json is missing or invalid. Run `npm run presets -- fetch --apply` first.');
    for (const s of parsed.value.seasons) files.push(path.join(PUBLIC_DIR, s.file));
  }
  let failed = false;
  for (const file of files) {
    const raw = await readJson(file);
    if (raw === null) {
      log(`${path.relative(ROOT, file)}: not found.`);
      failed = true;
      continue;
    }
    const parsed = parseSeasonPresets(raw);
    if (!parsed.ok) {
      log(`${path.relative(ROOT, file)}: INVALID`);
      for (const e of parsed.errors) log(`  ${e}`);
      failed = true;
      continue;
    }
    const issues = checkSeasonPresets(parsed.value, { expectedTeams: EXPECTED_TEAMS[parsed.value.league.id] });
    const errors = issues.filter((i) => i.severity === 'error');
    log(`${path.relative(ROOT, file)}: ${parsed.value.teams.length} teams, ${errors.length} errors, ${issues.length - errors.length} warnings.`);
    for (const e of errors) log(`  ERROR ${e.message}`);
    if (errors.length > 0) failed = true;
  }
  return failed ? 1 : 0;
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      season: { type: 'string' },
      league: { type: 'string' },
      'league-name': { type: 'string' },
      file: { type: 'string' },
      profiles: { type: 'boolean' },
      apply: { type: 'boolean' },
      force: { type: 'boolean' },
      refresh: { type: 'boolean' },
      offline: { type: 'boolean' },
      'cache-dir': { type: 'string' },
      'delay-ms': { type: 'string' },
    },
    allowPositionals: false,
  });
  switch (command) {
    case 'fetch':
      return commandFetch(values);
    case 'import':
      return commandImport(values);
    case 'validate':
      return commandValidate(values);
    default:
      log('Usage: npm run presets -- <fetch|import|validate> [options]   (see docs/TEAM_PRESETS.md)');
      return command ? 1 : 0;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof CliError ? error.message : error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  },
);
