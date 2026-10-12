import type { ReplayAnalysis } from '@/domain/types';
import { validateVideoUpload } from './media';
import { normalizeAnalysis } from './normalize';
import { videoAnalysisWireSchema } from './schema';
import type { VideoAnalysisMeta, VideoFailure, VideoProviderStatus } from './schema';

/** Browser side of video analysis: checks the clip, asks the DizPitch server, validates what comes back. */

export class VideoClientError extends Error {
  constructor(readonly failure: VideoFailure) {
    super(failure.message);
  }
}

const ENDPOINT = '/api/analyze-video';

type Fetch = typeof fetch;

/** Is analysis available, and under which limits? `null` when the server could not be reached. */
export async function fetchVideoStatus(fetchFn: Fetch = fetch): Promise<VideoProviderStatus | null> {
  try {
    const response = await fetchFn(ENDPOINT, { cache: 'no-store' });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<VideoProviderStatus>;
    if (typeof body.configured !== 'boolean' || !body.limits) return null;
    return {
      configured: body.configured,
      provider: 'gemini',
      model: typeof body.model === 'string' ? body.model : 'unknown',
      limits: body.limits,
      reason: typeof body.reason === 'string' ? body.reason : undefined,
    };
  } catch {
    return null;
  }
}

/** Reads the clip's duration from its own metadata (no upload). Null when the browser cannot decode it. */
export function readVideoDuration(file: Blob, timeoutMs = 8000): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return resolve(null);
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    let settled = false;
    const done = (value: number | null) => {
      if (settled) return;
      settled = true;
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
    video.onerror = () => done(null);
    setTimeout(() => done(null), timeoutMs);
    video.src = url;
  });
}

/** The same checks the server makes, so the user hears about a bad clip before uploading it. */
export async function checkClip(
  file: Blob,
  durationSeconds: number | null,
  limits: VideoProviderStatus['limits'],
): Promise<VideoFailure | null> {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const checked = validateVideoUpload({ sizeBytes: file.size, head, durationHintSeconds: durationSeconds }, limits);
  return checked.ok ? null : checked.failure;
}

/**
 * Sends one clip for analysis. Throws VideoClientError with a user-presentable
 * failure. There is deliberately no retry here: every call can cost money.
 */
export async function requestVideoAnalysis(
  file: Blob,
  durationSeconds: number | null,
  options: { fetchFn?: Fetch; signal?: AbortSignal } = {},
): Promise<{ analysis: ReplayAnalysis; meta: VideoAnalysisMeta }> {
  const fetchFn = options.fetchFn ?? fetch;
  const form = new FormData();
  form.append('video', file);
  if (durationSeconds !== null) form.append('durationSeconds', String(durationSeconds));

  let response: Response;
  try {
    response = await fetchFn(ENDPOINT, { method: 'POST', body: form, signal: options.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new VideoClientError({ code: 'network', message: 'Analysis was cancelled.', retryable: true });
    }
    throw new VideoClientError({
      code: 'network',
      message: 'Could not reach the DizPitch server. Check that it is running and try again.',
      retryable: true,
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new VideoClientError({
      code: 'unexpected',
      message: `The server did not return a readable answer (HTTP ${response.status}). Clip analysis needs the DizPitch server (npm run dev / npm start), not a static copy.`,
      retryable: false,
    });
  }

  const envelope = body as { ok?: unknown; analysis?: unknown; meta?: Partial<VideoAnalysisMeta>; error?: Partial<VideoFailure> };
  if (envelope.ok === true) {
    const parsed = videoAnalysisWireSchema.safeParse(envelope.analysis);
    if (!parsed.success) {
      throw new VideoClientError({ code: 'unexpected', message: 'The server returned an analysis in an unexpected shape.', retryable: true });
    }
    const meta = envelope.meta ?? {};
    const durationFromServer = typeof meta.durationSeconds === 'number' ? meta.durationSeconds : durationSeconds;
    return {
      // The server already normalised; doing it again is idempotent and keeps client-side guarantees.
      analysis: normalizeAnalysis(parsed.data, { durationSeconds: durationFromServer }),
      meta: {
        model: typeof meta.model === 'string' ? meta.model : 'unknown',
        samplingFps: typeof meta.samplingFps === 'number' ? meta.samplingFps : 0,
        durationSeconds: durationFromServer,
        analysedAt: typeof meta.analysedAt === 'string' ? meta.analysedAt : new Date().toISOString(),
      },
    };
  }
  const e = envelope.error ?? {};
  throw new VideoClientError({
    code: (e.code as VideoFailure['code']) ?? 'unexpected',
    message: typeof e.message === 'string' ? e.message : `Analysis failed (HTTP ${response.status}).`,
    retryable: e.retryable === true,
  });
}
