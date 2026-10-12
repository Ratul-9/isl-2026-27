import { connection } from 'next/server';
import { videoAnalysisEnabled } from '@/lib/features';
import { readVideoConfig, videoStatusFromConfig } from '@/video-analysis/config';
import { createGeminiVideoProvider } from '@/video-analysis/geminiVideoProvider';
import type { VideoErrorCode } from '@/video-analysis/schema';
import { analyzeVideo } from '@/video-analysis/service';

/**
 * Server-side video analysis. The Gemini API key lives only in this process's
 * environment; the browser sends the clip here and never sees it.
 *
 * This endpoint spends API quota for whoever can reach it, and each call
 * uploads the clip to Google. Run DizPitch on a trusted network, or put
 * authentication and rate limiting in front of it. Nothing here retries a
 * paid analysis on its own.
 */

const STATUS_FOR: Record<VideoErrorCode, number> = {
  not_configured: 503,
  invalid_request: 400,
  unsupported_media: 415,
  file_too_large: 413,
  video_too_long: 413,
  processing_failed: 422,
  processing_timeout: 504,
  rate_limited: 429,
  provider_auth: 502,
  provider_unavailable: 502,
  timeout: 504,
  refused: 422,
  unreadable: 422,
  network: 502,
  unexpected: 500,
};

const COMING_SOON = 'Video analysis is coming soon.';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const failure = (code: VideoErrorCode, message: string, retryable = false) =>
  json({ ok: false, error: { code, message, retryable } }, STATUS_FOR[code]);

/** Reports whether analysis is available and the limits in force, without revealing any secret. */
export async function GET() {
  await connection(); // env is read per request, never frozen into a prerender
  if (!videoAnalysisEnabled()) return failure('not_configured', COMING_SOON);
  return json(videoStatusFromConfig(readVideoConfig()));
}

export async function POST(request: Request) {
  await connection();
  // Switched off: refuse before reading the upload or the key (nothing is sent to Google).
  if (!videoAnalysisEnabled()) return failure('not_configured', COMING_SOON);
  const config = readVideoConfig();
  if (!config.apiKey) {
    return failure('not_configured', videoStatusFromConfig(config).reason ?? 'Video analysis is not configured.');
  }

  // Refuse oversize bodies before reading them (multipart adds a little overhead).
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > config.limits.maxBytes + 1024 * 1024) {
    return failure('file_too_large', `The video is larger than ${Math.round(config.limits.maxBytes / (1024 * 1024))} MB. Trim or compress the clip.`);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return failure('invalid_request', 'The request must be a multipart form with a "video" file.');
  }
  const file = form.get('video');
  if (!(file instanceof Blob)) return failure('invalid_request', 'The request has no "video" file.');
  const hintRaw = form.get('durationSeconds');
  const hint = typeof hintRaw === 'string' && hintRaw.trim() !== '' ? Number(hintRaw) : Number.NaN;

  const provider = createGeminiVideoProvider({
    apiKey: config.apiKey,
    model: config.model,
    baseUrl: config.baseUrl ?? undefined,
    samplingFps: config.limits.samplingFps,
    maxSeconds: config.limits.maxSeconds,
    processingTimeoutMs: config.processingTimeoutMs,
    analysisTimeoutMs: config.analysisTimeoutMs,
  });
  const result = await analyzeVideo(
    { data: file, durationHintSeconds: Number.isFinite(hint) && hint >= 0 ? hint : null },
    { provider, limits: config.limits },
  );
  if (!result.ok) return failure(result.failure.code, result.failure.message, result.failure.retryable);
  return json({ ok: true, analysis: result.analysis, meta: result.meta });
}
