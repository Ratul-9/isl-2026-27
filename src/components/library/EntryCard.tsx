'use client';

import { Copy, Download, FolderOpen, Pencil, Trash2 } from 'lucide-react';
import { matchStatusLabel } from '@/domain/match';
import type { LibraryEntry } from '@/persistence/repository';
import { Button } from '@/components/ui/Button';
import { ConfirmBar } from '@/components/ui/ConfirmBar';
import { TextField } from '@/components/ui/fields';

function formatSaved(iso: string | null): string {
  if (!iso) return 'Not saved yet';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Saved' : `Saved ${d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
}

export interface EntryCardProps {
  entry: LibraryEntry;
  renaming: string | null;
  confirmingDelete: boolean;
  onOpen: () => void;
  onStartRename: () => void;
  onRenameChange: (draft: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onAskDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

/** One saved match in the library, with rename / duplicate / export / delete controls. */
export function EntryCard(p: EntryCardProps) {
  const { entry } = p;
  const teams = [entry.homeName || 'Home team', entry.awayName || 'Away team'].join(' vs ');
  const when = [entry.date, entry.kickoffTime].filter(Boolean).join(' · ');
  return (
    <article aria-label={entry.title} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      {p.renaming !== null ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            p.onCommitRename();
          }}
        >
          <TextField label="Match name" value={p.renaming} maxLength={80} onChange={(e) => p.onRenameChange(e.target.value)} wrapperClassName="min-w-0 flex-1" autoFocus />
          <Button type="submit" variant="primary">
            Save name
          </Button>
          <Button onClick={p.onCancelRename} variant="ghost">
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{entry.title}</h2>
            <p className="text-sm text-zinc-300">{teams}</p>
            <p className="mt-1 text-xs text-zinc-400">
              {[when, matchStatusLabel(entry.status), formatSaved(entry.savedAt)].filter(Boolean).join(' · ')}
            </p>
            {entry.warnings.length > 0 ? (
              <p className="mt-1 text-xs text-amber-300">{entry.warnings.join(' ')}</p>
            ) : null}
          </div>
          <Button variant="primary" onClick={p.onOpen} aria-label={`Open ${entry.title}`}>
            <FolderOpen size={16} aria-hidden /> Open
          </Button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={p.onStartRename} aria-label={`Rename ${entry.title}`}>
          <Pencil size={14} aria-hidden /> Rename
        </Button>
        <Button size="sm" onClick={p.onDuplicate} aria-label={`Duplicate ${entry.title}`}>
          <Copy size={14} aria-hidden /> Duplicate
        </Button>
        <Button size="sm" onClick={p.onExport} aria-label={`Export ${entry.title} as JSON`}>
          <Download size={14} aria-hidden /> Export JSON
        </Button>
        <Button size="sm" variant="ghost" onClick={p.onAskDelete} aria-label={`Delete ${entry.title}`} disabled={p.confirmingDelete}>
          <Trash2 size={14} aria-hidden /> Delete
        </Button>
      </div>

      {p.confirmingDelete ? (
        <div className="mt-3">
          <ConfirmBar
            message={`Delete “${entry.title}”? Its squads, board, events and clock are removed from this browser. Export it first if you may need it.`}
            confirmLabel="Delete match"
            onConfirm={p.onConfirmDelete}
            onCancel={p.onCancelDelete}
          />
        </div>
      ) : null}
    </article>
  );
}
