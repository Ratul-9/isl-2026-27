'use client';

import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

const subscribeNever = () => () => {};

/**
 * Renders children only on the client. Anything that creates random ids or
 * reads browser storage must live below this gate: server prerendering (Cache
 * Components) and hydration both rely on it.
 */
export function ClientOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const isClient = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  return isClient ? children : fallback;
}
