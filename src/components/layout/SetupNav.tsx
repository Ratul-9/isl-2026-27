'use client';

import { ClipboardList, Shield, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { getSetupIssues, teamDisplayName } from '@/domain/match';
import type { SetupScope } from '@/domain/match';
import { useMatch } from '@/store/MatchContext';
import { cn } from '@/lib/cn';

export interface SectionEntry {
  scope: SetupScope;
  label: string;
  icon: ReactNode;
}

export function SetupNav({ active, onSelect }: { active: SetupScope; onSelect: (scope: SetupScope) => void }) {
  const match = useMatch();
  const issues = getSetupIssues(match);
  const entries: SectionEntry[] = [
    { scope: 'match', label: 'Match details', icon: <ClipboardList size={16} aria-hidden /> },
    { scope: 'home', label: teamDisplayName(match.home, 'home'), icon: <Users size={16} aria-hidden /> },
    { scope: 'away', label: teamDisplayName(match.away, 'away'), icon: <Users size={16} aria-hidden /> },
    { scope: 'officials', label: 'Match officials', icon: <Shield size={16} aria-hidden /> },
  ];

  return (
    <nav aria-label="Match setup sections" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {entries.map((entry) => {
        const open = issues.filter((i) => i.scope === entry.scope);
        const hasError = open.some((i) => i.severity === 'error');
        const isActive = entry.scope === active;
        return (
          <button
            key={entry.scope}
            type="button"
            onClick={() => onSelect(entry.scope)}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors',
              isActive ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100',
            )}
          >
            {entry.icon}
            <span className="max-w-40 truncate">{entry.label}</span>
            {open.length > 0 ? (
              <span
                className={cn(
                  'ml-auto rounded-full px-1.5 text-[11px] font-medium tabular-nums',
                  hasError ? 'bg-red-500/20 text-red-300' : 'bg-zinc-700 text-zinc-300',
                )}
                aria-label={`${open.length} open item${open.length === 1 ? '' : 's'}`}
              >
                {open.length}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
