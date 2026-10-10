import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Button } from './Button';

/** Inline confirmation for destructive actions; keeps the affected context visible. */
export function ConfirmBar({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  extra,
}: {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  extra?: ReactNode;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Move focus to the decision so keyboard users land on it.
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <div role="alertdialog" aria-label={message} className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
      <p className="text-xs text-amber-100">{message}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button ref={confirmRef} size="sm" variant="primary" onClick={onConfirm}>
          {confirmLabel}
        </Button>
        {extra}
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
