'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ClipboardList, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { PatternPanel } from './PatternPanel';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Chromium can keep Esc from leaving native fullscreen while a dialog is open (hold Esc to leave). Best effort. */
type KeyboardLockApi = { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void };
const keyboardApi = (): KeyboardLockApi | undefined => (typeof navigator === 'undefined' ? undefined : (navigator as unknown as { keyboard?: KeyboardLockApi }).keyboard);

/**
 * True when the event came from another dialog opened from inside the bench (the animated scenario is
 * portalled out of the panel's DOM): that dialog owns Escape and clicks, the bench must not react to them.
 */
function inNestedDialog(target: EventTarget | null, own: HTMLElement | null): boolean {
  const dialog = target instanceof Element ? target.closest('[role="dialog"]') : null;
  return dialog !== null && dialog !== own;
}

/**
 * The tactical patterns, one click from the pitch. Normal layout: an anchored dropdown under the button.
 * Fullscreen: an in-app modal rendered INSIDE the fullscreen element (so it is above the pitch and the browser
 * never leaves fullscreen or opens a window). Both show the same `PatternPanel`; nothing is applied until the
 * user presses its Apply button, and Escape / backdrop / Cancel close without applying.
 *
 * Mount it with `key={fullscreen ? 'fullscreen' : 'normal'}` so a layout change closes it.
 */
export function TacticalBench({ fullscreen }: { fullscreen: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  // Escape closes the bench only (not fullscreen, not the selection). Captured before the board's own handler.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || inNestedDialog(e.target, panelRef.current)) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  // Dropdown: a press outside it closes it without applying anything.
  useEffect(() => {
    if (!open || fullscreen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (inNestedDialog(e.target, panelRef.current)) return;
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, fullscreen]);

  // Modal: keep Esc from leaving native fullscreen where the browser allows it.
  useEffect(() => {
    if (!open || !fullscreen) return;
    const api = keyboardApi();
    void api?.lock?.(['Escape'])?.catch(() => {});
    return () => api?.unlock?.();
  }, [open, fullscreen]);

  // Move focus into the panel when it opens.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [open]);

  function onPanelKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Tab' && fullscreen) {
      // Keep Tab inside the modal.
      const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (items.length > 0) {
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    // Board shortcuts (tools, undo) must not fire while the user works in the panel.
    if (e.key !== 'Tab') e.stopPropagation();
  }

  const frame = (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal={fullscreen ? true : undefined}
      aria-labelledby={titleId}
      onKeyDown={onPanelKeyDown}
      className={
        fullscreen
          ? 'flex max-h-[min(85vh,40rem)] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl'
          : 'flex max-h-[min(70vh,34rem)] w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl'
      }
    >
      <div className="flex items-center gap-2">
        <h3 id={titleId} className="mr-auto text-sm font-semibold">
          Tactical Bench
        </h3>
        <button
          type="button"
          onClick={close}
          aria-label="Close Tactical Bench"
          className="rounded p-1 text-zinc-300 hover:bg-zinc-800 hover:text-white"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      <PatternPanel embedded onApplied={close} />
      {fullscreen ? (
        <div className="flex justify-end border-t border-zinc-800 pt-3">
          <Button size="sm" onClick={close}>
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );

  return (
    <div ref={rootRef} className="relative">
      <Button
        ref={buttonRef}
        size="sm"
        variant={open ? 'primary' : 'secondary'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        title="Apply a tactical pattern to a team"
      >
        <ClipboardList size={14} aria-hidden /> Tactical Bench
      </Button>
      {open && !fullscreen ? <div className="absolute right-0 top-full z-30 mt-2">{frame}</div> : null}
      {open && fullscreen ? (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4"
          onPointerDown={(e) => {
            // The backdrop only: a press inside the dialog must not close it.
            if (e.target === e.currentTarget) close();
          }}
        >
          {frame}
        </div>
      ) : null}
    </div>
  );
}
