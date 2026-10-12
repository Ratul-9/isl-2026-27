'use client';

import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * Under Cache Components, Next keeps previously visited routes mounted but
 * hidden (`<Activity>`) with their React state. For data that lives in browser
 * storage that means a hidden route holds a STALE snapshot: renaming a match
 * in the library would be invisible to its hidden workspace (and the next
 * autosave would overwrite the rename), and vice versa.
 *
 * React cleans up a hidden Activity's effects and sets them up again when it
 * becomes visible. This component notices that second set-up and remounts its
 * children, so they read storage *at reveal time* (not at hide time, which
 * would already be stale again). It uses a layout effect so the refresh
 * happens before the browser paints: no flash of stale content. Unsaved work
 * is safe: `AutosaveProvider` flushes in its effect cleanup, which runs when
 * the route is hidden.
 */
export function ReloadOnReveal({ children }: { children: ReactNode }) {
  const [revision, setRevision] = useState(0);
  const initialised = useRef(false);

  useLayoutEffect(() => {
    if (!initialised.current) {
      initialised.current = true; // first mount: children just loaded fresh data
      return;
    }
    // Set up again after being hidden (or a dev Strict Mode re-run, which is harmless).
    setRevision((r) => r + 1);
  }, []);

  return <Fragment key={revision}>{children}</Fragment>;
}
