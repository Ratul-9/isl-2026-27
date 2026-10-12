import { ALLOWED_VIDEO_TYPES } from './schema';
import type { VideoLimits, VideoProviderStatus } from './schema';

/**
 * Server-side configuration. Every limit is an environment variable so a
 * deployment can tune cost and capacity without code changes. The API key is
 * read here and only here; nothing in this module returns or logs it.
 */

export const DEFAULT_VIDEO_MODEL = 'gemini-3.8-flash';
export const DEFAULT_MAX_MB = 50;
const DEFAULT_MAX_SECONDS = 60;
/** Gemini's own default is 1 fps, too coarse for a pass or a shot; its valid range is (0, 24]. */
const DEFAULT_SAMPLING_FPS = 5;
const DEFAULT_PROCESSING_TIMEOUT_MS = 120_000;
const DEFAULT_ANALYSIS_TIMEOUT_MS = 180_000;
const MAX_SAMPLING_FPS = 24;

export interface VideoConfig {
  apiKey: string | null;
  model: string;
  baseUrl: string | null;
  limits: VideoLimits;
  processingTimeoutMs: number;
  analysisTimeoutMs: number;
}

function positive(value: string | undefined, fallback: number, max = Number.POSITIVE_INFINITY): number {
  const n = Number(value?.trim());
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

export function readVideoConfig(env: Record<string, string | undefined> = process.env): VideoConfig {
  const key = env.GEMINI_API_KEY?.trim();
  const baseUrl = env.GEMINI_BASE_URL?.trim();
  return {
    apiKey: key ? key : null,
    model: env.GEMINI_MODEL?.trim() || DEFAULT_VIDEO_MODEL,
    baseUrl: baseUrl ? baseUrl : null,
    limits: {
      maxBytes: Math.round(positive(env.VIDEO_MAX_MB, DEFAULT_MAX_MB) * 1024 * 1024),
      maxSeconds: positive(env.VIDEO_MAX_SECONDS, DEFAULT_MAX_SECONDS),
      samplingFps: positive(env.VIDEO_SAMPLING_FPS, DEFAULT_SAMPLING_FPS, MAX_SAMPLING_FPS),
      types: ALLOWED_VIDEO_TYPES,
    },
    processingTimeoutMs: positive(env.VIDEO_PROCESSING_TIMEOUT_MS, DEFAULT_PROCESSING_TIMEOUT_MS),
    analysisTimeoutMs: positive(env.VIDEO_ANALYSIS_TIMEOUT_MS, DEFAULT_ANALYSIS_TIMEOUT_MS),
  };
}

export function videoStatusFromConfig(config: VideoConfig): VideoProviderStatus {
  const base = { provider: 'gemini' as const, model: config.model, limits: config.limits };
  if (config.apiKey) return { configured: true, ...base };
  return {
    configured: false,
    ...base,
    reason: 'No GEMINI_API_KEY is set on the DizPitch server, so video clips cannot be analysed automatically.',
  };
}
