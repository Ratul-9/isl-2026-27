'use client';

import { useId } from 'react';
import { cn } from '@/lib/cn';

/**
 * A labelled number input that commits on blur or Enter, so typing "12.5"
 * never passes through an invalid intermediate state. Re-keyed by value, so
 * an outside change (e.g. dragging a marker) is always reflected.
 */
export function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  step = 0.1,
  className,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}) {
  const id = useId();
  const commit = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) return;
    const bounded = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    if (bounded !== value) onCommit(bounded);
  };
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-xs font-medium text-zinc-300">
        {label}
      </label>
      <input
        key={value}
        id={id}
        type="number"
        inputMode="decimal"
        defaultValue={Number(value.toFixed(3))}
        min={min}
        max={max}
        step={step}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
        }}
        className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm tabular-nums text-zinc-100 focus-visible:border-emerald-500"
      />
    </div>
  );
}
