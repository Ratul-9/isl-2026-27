'use client';

import { useEffect, useRef, useState } from 'react';
import { FilePlus2, Film, Loader2, Upload } from 'lucide-react';
import type { ReplayAnalysis } from '@/domain/types';
import { checkClip, fetchVideoStatus, readVideoDuration, requestVideoAnalysis, VideoClientError } from '@/video-analysis/client';
import type { VideoAnalysisMeta, VideoFailure, VideoProviderStatus } from '@/video-analysis/schema';
import { Button } from '@/components/ui/Button';

/** Replaceable collaborators, so the flow is testable without a server or a media decoder. */
export interface ClipDeps {
  status: () => Promise<VideoProviderStatus | null>;
  duration: (file: File) => Promise<number | null>;
  check: (file: File, durationSeconds: number | null, limits: VideoProviderStatus['limits']) => Promise<VideoFailure | null>;
  analyze: (file: File, durationSeconds: number | null, signal: AbortSignal) => Promise<{ analysis: ReplayAnalysis; meta: VideoAnalysisMeta }>;
}

export const defaultClipDeps: ClipDeps = {
  status: () => fetchVideoStatus(),
  duration: (file) => readVideoDuration(file),
  check: (file, d, limits) => checkClip(file, d, limits),
  analyze: (file, d, signal) => requestVideoAnalysis(file, d, { signal }),
};

export interface AnalysedClip {
  file: File;
  durationSeconds: number | null;
  analysis: ReplayAnalysis;
  meta: VideoAnalysisMeta;
}

type Phase =
  | { kind: 'empty' }
  | { kind: 'checking'; file: File }
  | { kind: 'rejected'; file: File; failure: VideoFailure }
  | { kind: 'preview'; file: File; durationSeconds: number | null }
  | { kind: 'analysing'; file: File; durationSeconds: number | null }
  | { kind: 'failed'; file: File; durationSeconds: number | null; failure: VideoFailure };

const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

/** Choose a clip, preview and confirm it, then run ONE analysis when (and only when) the user asks. */
export function ClipImport({
  deps = defaultClipDeps,
  onAnalysed,
  onManual,
  onCancel,
}: {
  deps?: ClipDeps;
  onAnalysed: (clip: AnalysedClip) => void;
  onManual: () => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState<VideoProviderStatus | null | 'loading'>('loading');
  const [phase, setPhase] = useState<Phase>({ kind: 'empty' });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    deps.status().then((s) => alive && setStatus(s));
    return () => {
      alive = false;
    };
  }, [deps]);

  // The preview URL is revoked when replaced and on unmount; an analysis in flight is cancelled on unmount.
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );
  useEffect(() => () => abort.current?.abort(), []);

  async function choose(file: File) {
    if (status === 'loading' || status === null) return;
    setPreviewUrl(null);
    setPhase({ kind: 'checking', file });
    const durationSeconds = await deps.duration(file);
    const failure = await deps.check(file, durationSeconds, status.limits);
    if (failure) return setPhase({ kind: 'rejected', file, failure });
    setPreviewUrl(URL.createObjectURL(file));
    setPhase({ kind: 'preview', file, durationSeconds });
  }

  async function analyse(file: File, durationSeconds: number | null) {
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ kind: 'analysing', file, durationSeconds });
    try {
      const result = await deps.analyze(file, durationSeconds, controller.signal);
      onAnalysed({ file, durationSeconds, ...result });
    } catch (error) {
      if (controller.signal.aborted) return;
      const failure: VideoFailure =
        error instanceof VideoClientError
          ? error.failure
          : { code: 'unexpected', message: 'Analysing the clip failed unexpectedly.', retryable: true };
      setPhase({ kind: 'failed', file, durationSeconds, failure });
    }
  }

  const ready = status !== 'loading' && status !== null && status.configured;

  return (
    <section aria-label="Import a video clip" className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-base font-semibold">Create a tactical replay from a video clip</h2>
        <Button size="sm" onClick={onCancel}>
          Back to replays
        </Button>
      </header>

      {status === 'loading' ? (
        <p role="status" className="text-xs text-zinc-400">
          Checking whether clip analysis is available…
        </p>
      ) : null}
      {status === null ? (
        <div role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
          <p>The DizPitch server could not be reached, so clips cannot be analysed automatically.</p>
          <p className="mt-1 text-xs">Analysis needs the server to be running (<code>npm run dev</code> or <code>npm start</code>). You can still annotate a replay by hand.</p>
        </div>
      ) : null}
      {status !== 'loading' && status !== null && !status.configured ? (
        <div role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
          <p className="font-semibold">Automatic clip analysis is not set up.</p>
          <p className="mt-1 text-xs">{status.reason}</p>
          <ol className="mt-2 list-inside list-decimal text-xs">
            <li>
              Create a Gemini API key in Google AI Studio (aistudio.google.com/apikey) and put it in <code>.env.local</code> in the project folder:{' '}
              <code>GEMINI_API_KEY=your-key</code>
            </li>
            <li>Restart the DizPitch server (the key is read on the server only; it is never sent to the browser).</li>
          </ol>
        </div>
      ) : null}
      {ready ? (
        <p className="rounded-md border border-zinc-800 bg-zinc-900/60 p-3 text-xs leading-relaxed text-zinc-300">
          <strong className="text-zinc-100">How the clip is used:</strong> it is uploaded from the DizPitch server to Google&apos;s Gemini API (model {status.model},{' '}
          sampled at {status.limits.samplingFps} frames per second), analysed once, and then deleted from Google&apos;s file store. DizPitch does not keep the video:
          only the derived replay is saved. Each analysis uses API quota or credit and is never repeated automatically. With a free (unpaid) Gemini key Google may
          use what you send to improve its products and people may review it; a paid key is not used that way. The result is an <em>estimated</em> reconstruction,
          not tracking data. Limits: {mb(status.limits.maxBytes)} MB and {status.limits.maxSeconds} s; MP4, MOV or WebM.
        </p>
      ) : null}

      {ready ? (
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <input
            type="file"
            aria-label="Video clip"
            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
            disabled={phase.kind === 'analysing' || phase.kind === 'checking'}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void choose(file);
            }}
            className="block w-full text-sm text-zinc-300 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-sm file:text-zinc-100"
          />

          {phase.kind === 'empty' ? (
            <p className="flex items-center gap-2 text-sm text-zinc-400">
              <Upload size={16} aria-hidden /> Choose a short clip (one pass, shot or set piece works best).
            </p>
          ) : null}
          {phase.kind === 'checking' ? (
            <p role="status" className="text-sm text-zinc-300">
              Checking “{phase.file.name}”…
            </p>
          ) : null}
          {phase.kind === 'rejected' ? (
            <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-200">
              “{phase.file.name}” cannot be used: {phase.failure.message}
            </p>
          ) : null}

          {(phase.kind === 'preview' || phase.kind === 'analysing' || phase.kind === 'failed') && previewUrl ? (
            <div className="flex flex-col gap-3">
              {/* The user's own clip, shown so they can confirm it before anything is sent. */}
              <video src={previewUrl} controls muted preload="metadata" aria-label="Clip preview" className="max-h-72 w-full rounded-md border border-zinc-800 bg-black" />
              <p className="flex flex-wrap items-center gap-x-3 text-xs text-zinc-400">
                <Film size={14} aria-hidden /> {phase.file.name} · {mb(phase.file.size)} MB
                {phase.durationSeconds !== null ? ` · ${phase.durationSeconds.toFixed(1)} s` : ' · length unknown'}
              </p>
            </div>
          ) : null}

          {phase.kind === 'failed' ? (
            <div role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
              <p>Analysis failed: {phase.failure.message}</p>
            </div>
          ) : null}
          {phase.kind === 'analysing' ? (
            <p role="status" className="flex items-center gap-2 text-sm text-emerald-300">
              <Loader2 size={16} className="animate-spin" aria-hidden /> Uploading and analysing the clip. This can take a minute…
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {phase.kind === 'preview' ? (
              <Button variant="primary" onClick={() => void analyse(phase.file, phase.durationSeconds)}>
                Analyse this clip
              </Button>
            ) : null}
            {phase.kind === 'failed' ? (
              <Button variant="primary" onClick={() => void analyse(phase.file, phase.durationSeconds)}>
                {phase.failure.retryable ? 'Try again' : 'Analyse again'}
              </Button>
            ) : null}
            {phase.kind === 'analysing' ? (
              <Button
                title="Stops waiting here. The server may already have started the analysis."
                onClick={() => {
                  abort.current?.abort();
                  setPhase({ kind: 'preview', file: phase.file, durationSeconds: phase.durationSeconds });
                }}
              >
                Stop waiting
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800 pt-4">
        <Button onClick={onManual}>
          <FilePlus2 size={16} aria-hidden /> Annotate a replay by hand instead
        </Button>
        <span className="text-xs text-zinc-400">No video or AI needed.</span>
      </div>
    </section>
  );
}
