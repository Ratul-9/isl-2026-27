'use client';

import { useEffect, useRef, useState } from 'react';
import { Film, Upload } from 'lucide-react';
import type { TrackingServiceResult } from '@/domain/tracking/build';
import { analyzeSegment, CvClientError, fetchCvHealth, scanVideo } from '@/tracking/client';
import type { CvProgress, CvScan } from '@/tracking/client';
import { clippedSegment, segmentError } from '@/tracking/segment';
import { readVideoDuration } from '@/video-analysis/client';
import { Button } from '@/components/ui/Button';
import { CvServiceStatus } from './CvServiceStatus';
import type { HealthState } from './CvServiceStatus';
import { JobProgressView } from './JobProgressView';
import { SegmentPicker } from './SegmentPicker';

/** Replaceable collaborators, so the flow is testable without the service or a media decoder. */
export interface TrackingDeps {
  health: typeof fetchCvHealth;
  duration: (file: File) => Promise<number | null>;
  analyze: (file: File, segment: { startSeconds: number; durationSeconds: number }, onProgress: (p: CvProgress) => void, signal: AbortSignal) => Promise<TrackingServiceResult>;
  scan: (file: File, onProgress: (p: CvProgress) => void, signal: AbortSignal) => Promise<CvScan>;
}

export const defaultTrackingDeps: TrackingDeps = {
  health: () => fetchCvHealth(),
  duration: (file) => readVideoDuration(file),
  analyze: (file, segment, onProgress, signal) => analyzeSegment(file, segment, onProgress, signal),
  scan: (file, onProgress, signal) => scanVideo(file, onProgress, signal),
};

type Job = { kind: 'idle' } | { kind: 'running'; what: 'analyze' | 'scan'; progress: CvProgress } | { kind: 'failed'; what: 'analyze' | 'scan'; message: string };

const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

/** Choose a video and a segment, confirm, then run ONE tracking job with real progress. */
export function TrackingImport({
  deps = defaultTrackingDeps,
  onTracked,
  onCancel,
}: {
  deps?: TrackingDeps;
  onTracked: (file: File, result: TrackingServiceResult) => void;
  onCancel: () => void;
}) {
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' });
  const [file, setFile] = useState<{ file: File; url: string; durationS: number | null } | null>(null);
  const [segment, setSegment] = useState({ start: '0', duration: '8' });
  const [scan, setScan] = useState<CvScan | null>(null);
  const [job, setJob] = useState<Job>({ kind: 'idle' });
  const abort = useRef<AbortController | null>(null);
  const preview = useRef<HTMLVideoElement>(null);

  const [healthCheck, setHealthCheck] = useState(0);
  useEffect(() => {
    let alive = true;
    void deps.health().then((h) => alive && setHealth(h.ok ? { kind: 'ok', health: h.health } : { kind: 'error', code: h.code, message: h.message }));
    return () => {
      alive = false;
    };
  }, [deps, healthCheck]);
  const check = () => {
    setHealth({ kind: 'loading' });
    setHealthCheck((n) => n + 1);
  };
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => () => (file ? URL.revokeObjectURL(file.url) : undefined), [file]);

  const ready = health.kind === 'ok' && health.health.status === 'ok';
  const limits = health.kind === 'ok' ? health.health.limits : null;
  const running = job.kind === 'running';
  const startS = Number(segment.start);
  const durationS = Number(segment.duration);
  const tooBig = file && limits && file.file.size > limits.maxUploadMb * 1024 * 1024 ? `The file is larger than ${limits.maxUploadMb} MB.` : null;
  const error = file && limits ? (tooBig ?? segmentError(startS, durationS, file.durationS, limits.maxSegmentSeconds)) : null;

  async function choose(next: File) {
    setScan(null);
    setJob({ kind: 'idle' });
    const durationS = await deps.duration(next);
    setFile({ file: next, url: URL.createObjectURL(next), durationS });
  }

  async function run(what: 'analyze' | 'scan') {
    if (!file) return;
    const controller = new AbortController();
    abort.current = controller;
    const onProgress = (progress: CvProgress) => !controller.signal.aborted && setJob({ kind: 'running', what, progress });
    onProgress({ phase: 'uploading', fraction: 0 });
    try {
      if (what === 'scan') {
        setScan(await deps.scan(file.file, onProgress, controller.signal));
        setJob({ kind: 'idle' });
      } else {
        const result = await deps.analyze(file.file, clippedSegment(startS, durationS, file.durationS), onProgress, controller.signal);
        onTracked(file.file, result);
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      const message = e instanceof CvClientError || e instanceof Error ? e.message : 'The job failed unexpectedly.';
      setJob({ kind: 'failed', what, message });
    }
  }

  function seekPreview(t: number) {
    if (preview.current) preview.current.currentTime = t;
  }

  return (
    <section aria-label="Track a video" className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-base font-semibold">Track players and ball in a video (computer vision)</h2>
        <Button size="sm" onClick={onCancel}>
          Back to replays
        </Button>
      </header>
      <CvServiceStatus state={health} onRetry={check} />

      {ready && limits ? (
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <input
            type="file"
            aria-label="Video file"
            accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv"
            disabled={running}
            onChange={(e) => {
              const next = e.target.files?.[0];
              e.target.value = '';
              if (next) void choose(next);
            }}
            className="block w-full text-sm text-zinc-300 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-sm file:text-zinc-100"
          />
          {!file ? (
            <p className="flex items-center gap-2 text-sm text-zinc-400">
              <Upload size={16} aria-hidden /> Choose a match video; you pick the segment to track next.
            </p>
          ) : (
            <>
              <video ref={preview} src={file.url} controls muted preload="metadata" aria-label="Video preview" className="max-h-72 w-full rounded-md border border-zinc-800 bg-black" />
              <p className="flex flex-wrap items-center gap-x-3 text-xs text-zinc-400">
                <Film size={14} aria-hidden /> {file.file.name} · {mb(file.file.size)} MB · {file.durationS !== null ? `${file.durationS.toFixed(1)} s` : 'length unknown'}
              </p>
              <SegmentPicker
                start={segment.start}
                duration={segment.duration}
                maxSegment={limits.maxSegmentSeconds}
                error={error}
                disabled={running}
                onChange={(next) => setSegment((s) => ({ ...s, ...next }))}
                onUseCurrent={() => setSegment((s) => ({ ...s, start: (preview.current?.currentTime ?? 0).toFixed(2) }))}
                scan={scan}
                canScan={!running && !tooBig}
                onScan={() => void run('scan')}
                onPick={(start, duration) => {
                  setSegment({ start: start.toFixed(2), duration: duration.toFixed(2) });
                  seekPreview(start);
                }}
              />
              {job.kind === 'running' ? <JobProgressView progress={job.progress} label={job.what === 'scan' ? 'Scan progress' : 'Tracking progress'} /> : null}
              {job.kind === 'failed' ? (
                <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-200">
                  {job.what === 'scan' ? 'Finding wide shots' : 'Tracking'} failed: {job.message}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {running ? (
                  <Button
                    onClick={() => {
                      abort.current?.abort();
                      setJob({ kind: 'idle' });
                    }}
                  >
                    Cancel
                  </Button>
                ) : (
                  <Button variant="primary" disabled={!!error} onClick={() => void run('analyze')}>
                    Track this segment
                  </Button>
                )}
                {!running && !error ? (
                  <span className="text-xs text-zinc-400">
                    Every frame in the segment is processed. On the Apple M5 used for development that took about 0.5 s per frame (an 8 s clip at 25 fps:
                    roughly 1.5–2 minutes).
                  </span>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
