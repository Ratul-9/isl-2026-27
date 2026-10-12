import type { CvHealth } from '@/tracking/client';

export type HealthState = { kind: 'loading' } | { kind: 'ok'; health: CvHealth } | { kind: 'error'; code: string; message: string };

const box = 'rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100';

/** Whether the local computer-vision service can be used, and how to set it up when it cannot. */
export function CvServiceStatus({ state, onRetry }: { state: HealthState; onRetry: () => void }) {
  if (state.kind === 'loading') {
    return (
      <p role="status" className="text-xs text-zinc-400">
        Checking the computer-vision service…
      </p>
    );
  }
  if (state.kind === 'error') {
    return (
      <div role="alert" className={box}>
        <p className="font-semibold">The computer-vision service is not available.</p>
        <p className="mt-1 text-xs">{state.message}</p>
        <ol className="mt-2 list-inside list-decimal space-y-0.5 text-xs">
          <li>
            In a terminal: <code>cd cv-service &amp;&amp; uv sync &amp;&amp; ./scripts/download_models.sh</code>
          </li>
          <li>
            Start it: <code>uv run uvicorn app.main:app --port 8001</code> (DizPitch reaches it via <code>CV_SERVICE_URL</code>, default
            http://127.0.0.1:8001)
          </li>
        </ol>
        <p className="mt-1 text-xs">See cv-service/README.md for details.</p>
        <button type="button" onClick={onRetry} className="mt-2 text-xs font-medium text-amber-50 underline underline-offset-2">
          Check again
        </button>
      </div>
    );
  }
  const { health } = state;
  if (health.status === 'models_missing') {
    return (
      <div role="alert" className={box}>
        <p className="font-semibold">The service is running, but the model weights are not installed.</p>
        <p className="mt-1 text-xs">Missing: {health.models.missing.join(', ')}.</p>
        <p className="mt-1 text-xs">
          Run <code>./scripts/download_models.sh</code> in cv-service/ (about 420 MB), then restart the service. Read the licence notes in cv-service/README.md
          first.
        </p>
        <button type="button" onClick={onRetry} className="mt-2 text-xs font-medium text-amber-50 underline underline-offset-2">
          Check again
        </button>
      </div>
    );
  }
  return (
    <p className="rounded-md border border-zinc-800 bg-zinc-900/60 p-3 text-xs leading-relaxed text-zinc-300">
      <strong className="text-zinc-100">How the clip is used:</strong> it is sent to the computer-vision service on this machine (device: {health.device}), which
      detects players, goalkeepers, referees and the ball with dedicated detection models, tracks them frame by frame and estimates the pitch geometry. No AI chat
      model or cloud service is involved. The upload is deleted when the job ends; DizPitch keeps only the derived tracking data. Limits:{' '}
      {health.limits.maxUploadMb} MB, segments of at most {health.limits.maxSegmentSeconds} s ({health.limits.formats.join(', ').toUpperCase()}).
    </p>
  );
}
