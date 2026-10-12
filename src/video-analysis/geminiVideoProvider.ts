import { FileState, FinishReason, GoogleGenAI } from '@google/genai';
import type { File as GeminiFile, GenerateContentParameters, GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import { classifyGeminiError, replyText, toGeminiSchema } from '@/lib/gemini';
import { buildSystemPrompt, USER_PROMPT } from './prompt';
import { failVideo, VideoAnalysisFailed } from './provider';
import type { VideoProvider } from './provider';
import { videoAnalysisWireSchema } from './schema';

/** What the provider needs from the SDK; a fake in unit tests, the real client otherwise. */
export interface GeminiVideoClient {
  files: {
    upload(params: { file: Blob; config?: { mimeType?: string; displayName?: string } }): Promise<GeminiFile>;
    get(params: { name: string }): Promise<GeminiFile>;
    delete(params: { name: string }): Promise<unknown>;
  };
  models: { generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse> };
}

export interface GeminiVideoProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  samplingFps: number;
  maxSeconds: number;
  processingTimeoutMs: number;
  analysisTimeoutMs: number;
  /** Poll interval while Google processes the upload. */
  pollIntervalMs?: number;
  client?: GeminiVideoClient;
  sleep?: (ms: number) => Promise<void>;
}

/** JSON Schema sent to Gemini, derived from the zod schema that validates the reply. */
export const GEMINI_VIDEO_RESPONSE_SCHEMA = toGeminiSchema(z.toJSONSchema(videoAnalysisWireSchema)) as Record<string, unknown>;

const MAX_OUTPUT_TOKENS = 32_768;

/** "12.5s" → 12.5. */
export function parseDuration(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const m = /^\s*([\d.]+)\s*s?\s*$/.exec(value);
  const n = m ? Number(m[1]) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

const REFUSAL_REASONS: readonly string[] = [
  FinishReason.SAFETY,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.BLOCKLIST,
  FinishReason.SPII,
  FinishReason.RECITATION,
];

/**
 * Analyses a clip with Gemini via the official SDK.
 *
 * 1. Upload with the Files API (the documented route for video) and wait for
 *    Google's asynchronous processing to finish.
 * 2. Check the measured duration against the configured limit.
 * 3. ONE generateContent call, with the frame rate set explicitly through
 *    `videoMetadata.fps` (the default of 1 fps misses passes and shots) and the
 *    reply constrained to a JSON schema. Never retried automatically: each
 *    attempt can cost money, so a retry is the user's explicit choice.
 * 4. Delete the uploaded file (best effort), success or not.
 */
export function createGeminiVideoProvider(options: GeminiVideoProviderOptions): VideoProvider {
  const client: GeminiVideoClient =
    options.client ??
    (new GoogleGenAI({
      apiKey: options.apiKey,
      httpOptions: {
        ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
        timeout: options.analysisTimeoutMs,
        retryOptions: { attempts: 1 },
      },
    }) as unknown as GeminiVideoClient);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pollMs = options.pollIntervalMs ?? 1000;

  return {
    async analyze({ data, mimeType, durationHintSeconds }) {
      let uploaded: GeminiFile | null = null;
      try {
        try {
          uploaded = await client.files.upload({ file: data, config: { mimeType, displayName: 'dizpitch-clip' } });
        } catch (error) {
          throw translateVideoError(error);
        }
        if (!uploaded.name) throw failVideo('unexpected', 'The video service did not accept the upload.', true);

        // Processing is asynchronous: the file is unusable until it is ACTIVE.
        const deadline = Date.now() + options.processingTimeoutMs;
        let file = uploaded;
        while (file.state === FileState.PROCESSING || file.state === undefined || file.state === FileState.STATE_UNSPECIFIED) {
          if (Date.now() >= deadline) {
            throw failVideo('processing_timeout', 'The video service took too long to process the clip. Try a shorter clip or try again.', true);
          }
          await sleep(pollMs);
          try {
            file = await client.files.get({ name: uploaded.name });
          } catch (error) {
            throw translateVideoError(error);
          }
        }
        if (file.state === FileState.FAILED) {
          throw failVideo('processing_failed', 'The video service could not process this clip. It may be corrupt or use an unsupported codec.', false);
        }
        if (!file.uri) throw failVideo('unexpected', 'The video service did not return a usable file.', true);

        const measured = parseDuration(file.videoMetadata?.videoDuration);
        const durationSeconds = measured ?? durationHintSeconds;
        if (durationSeconds !== null && durationSeconds > options.maxSeconds) {
          throw failVideo('video_too_long', `The clip is ${Math.round(durationSeconds)} s long; the limit is ${options.maxSeconds} s. Trim it to the moment you want analysed.`, false);
        }

        let response: GenerateContentResponse;
        try {
          response = await client.models.generateContent({
            model: options.model,
            contents: [
              {
                role: 'user',
                parts: [
                  { fileData: { fileUri: file.uri, mimeType: file.mimeType ?? mimeType }, videoMetadata: { fps: options.samplingFps } },
                  { text: USER_PROMPT },
                ],
              },
            ],
            config: {
              systemInstruction: buildSystemPrompt({ samplingFps: options.samplingFps, durationSeconds }),
              responseMimeType: 'application/json',
              responseJsonSchema: GEMINI_VIDEO_RESPONSE_SCHEMA,
              maxOutputTokens: MAX_OUTPUT_TOKENS,
            },
          });
        } catch (error) {
          throw translateVideoError(error);
        }

        const finish = response.candidates?.[0]?.finishReason;
        if (response.promptFeedback?.blockReason || (finish && REFUSAL_REASONS.includes(finish))) {
          throw failVideo('refused', 'The video service declined to analyse this clip. Try a different clip or annotate it by hand.', false);
        }
        if (finish === FinishReason.MAX_TOKENS) {
          throw failVideo('unreadable', 'The analysis ran out of room before finishing, so it would be incomplete. Try a shorter clip.', true);
        }
        const body = replyText(response).trim();
        if (body === '') throw failVideo('unreadable', 'The video service returned no analysis for this clip.', true);
        let json: unknown;
        try {
          json = JSON.parse(body);
        } catch {
          throw failVideo('unreadable', 'The video service returned an analysis that could not be read. Try again, or annotate the clip by hand.', true);
        }
        const parsed = videoAnalysisWireSchema.safeParse(json);
        if (!parsed.success) {
          throw failVideo('unreadable', 'The video service returned an analysis in an unexpected format. Try again, or annotate the clip by hand.', true);
        }
        return { wire: parsed.data, durationSeconds, samplingFps: options.samplingFps, model: options.model };
      } finally {
        if (uploaded?.name) {
          // Best effort: the clip should not stay with the provider longer than needed.
          void client.files.delete({ name: uploaded.name }).catch(() => undefined);
        }
      }
    },
  };
}

/** Maps SDK/HTTP errors to messages that are safe to show (no key, no raw provider body). */
export function translateVideoError(error: unknown): VideoAnalysisFailed {
  if (error instanceof VideoAnalysisFailed) return error;
  const { kind, status } = classifyGeminiError(error);
  switch (kind) {
    case 'auth':
      return failVideo('provider_auth', "The server's Gemini API key was rejected or lacks permission. Check GEMINI_API_KEY on the DizPitch server.", false);
    case 'rate_limit':
      return failVideo('rate_limited', 'The video service is rate-limited or out of quota right now. Wait a moment and try again.', true);
    case 'timeout':
      return failVideo('timeout', 'The video service took too long to answer. Try a shorter clip or try again.', true);
    case 'model_not_found':
      return failVideo('provider_unavailable', 'The configured Gemini model was not found. Check GEMINI_MODEL on the DizPitch server.', false);
    case 'region':
      return failVideo('provider_unavailable', 'The Gemini API is not available for this key or region (billing or free-tier availability). Check your Google AI Studio project.', false);
    case 'bad_format':
      return failVideo('unexpected', "The video service rejected DizPitch's request format (HTTP 400). This is probably a version mismatch; please report it.", false);
    case 'bad_input':
      return failVideo('unsupported_media', 'The video service could not accept this clip (it may be corrupt or use an unsupported codec).', false);
    case 'server':
      return failVideo('provider_unavailable', 'The video service had a temporary problem. Try again in a moment.', true);
    case 'network':
      return failVideo('network', 'The server could not reach the video service. Check its internet connection and try again.', true);
    case 'http':
      return failVideo('unexpected', `The video service returned an error (HTTP ${status}).`, false);
    default:
      return failVideo('unexpected', 'Analysing the clip failed unexpectedly.', true);
  }
}
