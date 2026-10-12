'use client';

import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { createBrowserRepository } from './repository';
import type { BrowserRepository, MatchRepository } from './repository';

const RepositoryContext = createContext<BrowserRepository | null>(null);

/**
 * Provides the match repository. Must be rendered on the client only (it
 * touches `localStorage`); tests pass an explicit `value`.
 */
export function RepositoryProvider({ value, children }: { value?: BrowserRepository; children: ReactNode }) {
  const [repo] = useState<BrowserRepository>(() => value ?? createBrowserRepository());
  return <RepositoryContext.Provider value={repo}>{children}</RepositoryContext.Provider>;
}

export function useRepository(): MatchRepository {
  const ctx = useContext(RepositoryContext);
  if (!ctx) throw new Error('useRepository must be used inside <RepositoryProvider>.');
  return ctx.repository;
}

/** For components that also work without persistence (e.g. in tests). */
export function useOptionalRepository(): MatchRepository | null {
  return useContext(RepositoryContext)?.repository ?? null;
}

/** Why storage fell back to memory, or null when it is working. */
export function useStorageNotice(): string | null {
  return useContext(RepositoryContext)?.notice ?? null;
}
