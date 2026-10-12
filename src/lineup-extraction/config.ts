import type { ProviderStatus } from './schema';

/**
 * Default model: Google's recommended general-purpose Gemini model at the time
 * of writing. Override with LINEUP_EXTRACTION_MODEL (a "-flash-lite" model is
 * cheaper; it has not been evaluated for this task).
 */
export const DEFAULT_MODEL = 'gemini-3.8-flash';

export interface ExtractionConfig {
  apiKey: string | null;
  model: string;
  /** Optional endpoint override (proxy / local stand-in). Not secret, not exposed. */
  baseUrl: string | null;
}

/**
 * Server-side configuration from environment variables. The API key is read
 * here and only here; nothing in this module returns or logs it.
 */
export function readExtractionConfig(env: Record<string, string | undefined> = process.env): ExtractionConfig {
  const key = env.GEMINI_API_KEY?.trim();
  const baseUrl = env.GEMINI_BASE_URL?.trim();
  return {
    apiKey: key ? key : null,
    model: env.LINEUP_EXTRACTION_MODEL?.trim() || DEFAULT_MODEL,
    baseUrl: baseUrl ? baseUrl : null,
  };
}

export function statusFromConfig(config: ExtractionConfig): ProviderStatus {
  if (config.apiKey) return { configured: true, provider: 'gemini', model: config.model };
  return {
    configured: false,
    provider: 'gemini',
    model: config.model,
    reason: 'No GEMINI_API_KEY is set on the DizPitch server, so images cannot be read automatically.',
  };
}
