import type { PresetManifest, PresetManifestEntry, SeasonPresets } from '@/domain/presets/types';
import { parseManifest, parseSeasonPresets } from './schema';

/**
 * Browser-side loader for the imported presets (`public/presets/**`, served as static files).
 * Everything is validated with the same zod schema the importer used. A missing manifest is a
 * distinct, expected state ("not imported yet") rather than an error.
 */

const PRESET_BASE_PATH = '/presets';

export type PresetLoadResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: 'not-imported' | 'unreachable' | 'invalid'; message: string; details?: string[] };

type FetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

async function getJson(fetchFn: FetchLike, url: string): Promise<PresetLoadResult<unknown>> {
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchFn(url, { cache: 'no-cache' });
  } catch {
    return { ok: false, kind: 'unreachable', message: 'The team preset files could not be loaded. Check your connection and try again.' };
  }
  if (response.status === 404) return { ok: false, kind: 'not-imported', message: 'The team presets have not been imported yet.' };
  if (!response.ok) {
    return { ok: false, kind: 'unreachable', message: `The team preset files could not be loaded (HTTP ${response.status}).` };
  }
  try {
    return { ok: true, value: await response.json() };
  } catch {
    return { ok: false, kind: 'invalid', message: 'The team preset file is not valid JSON.' };
  }
}

export async function loadManifest(fetchFn: FetchLike = fetch): Promise<PresetLoadResult<PresetManifest>> {
  const raw = await getJson(fetchFn, `${PRESET_BASE_PATH}/index.json`);
  if (!raw.ok) return raw;
  const parsed = parseManifest(raw.value);
  return parsed.ok
    ? { ok: true, value: parsed.value }
    : { ok: false, kind: 'invalid', message: 'The preset index is not valid.', details: parsed.errors };
}

export async function loadSeason(entry: PresetManifestEntry, fetchFn: FetchLike = fetch): Promise<PresetLoadResult<SeasonPresets>> {
  const raw = await getJson(fetchFn, `${PRESET_BASE_PATH}/${entry.file}`);
  if (!raw.ok) {
    // The index names a file that is not there: that is a broken import, not "never imported".
    return raw.kind === 'not-imported'
      ? { ok: false, kind: 'invalid', message: `The preset index lists ${entry.file}, but that file is missing.` }
      : raw;
  }
  const parsed = parseSeasonPresets(raw.value);
  return parsed.ok
    ? { ok: true, value: parsed.value }
    : { ok: false, kind: 'invalid', message: `${entry.league.name} ${entry.season} is not a valid preset file.`, details: parsed.errors };
}
