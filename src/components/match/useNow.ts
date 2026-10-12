'use client';

import { useSyncExternalStore } from 'react';

/**
 * A shared "now" that re-renders subscribers while at least one is mounted.
 * It exists only to trigger repaints: the match clock derives elapsed time
 * from timestamps (invariant 8), so a late or throttled tick is harmless and
 * nothing is ever accumulated here.
 */
const TICK_MS = 250;
const listeners = new Set<() => void>();
let current = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      listeners.forEach((l) => l());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot() {
  // First read before any subscriber exists (e.g. the initial client render).
  if (current === 0) current = Date.now();
  return current;
}

/** Current time in epoch ms, refreshed every 250 ms while mounted. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
