import { FinishReason, GoogleGenAI } from '@google/genai';
import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import { classifyGeminiError, replyText, toGeminiSchema } from '@/lib/gemini';
import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_USER_PROMPT } from './prompt';
import { ExtractionFailed, fail } from './provider';
import type { LineupProvider } from './provider';
import { lineupExtractionSchema } from './schema';

export interface GeminiProviderOptions {
  apiKey: string;
  model: string;
  /** Overrides the API endpoint (a proxy or a local stand-in in tests). The key is sent there. */
  baseUrl?: string;
  /** Total attempts for retryable HTTP errors (429/5xx), including the first. Default 3. */
  maxAttempts?: number;
  /** Seconds before the first retry. Default 1. */
  retryDelaySeconds?: number;
  /** Injected in tests; defaults to a real client. */
  client?: { models: { generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse> } };
}

/** JSON Schema sent to Gemini, derived from the zod schema that validates the reply. */
export const GEMINI_RESPONSE_SCHEMA = toGeminiSchema(z.toJSONSchema(lineupExtractionSchema)) as Record<string, unknown>;

const MAX_OUTPUT_TOKENS = 16_384;
const REQUEST_TIMEOUT_MS = 120_000;

const REFUSAL_REASONS: readonly string[] = [
  FinishReason.SAFETY,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.BLOCKLIST,
  FinishReason.SPII,
  FinishReason.RECITATION,
];

/**
 * Reads a lineup image with Gemini vision via the official `@google/genai` SDK.
 *
 * - The image is sent only to Google's Gemini API, from this server process.
 * - The reply is constrained to a JSON schema (`responseMimeType` +
 *   `responseJsonSchema`) and validated again with zod: a model is an
 *   untrusted data source.
 * - Blocks, refusals and truncation are surfaced, never treated as "no players".
 */
export function createGeminiProvider(options: GeminiProviderOptions): LineupProvider {
  const client =
    options.client ??
    new GoogleGenAI({
      apiKey: options.apiKey,
      httpOptions: {
        ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
        timeout: REQUEST_TIMEOUT_MS,
        retryOptions: { attempts: options.maxAttempts ?? 3, initialDelay: options.retryDelaySeconds ?? 1 },
      },
    });

  return {
    async extract(image) {
      let response: GenerateContentResponse;
      try {
        response = await client.models.generateContent({
          model: options.model,
          contents: [
            {
              role: 'user',
              parts: [{ inlineData: { mimeType: image.mediaType, data: image.data } }, { text: EXTRACTION_USER_PROMPT }],
            },
          ],
          config: {
            systemInstruction: EXTRACTION_SYSTEM_PROMPT,
            responseMimeType: 'application/json',
            responseJsonSchema: GEMINI_RESPONSE_SCHEMA,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
          },
        });
      } catch (error) {
        throw translateError(error);
      }

      const blocked = response.promptFeedback?.blockReason;
      const candidate = response.candidates?.[0];
      const finish = candidate?.finishReason;
      if (blocked || (finish && REFUSAL_REASONS.includes(finish))) {
        throw fail('refused', 'The vision service declined to read this image. Try a different image or enter the lineup manually.', false);
      }
      if (finish === FinishReason.MAX_TOKENS) {
        throw fail('unreadable', 'The model ran out of room before finishing, so the result would be incomplete. Try again.', true);
      }

      const text = replyText(response).trim();
      if (text === '') {
        throw fail('unreadable', 'The vision service did not return a lineup for this image. Try again, or enter the lineup manually.', true);
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw fail('unreadable', 'The vision service did not return a valid lineup for this image. Try again, or enter the lineup manually.', true);
      }
      const parsed = lineupExtractionSchema.safeParse(json);
      if (!parsed.success) {
        throw fail('unreadable', 'The vision service did not return a valid lineup for this image. Try again, or enter the lineup manually.', true);
      }
      return parsed.data;
    },
  };
}

/**
 * Maps SDK/HTTP errors to messages that are safe to show: neither the key nor
 * the provider's raw error body ever reaches the user.
 */
export function translateError(error: unknown): ExtractionFailed {
  if (error instanceof ExtractionFailed) return error;
  const { kind, status } = classifyGeminiError(error);
  switch (kind) {
    case 'auth':
      return fail('provider_auth', "The server's Gemini API key was rejected or lacks permission. Check GEMINI_API_KEY on the DizPitch server.", false);
    case 'rate_limit':
      return fail('rate_limited', 'The vision service is rate-limited or out of quota right now. Wait a moment and try again.', true);
    case 'timeout':
      return fail('timeout', 'The vision service took too long to answer. Try again.', true);
    case 'model_not_found':
      return fail('provider_unavailable', 'The configured Gemini model was not found. Check LINEUP_EXTRACTION_MODEL on the DizPitch server.', false);
    case 'region':
      return fail('provider_unavailable', 'The Gemini API is not available for this key or region (billing or free-tier availability). Check your Google AI Studio project.', false);
    case 'bad_format':
      return fail('unexpected', "The vision service rejected DizPitch's request format (HTTP 400). This is probably a version mismatch; please report it.", false);
    case 'bad_input':
      return fail('unsupported_image', 'The vision service could not accept this image (it may be corrupt or an unsupported format).', false);
    case 'server':
      return fail('provider_unavailable', 'The vision service had a temporary problem. Try again in a moment.', true);
    case 'network':
      return fail('provider_unavailable', 'The server could not reach the vision service. Check its internet connection and try again.', true);
    case 'http':
      return fail('unexpected', `The vision service returned an error (HTTP ${status}).`, false);
    default:
      return fail('unexpected', 'Reading the image failed unexpectedly.', true);
  }
}
