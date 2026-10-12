import type { CvProgress } from '@/tracking/client';

const STAGES: Record<string, string> = {
  validating: 'Checking the video',
  'loading models': 'Loading the detection models',
  'detecting and tracking': 'Detecting and tracking',
  calibrating: 'Estimating the pitch geometry',
  assembling: 'Assembling tracks and teams',
  'scanning shots': 'Finding camera cuts and wide shots',
  done: 'Finishing',
};

/** Real progress as reported by the upload and by the service; nothing is simulated. */
export function JobProgressView({ progress, label }: { progress: CvProgress; label: string }) {
  let text: string;
  let fraction: number | null;
  if (progress.phase === 'uploading') {
    text = `Uploading the video… ${Math.round(progress.fraction * 100)}%`;
    fraction = progress.fraction;
  } else if (progress.phase === 'queued') {
    text = 'Waiting for the service to start…';
    fraction = null;
  } else {
    const stage = STAGES[progress.stage] ?? progress.stage;
    const counted = progress.total > 1;
    text = counted ? `${stage}: frame ${progress.done} of ${progress.total}` : `${stage}…`;
    fraction = counted ? progress.done / progress.total : null;
  }
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-1.5">
      <p className="text-sm text-emerald-300">{text}</p>
      <div className="h-2 overflow-hidden rounded bg-zinc-800">
        {fraction === null ? (
          <div className="h-full w-1/3 animate-pulse rounded bg-emerald-700/70" />
        ) : (
          <div className="h-full rounded bg-emerald-600 transition-[width]" style={{ width: `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%` }} />
        )}
      </div>
    </div>
  );
}
