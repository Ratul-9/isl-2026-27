import { z } from 'zod';

/**
 * The structured answer the vision model must produce. Every field is present
 * (nullable when it cannot be read) so "not found" is explicit rather than an
 * omission. This is validated again after parsing: a model is an untrusted
 * data source.
 */
const player = z.object({
  /** Name exactly as displayed (case, accents, initials, punctuation). */
  name: z.string(),
  shirtNumber: z.number().nullable(),
  /** Position label only if the graphic displays one for this player. */
  position: z.string().nullable(),
  /** Centre of the player's label on the graphic's pitch, 0–1 from left. */
  x: z.number().nullable(),
  /** Centre of the player's label on the graphic's pitch, 0–1 from top. */
  y: z.number().nullable(),
  captain: z.boolean(),
  /** True when this entry was hard to read or partly hidden. */
  uncertain: z.boolean(),
  note: z.string().nullable(),
});

export const lineupExtractionSchema = z.object({
  teamName: z.string().nullable(),
  teamNameSource: z.enum(['text', 'crest', 'unknown']),
  coach: z.string().nullable(),
  formation: z.string().nullable(),
  goalkeeperEdge: z.enum(['top', 'bottom', 'left', 'right']).nullable(),
  starters: z.array(player),
  substitutes: z.array(player),
  warnings: z.array(z.string()),
});

export type LineupExtractionOutput = z.infer<typeof lineupExtractionSchema>;

export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg'] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/** Request body of POST /api/extract-lineup. */
export interface ExtractionRequest {
  mediaType: AllowedImageType;
  /** Base64 of the image bytes (no data: prefix). */
  data: string;
}

export type ExtractionErrorCode =
  | 'not_configured'
  | 'invalid_request'
  | 'unsupported_image'
  | 'image_too_large'
  | 'rate_limited'
  | 'provider_auth'
  | 'provider_unavailable'
  | 'timeout'
  | 'refused'
  | 'unreadable'
  | 'network'
  | 'unexpected';

export interface ExtractionFailure {
  code: ExtractionErrorCode;
  message: string;
  /** Trying the same image again could succeed. */
  retryable: boolean;
}

export interface ProviderStatus {
  configured: boolean;
  provider: 'gemini';
  model: string;
  /** Plain-language reason when not configured. Never contains secrets. */
  reason?: string;
}

/** Hard limits shared by client and server. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // keeps requests small (Gemini's inline request limit is 20 MB)
export const MAX_LONG_EDGE_PX = 1568; // Gemini tiles images at 768 px, so more resolution adds little here
