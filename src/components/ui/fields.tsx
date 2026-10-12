import { useId } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

const CONTROL =
  'w-full rounded-md border bg-zinc-900 px-3 text-sm text-zinc-100 placeholder:text-zinc-400 ' +
  'transition-colors focus-visible:border-emerald-500 disabled:opacity-50';

function controlClass(error?: string | null) {
  return cn(CONTROL, error ? 'border-red-500' : 'border-zinc-700');
}

interface FieldShellProps {
  id: string;
  label: string;
  error?: string | null;
  hint?: string;
  className?: string;
  children: ReactNode;
}

function FieldShell({ id, label, error, hint, className, children }: FieldShellProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-medium text-zinc-300">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-zinc-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, error?: string | null, hint?: string) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

type CommonProps = { label: string; error?: string | null; hint?: string; wrapperClassName?: string };

export function TextField({
  label,
  error,
  hint,
  wrapperClassName,
  className,
  ...props
}: CommonProps & ComponentProps<'input'>) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} className={wrapperClassName}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(controlClass(error), 'h-10', className)}
        {...props}
      />
    </FieldShell>
  );
}

export function SelectField({
  label,
  error,
  hint,
  wrapperClassName,
  className,
  children,
  ...props
}: CommonProps & ComponentProps<'select'>) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} className={wrapperClassName}>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(controlClass(error), 'h-10', className)}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  error,
  hint,
  wrapperClassName,
  className,
  ...props
}: CommonProps & ComponentProps<'textarea'>) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} className={wrapperClassName}>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(controlClass(error), 'min-h-20 py-2', className)}
        {...props}
      />
    </FieldShell>
  );
}
