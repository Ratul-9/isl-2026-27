'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PresetManifest, PresetManifestEntry, SeasonPresets } from '@/domain/presets/types';
import { loadManifest, loadSeason } from '@/presets/client';
import type { PresetLoadResult } from '@/presets/client';

export interface PresetDeps {
  loadManifest: () => Promise<PresetLoadResult<PresetManifest>>;
  loadSeason: (entry: PresetManifestEntry) => Promise<PresetLoadResult<SeasonPresets>>;
}

export const defaultPresetDeps: PresetDeps = {
  loadManifest: () => loadManifest(),
  loadSeason: (entry) => loadSeason(entry),
};

export type CatalogFailure = { kind: 'not-imported' | 'unreachable' | 'invalid'; message: string; details?: string[] };

export type SeasonState =
  | { status: 'loading' }
  | { status: 'ready'; value: SeasonPresets }
  | ({ status: 'error' } & CatalogFailure);

export type CatalogState =
  | { status: 'loading' }
  | ({ status: 'unavailable' } & CatalogFailure)
  | { status: 'ready'; manifest: PresetManifest };

export const entryKey = (e: PresetManifestEntry) => `${e.league.id}/${e.season}`;

/**
 * Loads the preset index and, for the chosen season, its teams. Nothing is cached across mounts:
 * the files are static and small, and re-reading means a fresh import is seen immediately.
 */
export function usePresetCatalog(deps: PresetDeps = defaultPresetDeps) {
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading' });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [season, setSeason] = useState<SeasonState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await deps.loadManifest();
      if (cancelled) return;
      if (!result.ok) {
        setCatalog({ status: 'unavailable', kind: result.kind, message: result.message, details: result.details });
      } else if (result.value.seasons.length === 0) {
        setCatalog({ status: 'unavailable', kind: 'not-imported', message: 'The preset index lists no seasons yet.' });
      } else {
        setCatalog({ status: 'ready', manifest: result.value });
        setSelectedKey((current) => current ?? entryKey(result.value.seasons[0]));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deps, attempt]);

  const entry =
    catalog.status === 'ready' ? (catalog.manifest.seasons.find((e) => entryKey(e) === selectedKey) ?? catalog.manifest.seasons[0]) : null;
  const wantedKey = entry ? entryKey(entry) : null;

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    void (async () => {
      const result = await deps.loadSeason(entry);
      if (cancelled) return;
      setSeason(result.ok ? { status: 'ready', value: result.value } : { status: 'error', kind: result.kind, message: result.message, details: result.details });
    })();
    return () => {
      cancelled = true;
    };
    // `entry` is derived from the manifest + key; the key is the identity that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps, wantedKey, attempt]);

  const retry = useCallback(() => {
    setCatalog({ status: 'loading' });
    setSeason({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  const select = useCallback((key: string) => {
    setSeason({ status: 'loading' });
    setSelectedKey(key);
  }, []);

  return { catalog, season, selectedKey: wantedKey, select, retry };
}
