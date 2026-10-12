'use client';

import type { ReactNode } from 'react';
import { RepositoryProvider } from '@/persistence/RepositoryContext';
import { ClientOnly } from './ui/ClientOnly';

/**
 * Everything below here may use browser storage and random ids, so it only
 * renders on the client; the server HTML is a static loading message.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ClientOnly fallback={<p className="p-6 text-sm text-zinc-400">Loading DizPitch…</p>}>
      <RepositoryProvider>{children}</RepositoryProvider>
    </ClientOnly>
  );
}
