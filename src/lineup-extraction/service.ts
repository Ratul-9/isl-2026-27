import type { ExtractedLineup } from '@/domain/lineupImport/types';
import { ExtractionFailed } from './provider';
import type { LineupProvider } from './provider';
import { sniffImageType } from './imageType';
import { normalizeOutput } from './normalize';
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from './schema';
import type { ExtractionFailure, ExtractionRequest } from './schema';

/** Request handling shared by the API route and tests: validate → provider → normalise. */

export type ExtractionResult =
  | { ok: true; lineup: ExtractedLineup }
  | { ok: false; failure: ExtractionFailure };

function decodeBase64(data: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 !== 0) return null;
  try {
    return Uint8Array.from(Buffer.from(data, 'base64'));
  } catch {
    return null;
  }
}

/** Validates an untrusted request body. */
export function validateRequest(body: unknown): { ok: true; request: ExtractionRequest } | { ok: false; failure: ExtractionFailure } {
  const bad = (code: ExtractionFailure['code'], message: string): { ok: false; failure: ExtractionFailure } => ({
    ok: false,
    failure: { code, message, retryable: false },
  });
  if (typeof body !== 'object' || body === null) return bad('invalid_request', 'The request must be a JSON object.');
  const { mediaType, data } = body as Record<string, unknown>;
  if (typeof mediaType !== 'string' || !(ALLOWED_IMAGE_TYPES as readonly string[]).includes(mediaType)) {
    return bad('unsupported_image', 'Only PNG and JPEG images are supported.');
  }
  if (typeof data !== 'string' || data.length === 0) return bad('invalid_request', 'The image data is missing.');
  // Cheap size check before decoding: base64 is 4/3 the size of the bytes.
  if (data.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4) {
    return bad('image_too_large', `The image is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB. Use a smaller image.`);
  }
  const bytes = decodeBase64(data);
  if (!bytes) return bad('invalid_request', 'The image data is not valid base64.');
  const real = sniffImageType(bytes);
  if (!real) return bad('unsupported_image', 'This does not look like a PNG or JPEG image.');
  if (real !== mediaType) return bad('unsupported_image', `The file is a ${real}, not a ${mediaType}.`);
  return { ok: true, request: { mediaType: real, data } };
}

export async function extractLineup(body: unknown, provider: LineupProvider): Promise<ExtractionResult> {
  const checked = validateRequest(body);
  if (!checked.ok) return checked;
  try {
    const output = await provider.extract(checked.request);
    return { ok: true, lineup: normalizeOutput(output) };
  } catch (error) {
    if (error instanceof ExtractionFailed) return { ok: false, failure: error.failure };
    return { ok: false, failure: { code: 'unexpected', message: 'Reading the image failed unexpectedly.', retryable: true } };
  }
}
