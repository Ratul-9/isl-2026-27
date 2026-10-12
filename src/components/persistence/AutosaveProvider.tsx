'use client';

import { createContext, useCallback, useContext, useEffect, useEffectEvent, useState } from 'react';
import type { ReactNode } from 'react';
import type { Match } from '@/domain/types';
import { useOptionalRepository } from '@/persistence/RepositoryContext';
import type { StorageFailure } from '@/persistence/repository';
import { useMatch } from '@/store/MatchContext';

/** Delay after the last change before writing; short enough to feel instant, long enough to batch typing. */
export const AUTOSAVE_DELAY_MS = 500;

type SaveStatus =
  | { state: 'saved'; savedAt: string | null }
  | { state: 'saving' }
  | { state: 'error'; error: StorageFailure }
  /** Storage is unavailable; changes live only in this tab. */
  | { state: 'session-only' };

interface SaveContextValue {
  status: SaveStatus;
  /** Writes the current match now (used by the Retry button). */
  saveNow: () => void;
}

const SaveContext = createContext<SaveContextValue | null>(null);

/** Null outside an autosaving workspace (e.g. component tests). */
export function useSaveStatus(): SaveContextValue | null {
  return useContext(SaveContext);
}

interface Persisted {
  match: Match;
  savedAt: string | null;
  error: StorageFailure | null;
}

/**
 * Writes the open match to the repository after changes. Status is derived:
 * "dirty" means the current match object differs from the last one written,
 * so there is no state to keep in sync. Failures never discard the in-memory
 * match; the user can retry or export.
 */
export function AutosaveProvider({ children }: { children: ReactNode }) {
  const repository = useOptionalRepository();
  const match = useMatch();
  const [persisted, setPersisted] = useState<Persisted>({ match, savedAt: null, error: null });
  const dirty = persisted.match !== match;

  const persist = useCallback(
    (target: Match) => {
      if (!repository) return;
      const result = repository.save(target);
      setPersisted((prev) =>
        result.ok ? { match: target, savedAt: result.savedAt, error: null } : { ...prev, error: result.error },
      );
    },
    [repository],
  );

  useEffect(() => {
    if (!repository || !dirty) return;
    const timer = setTimeout(() => persist(match), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [repository, dirty, match, persist]);

  // Don't wait for the debounce when the page is hidden/closed or the editor unmounts.
  // An Effect Event always sees the latest match, even from a long-lived listener.
  const flush = useEffectEvent(() => {
    if (repository && persisted.match !== match) persist(match);
  });
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    const onPageHide = () => flush();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      flush();
    };
  }, []);

  const status: SaveStatus = !repository
    ? { state: 'saved', savedAt: null }
    : persisted.error && dirty
      ? { state: 'error', error: persisted.error }
      : dirty
        ? { state: 'saving' }
        : !repository.persistent
          ? { state: 'session-only' }
          : { state: 'saved', savedAt: persisted.savedAt };

  return <SaveContext.Provider value={{ status, saveNow: () => persist(match) }}>{children}</SaveContext.Provider>;
}
