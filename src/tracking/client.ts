import { z } from 'zod';
import type { TrackingServiceResult } from '@/domain/tracking/build';
import { asServiceResult, trackingResultSchema } from './schema';

/**
 * Browser side of computer-vision tracking. Talks to the local cv-service through the same-origin
 * proxy (`/api/cv/...`): uploads the clip with real upload progress, polls the job's real progress,
 * then validates the result. Nothing here calls any AI or cloud service, and nothing retries on its own.
 */

const BASE = '/api/cv';

export class CvClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const healthSchema = z.object({
  status: z.enum(['ok', 'models_missing']),
  device: z.string(),
  models: z.object({ dir: z.string(), missing: z.array(z.string()) }),
  limits: z.object({
    maxUploadMb: z.number().positive(),
    maxSourceSeconds: z.number().positive(),
    maxSegmentSeconds: z.number().positive(),
    frameStride: z.number().int().positive(),
    formats: z.array(z.string()),
  }),
  resultTtlSeconds: z.number(),
});
export type CvHealth = z.infer<typeof healthSchema>;

const jobSchema = z.object({
  jobId: z.string(),
  state: z.enum(['queued', 'running', 'done', 'failed', 'cancelled']),
  progress: z.object({ stage: z.string(), done: z.number(), total: z.number() }).nullable().optional(),
  error: z.object({ code: z.string(), message: z.string() }).passthrough().nullable().optional(),
});

const scanSchema = z.object({
  source: z.object({ width: z.number(), height: z.number(), fps: z.number(), durationS: z.number() }).passthrough(),
  shots: z.array(z.object({ startS: z.number(), endS: z.number() }).passthrough()),
  suggestions: z.array(z.object({ startS: z.number(), durationS: z.number(), wideScore: z.number() })),
});
export type CvScan = z.infer<typeof scanSchema>;

/** What the UI shows while a job runs: the upload, then the service's own stage and frame counts. */
export type CvProgress = { phase: 'uploading'; fraction: number } | { phase: 'queued' } | { phase: 'processing'; stage: string; done: number; total: number };

type UploadFn = (url: string, body: FormData, onProgress: (fraction: number) => void, signal: AbortSignal) => Promise<{ status: number; body: unknown }>;

export interface CvTransport {
  fetch: typeof fetch;
  upload: UploadFn;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** XMLHttpRequest, because fetch cannot report upload progress. */
const xhrUpload: UploadFn = (url, body, onProgress, signal) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.responseType = 'text';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(String(xhr.responseText || 'null'));
      } catch {
        parsed = null;
      }
      resolve({ status: xhr.status, body: parsed });
    };
    xhr.onerror = () => reject(new CvClientError('network', 'The upload failed: the DizPitch server could not be reached.'));
    xhr.onabort = () => reject(new CvClientError('cancelled', 'Cancelled.'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });

const realSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new CvClientError('cancelled', 'Cancelled.'));
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new CvClientError('cancelled', 'Cancelled.'));
    }, { once: true });
  });

const defaultTransport = (): CvTransport => ({ fetch: (...args) => fetch(...args), upload: xhrUpload, sleep: realSleep });

function errorOf(body: unknown, status: number): CvClientError {
  const e = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  if (e && typeof e.message === 'string') return new CvClientError(typeof e.code === 'string' ? e.code : 'error', e.message);
  return new CvClientError('http_' + status, `The computer-vision service answered with HTTP ${status}.`);
}

async function getJson(t: CvTransport, path: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await t.fetch(`${BASE}/${path}`, { cache: 'no-store', signal });
  } catch {
    if (signal?.aborted) throw new CvClientError('cancelled', 'Cancelled.');
    throw new CvClientError('network', 'The DizPitch server could not be reached.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw errorOf(body, response.status);
  return body;
}

/** Service health, or a readable reason it is unavailable (not running, proxy misconfigured…). */
export async function fetchCvHealth(t: CvTransport = defaultTransport()): Promise<{ ok: true; health: CvHealth } | { ok: false; code: string; message: string }> {
  try {
    const parsed = healthSchema.safeParse(await getJson(t, 'health'));
    if (!parsed.success) return { ok: false, code: 'unexpected', message: 'The service at CV_SERVICE_URL is not the DizPitch computer-vision service.' };
    return { ok: true, health: parsed.data };
  } catch (e) {
    const err = e instanceof CvClientError ? e : new CvClientError('unexpected', 'The service could not be checked.');
    return { ok: false, code: err.code, message: err.message };
  }
}

const POLL_MS = 700;

/** Uploads, waits for the job while reporting real progress, returns the raw result. Deletes the job afterwards. */
async function runJob(kind: 'analyze' | 'scan', form: FormData, onProgress: (p: CvProgress) => void, signal: AbortSignal, t: CvTransport): Promise<unknown> {
  onProgress({ phase: 'uploading', fraction: 0 });
  const posted = await t.upload(`${BASE}/${kind}`, form, (fraction) => onProgress({ phase: 'uploading', fraction }), signal);
  if (posted.status !== 202) throw errorOf(posted.body, posted.status);
  const jobId = (posted.body as { jobId?: unknown } | null)?.jobId;
  if (typeof jobId !== 'string' || !/^[0-9a-f]{32}$/.test(jobId)) throw new CvClientError('unexpected', 'The service did not return a job id.');
  const forget = () => t.fetch(`${BASE}/jobs/${jobId}`, { method: 'DELETE' }).catch(() => undefined);
  try {
    for (;;) {
      const job = jobSchema.parse(await getJson(t, `jobs/${jobId}`, signal));
      if (job.state === 'done') break;
      if (job.state === 'failed') throw new CvClientError(job.error?.code ?? 'processing_error', job.error?.message ?? 'Processing failed.');
      if (job.state === 'cancelled') throw new CvClientError('cancelled', 'The job was cancelled.');
      onProgress(job.state === 'queued' || !job.progress ? { phase: 'queued' } : { phase: 'processing', ...job.progress });
      await t.sleep(POLL_MS, signal);
    }
    return await getJson(t, `results/${jobId}`, signal);
  } finally {
    // Cancels a running job (so the service stops work) and frees the result either way.
    void forget();
  }
}

export async function analyzeSegment(
  file: File,
  segment: { startSeconds: number; durationSeconds: number },
  onProgress: (p: CvProgress) => void,
  signal: AbortSignal,
  t: CvTransport = defaultTransport(),
): Promise<TrackingServiceResult> {
  const form = new FormData();
  form.set('video', file, file.name);
  form.set('startSeconds', String(segment.startSeconds));
  form.set('durationSeconds', String(segment.durationSeconds));
  const raw = await runJob('analyze', form, onProgress, signal, t);
  const parsed = trackingResultSchema.safeParse(raw);
  if (!parsed.success) {
    const where = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'result'}: ${i.message}`).join('; ');
    throw new CvClientError('invalid_result', `The service returned data DizPitch cannot read (${where}).`);
  }
  return asServiceResult(parsed.data);
}

export async function scanVideo(file: File, onProgress: (p: CvProgress) => void, signal: AbortSignal, t: CvTransport = defaultTransport()): Promise<CvScan> {
  const form = new FormData();
  form.set('video', file, file.name);
  const parsed = scanSchema.safeParse(await runJob('scan', form, onProgress, signal, t));
  if (!parsed.success) throw new CvClientError('invalid_result', 'The service returned a shot list DizPitch cannot read.');
  return parsed.data;
}
