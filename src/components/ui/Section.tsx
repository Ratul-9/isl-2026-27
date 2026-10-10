import { useId } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Titled content block used for each setup form group. */
export function Section({
  title,
  description,
  actions,
  className,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn('rounded-lg border border-zinc-800 bg-zinc-900/60', className)}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div>
          <h2 id={headingId} className="text-sm font-semibold text-zinc-100">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-zinc-400">{description}</p> : null}
        </div>
        {actions}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
