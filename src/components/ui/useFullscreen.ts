'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * - `off`: normal layout.
 * - `native`: the browser's Fullscreen API is showing the element (browser chrome hidden, Esc exits).
 * - `fallback`: the API is unavailable or was refused (e.g. iPhone Safari); the caller covers the
 *   viewport with a fixed overlay instead, and must handle Esc itself.
 */
export type FullscreenMode = 'off' | 'native' | 'fallback';

/**
 * Fullscreens one existing element, never a copy, so React state, undo history and in-progress gestures
 * are untouched. Falls back to `mode === 'fallback'` when the Fullscreen API cannot be used.
 */
export function useFullscreen<T extends HTMLElement>() {
  // A callback ref (state-backed) rather than a ref object, so `mode` can be read during render.
  const [element, setElement] = useState<T | null>(null);
  const [mode, setMode] = useState<FullscreenMode>('off');

  // The browser can leave fullscreen on its own (Esc, OS gesture); mirror it.
  useEffect(() => {
    if (!element) return;
    const onChange = () => {
      const isNative = document.fullscreenElement === element;
      setMode((current) => (isNative ? 'native' : current === 'native' ? 'off' : current));
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      // Never leave the browser fullscreen on an element that no longer exists.
      if (document.fullscreenElement === element) void document.exitFullscreen().catch(() => {});
    };
  }, [element]);

  // In the overlay fallback the page behind must not scroll.
  useEffect(() => {
    if (mode !== 'fallback') return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = previous;
    };
  }, [mode]);

  const enter = useCallback(async () => {
    if (!element) return;
    if (document.fullscreenEnabled && typeof element.requestFullscreen === 'function') {
      try {
        await element.requestFullscreen({ navigationUI: 'hide' });
        setMode('native');
        return;
      } catch {
        // Refused (permissions policy, no user activation…): use the overlay instead.
      }
    }
    setMode('fallback');
  }, [element]);

  const exit = useCallback(async () => {
    if (element !== null && document.fullscreenElement === element) {
      try {
        await document.exitFullscreen();
      } catch {
        // Already leaving; the fullscreenchange listener settles the state.
      }
    }
    setMode('off');
  }, [element]);

  const toggle = useCallback(() => {
    void (mode === 'off' ? enter() : exit());
  }, [mode, enter, exit]);

  return { attach: setElement, mode, active: mode !== 'off', enter, exit, toggle };
}
