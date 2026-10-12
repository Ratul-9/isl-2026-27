import { ApiError } from '@google/genai';
import type { GenerateContentResponse } from '@google/genai';

/** Gemini helpers shared by every feature that calls the API (lineup images, video clips). Server-side use. */

type JsonNode = Record<string, unknown>;

/**
 * Rewrites a zod-generated JSON Schema into the subset Gemini documents:
 * nullable values as `type: [t, "null"]` (no `anyOf`), no `$schema`. A nullable
 * enum loses its `enum` (stated in the description instead); zod re-validates
 * the reply, so the constraint is still enforced after parsing.
 */
export function toGeminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (typeof node !== 'object' || node === null) return node;
  const input = node as JsonNode;
  const anyOf = input.anyOf;
  if (Array.isArray(anyOf) && anyOf.length === 2) {
    const isNull = (v: unknown) => typeof v === 'object' && v !== null && (v as JsonNode).type === 'null';
    const nonNull = anyOf.find((v) => !isNull(v)) as JsonNode | undefined;
    if (anyOf.some(isNull) && nonNull && typeof nonNull.type === 'string') {
      const { enum: values, ...rest } = nonNull;
      const description = Array.isArray(values) ? `One of: ${values.join(', ')}; or null when it cannot be determined.` : undefined;
      return toGeminiSchema({ ...rest, type: [nonNull.type, 'null'], ...(description ? { description } : {}) });
    }
  }
  const out: JsonNode = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === '$schema') continue;
    out[key] = toGeminiSchema(value);
  }
  return out;
}

/** Concatenates the visible (non-"thought") text parts of the first candidate. */
export function replyText(response: GenerateContentResponse): string {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => typeof part.text === 'string' && part.thought !== true)
    .map((part) => part.text as string)
    .join('');
}

type GeminiErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'model_not_found'
  | 'region'
  | 'bad_format'
  | 'bad_input'
  | 'server'
  | 'network'
  | 'http'
  | 'unknown';

export interface ClassifiedGeminiError {
  kind: GeminiErrorKind;
  status?: number;
}

/**
 * Sorts an SDK/HTTP error into a kind. Callers map kinds to their own failure
 * codes and wording, so neither the key nor the provider's raw body can leak.
 */
export function classifyGeminiError(error: unknown): ClassifiedGeminiError {
  if (error instanceof ApiError) {
    const { status } = error;
    const detail = String(error.message);
    if (status === 401 || status === 403 || /api[ _-]?key[^"]{0,40}(not valid|invalid|expired)|API_KEY_INVALID/i.test(detail)) {
      return { kind: 'auth', status };
    }
    if (status === 429) return { kind: 'rate_limit', status };
    if (status === 408 || status === 504) return { kind: 'timeout', status };
    if (status === 404) return { kind: 'model_not_found', status };
    if (status === 400 && /FAILED_PRECONDITION|location is not supported|billing/i.test(detail)) return { kind: 'region', status };
    if (status === 400 && /response[_ ]?(json[_ ])?schema|json payload|unknown name|invalid json|schema/i.test(detail)) {
      return { kind: 'bad_format', status };
    }
    if (status === 400) return { kind: 'bad_input', status };
    if (status >= 500) return { kind: 'server', status };
    return { kind: 'http', status };
  }
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return { kind: 'timeout' };
    if (error instanceof TypeError || /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|network/i.test(error.message)) return { kind: 'network' };
  }
  return { kind: 'unknown' };
}
