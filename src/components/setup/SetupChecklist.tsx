'use client';

import { AlertCircle, CheckCircle2, Circle } from 'lucide-react';
import { getSetupIssues } from '@/domain/match';
import { useMatch } from '@/store/MatchContext';

/** Live summary of what is invalid or still to do. Incomplete squads are allowed. */
export function SetupChecklist() {
  const issues = getSetupIssues(useMatch());
  const errors = issues.filter((i) => i.severity === 'error');
  const todos = issues.filter((i) => i.severity === 'incomplete');

  return (
    <aside aria-label="Setup checklist" className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="text-sm font-semibold text-zinc-100">Setup checklist</h2>
      {issues.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-emerald-400">
          <CheckCircle2 size={16} aria-hidden /> Everything required is filled in.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {errors.map((i) => (
            <li key={i.id} className="flex items-start gap-2 text-sm text-red-300">
              <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                <span className="sr-only">Problem: </span>
                {i.message}
              </span>
            </li>
          ))}
          {todos.map((i) => (
            <li key={i.id} className="flex items-start gap-2 text-sm text-zinc-400">
              <Circle size={16} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                <span className="sr-only">To do: </span>
                {i.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
