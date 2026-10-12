'use client';

import { useId, useRef } from 'react';
import type { ChangeEvent } from 'react';
import { ImageUp, RefreshCw, X } from 'lucide-react';
import type { ExtractionFailure } from '@/lineup-extraction/schema';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

export type ReadState =
  | { status: 'idle' }
  | { status: 'reading' }
  | { status: 'ok' }
  | { status: 'failed'; failure: ExtractionFailure };

interface Props {
  /** "Home team" / "Away team". */
  label: string;
  fileName: string | null;
  previewUrl: string | null;
  /** Problem with the chosen file itself (wrong type, unreadable…). */
  fileError: string | null;
  preparing: boolean;
  read: ReadState;
  /** The draft for this team came from typing it in, not from the image. */
  manual: boolean;
  onFile: (file: File) => void;
  onClear: () => void;
  onRetryRead: () => void;
  onEnterManually: () => void;
}

/** One upload tile: pick/replace an image, preview it, see whether it was read. */
export function ImageSlot(p: Props) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow choosing the same file again
    if (file) p.onFile(file);
  }

  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 id={id} className="text-sm font-semibold">
          {p.label} starting lineup
        </h3>
        {p.fileName ? (
          <span className="truncate text-xs text-zinc-400" title={p.fileName}>
            {p.fileName}
          </span>
        ) : null}
      </div>

      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,.png,.jpg,.jpeg"
        className="sr-only"
        aria-label={`${p.label} lineup image`}
        onChange={onChange}
        tabIndex={-1}
      />

      {p.previewUrl ? (
        // The user's own image, shown only so they can see what was uploaded; it is never used as the pitch.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.previewUrl} alt={`Preview of the ${p.label.toLowerCase()} lineup image`} className="max-h-56 w-full rounded-md border border-zinc-800 bg-zinc-950 object-contain" />
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className={cn(
            'flex h-40 w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-zinc-700 text-sm text-zinc-300',
            'hover:border-emerald-600 hover:text-white',
          )}
        >
          <ImageUp size={22} aria-hidden />
          <span>Choose {p.label.toLowerCase()} lineup image</span>
          <span className="text-xs text-zinc-400">PNG or JPEG</span>
        </button>
      )}

      {p.preparing ? (
        <p role="status" className="text-xs text-zinc-400">
          Preparing image…
        </p>
      ) : null}
      {p.fileError ? (
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">
          {p.fileError}
        </p>
      ) : null}

      {p.read.status === 'reading' ? (
        <p role="status" className="flex items-center gap-2 text-xs text-emerald-300">
          <RefreshCw size={14} className="animate-spin" aria-hidden /> Reading the lineup…
        </p>
      ) : null}
      {p.read.status === 'ok' ? <p className="text-xs text-emerald-300">Lineup read. You can check and correct it in the next step.</p> : null}
      {p.manual ? <p className="text-xs text-amber-300">Entering this team manually (no image reading).</p> : null}
      {p.read.status === 'failed' ? (
        <div role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">
          <p>Could not read this image: {p.read.failure.message}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={p.onRetryRead}>
              <RefreshCw size={14} aria-hidden /> Try again
            </Button>
            <Button size="sm" variant="ghost" onClick={p.onEnterManually}>
              Enter this team manually
            </Button>
          </div>
        </div>
      ) : null}

      {p.previewUrl ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => input.current?.click()}>
            <ImageUp size={14} aria-hidden /> Replace image
          </Button>
          <Button size="sm" variant="ghost" onClick={p.onClear} aria-label={`Remove ${p.label.toLowerCase()} image`}>
            <X size={14} aria-hidden /> Remove
          </Button>
        </div>
      ) : null}
    </section>
  );
}
