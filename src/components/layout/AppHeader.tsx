'use client';

import { ClipboardList, LayoutGrid } from 'lucide-react';
import { matchDisplayName, matchStatusLabel } from '@/domain/match';
import { useMatch } from '@/store/MatchContext';
import { cn } from '@/lib/cn';

export type WorkspaceView = 'board' | 'setup';

const VIEWS: { id: WorkspaceView; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'board', label: 'Board', icon: LayoutGrid },
  { id: 'setup', label: 'Setup', icon: ClipboardList },
];

export function AppHeader({ view, onViewChange }: { view: WorkspaceView; onViewChange: (v: WorkspaceView) => void }) {
  const match = useMatch();
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-950 px-4">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="flex h-7 w-7 items-center justify-center rounded bg-pitch text-[11px] font-bold text-white"
        >
          DP
        </span>
        <span className="hidden text-sm font-semibold tracking-tight sm:inline">DizPitch</span>
      </div>
      <span aria-hidden className="h-5 w-px bg-zinc-800" />
      <h1 className="min-w-0 flex-1 truncate text-sm text-zinc-300" title={matchDisplayName(match)}>
        {matchDisplayName(match)}
      </h1>
      <nav aria-label="Workspace" className="flex gap-1 rounded-md bg-zinc-900 p-1">
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={view === id ? 'page' : undefined}
            onClick={() => onViewChange(id)}
            className={cn(
              'flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium',
              view === id ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-100',
            )}
          >
            <Icon size={14} aria-hidden />
            {label}
          </button>
        ))}
      </nav>
      <span className="hidden shrink-0 rounded-full border border-zinc-700 px-2.5 py-0.5 text-xs text-zinc-300 md:inline">
        {matchStatusLabel(match.status)}
      </span>
    </header>
  );
}
