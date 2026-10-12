'use client';

import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Plus, ScanText, Shield, Trash2, Upload } from 'lucide-react';
import { pauseClock } from '@/domain/clock';
import { cloneMatchWithNewIds } from '@/domain/duplicate';
import { createId } from '@/domain/ids';
import { createMatch } from '@/domain/match';
import type { Match } from '@/domain/types';
import { downloadText, readFileText } from '@/lib/download';
import { exportFileName, MAX_IMPORT_BYTES, parseMatchJson, serializeDocument } from '@/persistence/document';
import { useRepository, useStorageNotice } from '@/persistence/RepositoryContext';
import { Button } from '@/components/ui/Button';
import { ConfirmBar } from '@/components/ui/ConfirmBar';
import { EntryCard } from './EntryCard';

type Message = { kind: 'success' | 'error' | 'warning'; text: string; details?: string[]; openId?: string };

/** The saved-match library: create, open, rename, duplicate, export, import and delete. */
export function LibraryView({
  onOpen,
  onImportImages,
  onCreateFromPresets,
}: {
  onOpen: (id: string) => void;
  onImportImages?: () => void;
  onCreateFromPresets?: () => void;
}) {
  const repository = useRepository();
  const notice = useStorageNotice();
  const [listing, setListing] = useState(() => repository.list());
  const [message, setMessage] = useState<Message | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => setListing(repository.list());
  const fail = (text: string, details?: string[]) => setMessage({ kind: 'error', text, details });

  /** Loads a match for an action, reporting a problem if it cannot be read. */
  function loadMatch(id: string): Match | null {
    const result = repository.load(id);
    if (!result.ok) {
      fail('That match could not be read.', result.errors);
      return null;
    }
    return result.match;
  }

  function createNew() {
    const match = createMatch();
    const saved = repository.save(match);
    if (!saved.ok) return fail(`The new match could not be saved. ${saved.error.message}`);
    onOpen(match.id);
  }

  function duplicate(id: string, now: number) {
    const original = loadMatch(id);
    if (!original) return;
    const copy = cloneMatchWithNewIds(original, createId);
    // A copy of a live match must not keep running on the original's reference time.
    copy.clock = pauseClock(copy.clock, now);
    const title = original.name.trim() || [original.home.name, original.away.name].filter(Boolean).join(' vs ') || 'Untitled match';
    copy.name = `${title} (copy)`;
    const saved = repository.save(copy);
    if (!saved.ok) return fail(`The copy could not be saved. ${saved.error.message}`);
    refresh();
    setMessage({ kind: 'success', text: `Created “${copy.name}”.`, openId: copy.id });
  }

  function commitRename() {
    if (!renaming) return;
    const match = loadMatch(renaming.id);
    if (match) {
      const saved = repository.save({ ...match, name: renaming.draft.trim() });
      if (!saved.ok) fail(`The new name could not be saved. ${saved.error.message}`);
      else refresh();
    }
    setRenaming(null);
  }

  function exportJson(id: string) {
    const match = loadMatch(id);
    if (!match) return;
    const now = new Date();
    downloadText(serializeDocument(match, now), exportFileName(match, 'json', now));
  }

  function remove(id: string) {
    const result = repository.remove(id);
    if (!result.ok) fail(`The match could not be deleted. ${result.error.message}`);
    else refresh();
    setDeleting(null);
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow choosing the same file again
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) return fail(`“${file.name}” is too large to be a match file.`);
    let text: string;
    try {
      text = await readFileText(file);
    } catch {
      return fail(`“${file.name}” could not be read.`);
    }
    const parsed = parseMatchJson(text);
    if (!parsed.ok) return fail(`“${file.name}” could not be imported.`, parsed.errors);

    let match = parsed.match;
    let renamed = false;
    // Never overwrite an existing match: a collision becomes a separate copy.
    if (listing.entries.some((e) => e.id === match.id) || listing.corrupt.some((c) => c.id === match.id)) {
      match = cloneMatchWithNewIds(match, createId);
      match.name = `${match.name.trim() || 'Imported match'} (imported)`;
      renamed = true;
    }
    const saved = repository.save(match);
    if (!saved.ok) return fail(`The match was valid but could not be saved. ${saved.error.message}`);
    refresh();
    setMessage({
      kind: parsed.warnings.length > 0 ? 'warning' : 'success',
      text: `Imported “${match.name.trim() || 'Untitled match'}”${renamed ? ' as a new copy (a match with the same id already exists).' : '.'}`,
      details: parsed.warnings,
      openId: match.id,
    });
  }

  const empty = listing.entries.length === 0 && listing.corrupt.length === 0;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded bg-pitch text-xs font-bold text-white">
            DP
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">DizPitch</h1>
            <p className="text-xs text-zinc-400">Your matches, saved in this browser.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Import match file"
            onChange={importFile}
            tabIndex={-1}
          />
          <Button onClick={() => fileInput.current?.click()}>
            <Upload size={16} aria-hidden /> Import match
          </Button>
          {onCreateFromPresets ? (
            <Button onClick={onCreateFromPresets}>
              <Shield size={16} aria-hidden /> Create from ISL teams
            </Button>
          ) : null}
          {onImportImages ? (
            <Button onClick={onImportImages}>
              <ScanText size={16} aria-hidden /> Create from lineup images
            </Button>
          ) : null}
          <Button variant="primary" onClick={createNew}>
            <Plus size={16} aria-hidden /> Create match manually
          </Button>
        </div>
      </header>

      {notice ? (
        <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
          {notice}
        </p>
      ) : null}

      {message ? (
        <div
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={
            message.kind === 'error'
              ? 'rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-100'
              : message.kind === 'warning'
                ? 'rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100'
                : 'rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-100'
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>{message.text}</p>
            <div className="flex gap-2">
              {message.openId ? (
                <Button size="sm" onClick={() => onOpen(message.openId!)}>
                  Open
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => setMessage(null)}>
                Dismiss
              </Button>
            </div>
          </div>
          {message.details && message.details.length > 0 ? (
            <ul className="mt-2 list-inside list-disc text-xs">
              {message.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {empty ? (
        <section aria-label="No matches" className="rounded-lg border border-dashed border-zinc-700 p-8 text-center">
          <p className="text-sm text-zinc-300">No matches yet.</p>
          <p className="mt-1 text-xs text-zinc-400">Create a match, or import one you exported earlier.</p>
        </section>
      ) : (
        <ul aria-label="Saved matches" className="flex flex-col gap-3">
          {listing.entries.map((entry) => (
            <li key={entry.id}>
              <EntryCard
                entry={entry}
                renaming={renaming?.id === entry.id ? renaming.draft : null}
                confirmingDelete={deleting === entry.id}
                onOpen={() => onOpen(entry.id)}
                onStartRename={() => setRenaming({ id: entry.id, draft: entry.title })}
                onRenameChange={(draft) => setRenaming({ id: entry.id, draft })}
                onCommitRename={commitRename}
                onCancelRename={() => setRenaming(null)}
                onDuplicate={() => duplicate(entry.id, Date.now())}
                onExport={() => exportJson(entry.id)}
                onAskDelete={() => setDeleting(entry.id)}
                onConfirmDelete={() => remove(entry.id)}
                onCancelDelete={() => setDeleting(null)}
              />
            </li>
          ))}
        </ul>
      )}

      {listing.corrupt.length > 0 ? (
        <section aria-label="Unreadable matches" className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-red-200">
            {listing.corrupt.length} saved match{listing.corrupt.length === 1 ? '' : 'es'} could not be read
          </h2>
          {listing.corrupt.map((c) => (
            <div key={c.id} className="rounded-lg border border-red-500/40 bg-red-500/5 p-3">
              <p className="text-sm text-zinc-200">
                Entry <code className="text-xs">{c.id}</code>
              </p>
              <ul className="mt-1 list-inside list-disc text-xs text-red-200">
                {c.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
              {deleting === `corrupt:${c.id}` ? (
                <div className="mt-2">
                  <ConfirmBar
                    message="Delete this unreadable entry? This cannot be undone."
                    confirmLabel="Delete"
                    onConfirm={() => remove(c.id)}
                    onCancel={() => setDeleting(null)}
                  />
                </div>
              ) : (
                <Button size="sm" className="mt-2" onClick={() => setDeleting(`corrupt:${c.id}`)}>
                  <Trash2 size={14} aria-hidden /> Delete entry
                </Button>
              )}
            </div>
          ))}
        </section>
      ) : null}
    </main>
  );
}
