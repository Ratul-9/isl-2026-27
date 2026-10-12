'use client';

import { useState } from 'react';
import { Film } from 'lucide-react';
import type { TrackingData } from '@/domain/types';

export interface AttachedVideo {
  file: File;
  url: string;
}

/**
 * The video is never stored, so after a reload the user can choose the same file again to see it beside the
 * pitch. The file's length is compared with the analysed one so a wrong file is noticed.
 */
export function AttachVideo({
  tracking,
  duration,
  onAttach,
}: {
  tracking: TrackingData;
  duration: (file: File) => Promise<number | null>;
  onAttach: (video: AttachedVideo, warning: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-md border border-dashed border-zinc-700 bg-zinc-900/40 p-4 text-center">
      <Film size={20} aria-hidden className="text-zinc-400" />
      <p className="text-xs text-zinc-300">
        The video is not stored with the match. To see it beside the pitch with the detections drawn on it, choose the same file again
        {tracking.source.fileName ? ` (“${tracking.source.fileName}”)` : ''}.
      </p>
      <input
        type="file"
        aria-label="Original video file"
        accept="video/*,.mp4,.mov,.webm,.mkv"
        disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          const seconds = await duration(file);
          setBusy(false);
          const expected = tracking.source.durationS;
          const warning =
            seconds !== null && Math.abs(seconds - expected) > 0.5
              ? `This file is ${seconds.toFixed(1)} s long but the analysed video was ${expected.toFixed(1)} s; the boxes will not line up.`
              : null;
          onAttach({ file, url: URL.createObjectURL(file) }, warning);
        }}
        className="block max-w-full text-xs text-zinc-300 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-xs file:text-zinc-100"
      />
    </div>
  );
}
