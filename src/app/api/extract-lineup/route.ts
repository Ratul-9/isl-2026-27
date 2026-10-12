import { connection } from 'next/server';
import { createGeminiProvider } from '@/lineup-extraction/geminiProvider';
import { readExtractionConfig, statusFromConfig } from '@/lineup-extraction/config';
import { MAX_IMAGE_BYTES } from '@/lineup-extraction/schema';
import type { ExtractionErrorCode } from '@/lineup-extraction/schema';
import { extractLineup } from '@/lineup-extraction/service';

/**
 * Server-side lineup extraction. The Gemini API key lives only in this
 * process's environment; the browser sends the image here and never sees it.
 *
 * This endpoint spends API credit for whoever can reach it. Run DizPitch on a
 * trusted network, or put authentication/rate limiting in front of it.
 */

const STATUS_FOR: Record<ExtractionErrorCode, number> = {
  not_configured: 503,
  invalid_request: 400,
  unsupported_image: 415,
  image_too_large: 413,
  rate_limited: 429,
  provider_auth: 502,
  provider_unavailable: 502,
  timeout: 504,
  refused: 422,
  unreadable: 422,
  network: 502,
  unexpected: 500,
};

/** Reports whether extraction is available, without revealing any secret. */
export async function GET() {
  // Env vars are read per request, never frozen into a prerender.
  await connection();
  return Response.json(statusFromConfig(readExtractionConfig()), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  await connection();
  const config = readExtractionConfig();
  const json = (body: unknown, status: number) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  const failure = (code: ExtractionErrorCode, message: string, retryable = false) =>
    json({ ok: false, error: { code, message, retryable } }, STATUS_FOR[code]);

  if (!config.apiKey) {
    return failure('not_configured', statusFromConfig(config).reason ?? 'Image extraction is not configured.');
  }

  // Refuse oversize bodies before reading them (base64 is ~4/3 of the bytes).
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4096) {
    return failure('image_too_large', `The image is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB. Use a smaller image.`);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure('invalid_request', 'The request body is not valid JSON.');
  }

  const provider = createGeminiProvider({ apiKey: config.apiKey, model: config.model, baseUrl: config.baseUrl ?? undefined });
  const result = await extractLineup(body, provider);
  if (!result.ok) return failure(result.failure.code, result.failure.message, result.failure.retryable);
  return json({ ok: true, lineup: result.lineup, model: config.model }, 200);
}
