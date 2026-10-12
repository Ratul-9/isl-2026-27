import type { ExtractedLineup } from '@/domain/lineupImport/types';
import { lineupExtractionSchema } from './schema';
import type { ExtractionFailure, ProviderStatus } from './schema';
import { normalizeOutput } from './normalize';
import type { PreparedImage } from './imageFile';

/** Browser-side client for POST/GET /api/extract-lineup. */

export class ExtractionClientError extends Error {
  constructor(readonly failure: ExtractionFailure) {
    super(failure.message);
  }
}

const ENDPOINT = '/api/extract-lineup';

type Fetch = typeof fetch;

/** Is automatic reading available? `null` when the server could not be reached. */
export async function fetchProviderStatus(fetchFn: Fetch = fetch): Promise<ProviderStatus | null> {
  try {
    const response = await fetchFn(ENDPOINT, { cache: 'no-store' });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<ProviderStatus>;
    if (typeof body.configured !== 'boolean') return null;
    return {
      configured: body.configured,
      provider: 'gemini',
      model: typeof body.model === 'string' ? body.model : 'unknown',
      reason: typeof body.reason === 'string' ? body.reason : undefined,
    };
  } catch {
    return null;
  }
}

/** Sends one prepared image for reading. Throws ExtractionClientError with a user-presentable failure. */
export async function requestExtraction(
  image: Pick<PreparedImage, 'mediaType' | 'data'>,
  options: { fetchFn?: Fetch; signal?: AbortSignal } = {},
): Promise<ExtractedLineup> {
  const fetchFn = options.fetchFn ?? fetch;
  let response: Response;
  try {
    response = await fetchFn(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mediaType: image.mediaType, data: image.data }),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ExtractionClientError({ code: 'network', message: 'Reading was cancelled.', retryable: true });
    }
    throw new ExtractionClientError({
      code: 'network',
      message: 'Could not reach the DizPitch server. Check that it is running and try again.',
      retryable: true,
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ExtractionClientError({
      code: 'unexpected',
      message: `The server did not return a readable answer (HTTP ${response.status}). Image reading needs the DizPitch server (npm run dev / npm start), not a static copy.`,
      retryable: false,
    });
  }

  const envelope = body as { ok?: unknown; lineup?: unknown; error?: Partial<ExtractionFailure> };
  if (envelope.ok === true) {
    const parsed = lineupExtractionSchema.safeParse(envelope.lineup);
    if (!parsed.success) {
      throw new ExtractionClientError({ code: 'unexpected', message: 'The server returned a lineup in an unexpected shape.', retryable: true });
    }
    // The server already normalised; running it again is idempotent and keeps client-side guarantees.
    return normalizeOutput(parsed.data);
  }
  const e = envelope.error ?? {};
  throw new ExtractionClientError({
    code: (e.code as ExtractionFailure['code']) ?? 'unexpected',
    message: typeof e.message === 'string' ? e.message : `Reading failed (HTTP ${response.status}).`,
    retryable: e.retryable === true,
  });
}
