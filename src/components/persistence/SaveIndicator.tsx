'use client';

import { AlertTriangle, CheckCircle2, CloudOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useSaveStatus } from './AutosaveProvider';

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Shows whether the open match is safely stored; offers retry on failure. */
export function SaveIndicator() {
  const save = useSaveStatus();
  if (!save) return null;
  const { status } = save;

  if (status.state === 'error') {
    return (
      <div role="alert" className="flex items-center gap-2 rounded-md border border-red-500/50 bg-red-500/10 px-2 py-1 text-xs text-red-200">
        <AlertTriangle size={14} aria-hidden className="shrink-0" />
        <span className="max-w-xs truncate" title={status.error.message}>
          Not saved — {status.error.message}
        </span>
        <Button size="sm" variant="secondary" onClick={save.saveNow}>
          Retry
        </Button>
      </div>
    );
  }
  if (status.state === 'saving') {
    return (
      <span role="status" className="flex items-center gap-1.5 text-xs text-zinc-400">
        <Loader2 size={14} aria-hidden className="animate-spin" /> Saving…
      </span>
    );
  }
  if (status.state === 'session-only') {
    return (
      <span role="status" className="flex items-center gap-1.5 text-xs text-amber-300" title="Browser storage is unavailable. Export the match to keep a copy.">
        <CloudOff size={14} aria-hidden /> Not saved (this session only)
      </span>
    );
  }
  const time = formatTime(status.savedAt);
  return (
    <span role="status" className="flex items-center gap-1.5 text-xs text-zinc-400">
      <CheckCircle2 size={14} aria-hidden className="text-emerald-400" /> {time ? `Saved ${time}` : 'Saved'}
    </span>
  );
}
