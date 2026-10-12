import { z } from 'zod';
import { REPLAY_EVENT_TYPES } from '@/domain/replay/eventTypes';
import type { ReplayEventType } from '@/domain/types';

/**
 * What Gemini is asked to return for a clip. Numbers are deliberately NOT
 * bounded here: a model that answers x = 104 must not lose the whole analysis.
 * `normalize.ts` clamps and cleans; this schema only checks the structure.
 *
 * Coordinates are 0–100 in the ATTACKING team's frame: x from the goal line it
 * defends (0) to the goal it attacks (100); y from its left touchline (0) to
 * its right (100), looking in its attacking direction.
 */

const eventType = z.enum(REPLAY_EVENT_TYPES as unknown as [ReplayEventType, ...ReplayEventType[]]);
const point = z.object({ x: z.number(), y: z.number() });

export const videoAnalysisWireSchema = z.object({
  summary: z.string(),
  primaryEvent: z
    .object({
      type: eventType,
      description: z.string(),
      startSeconds: z.number(),
      endSeconds: z.number(),
      matchClock: z.string().nullable(),
      period: z.string().nullable(),
      attackingTeam: z.string().nullable(),
      defendingTeam: z.string().nullable(),
      outcome: z.string().nullable(),
      confidence: z.number(),
      evidence: z.array(z.string()),
      unknowns: z.array(z.string()),
    })
    .nullable(),
  otherEvents: z.array(
    z.object({
      type: eventType,
      description: z.string(),
      startSeconds: z.number(),
      endSeconds: z.number(),
      confidence: z.number(),
    }),
  ),
  actors: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['player', 'ball']),
      team: z.enum(['attacking', 'defending', 'unknown']),
      kit: z.string().nullable(),
      shirtNumber: z.number().nullable(),
      name: z.string().nullable(),
      role: z.string().nullable(),
      identityConfidence: z.number(),
      identityEvidence: z.string().nullable(),
    }),
  ),
  keyframes: z.array(
    z.object({
      timeSeconds: z.number(),
      note: z.string().nullable(),
      positions: z.array(
        z.object({
          actorId: z.string(),
          x: z.number(),
          y: z.number(),
          confidence: z.number(),
          basis: z.enum(['observed', 'estimated']),
        }),
      ),
    }),
  ),
  trajectories: z.array(
    z.object({
      kind: z.enum(['pass', 'lofted_pass', 'shot', 'run']),
      actorId: z.string().nullable(),
      targetActorId: z.string().nullable(),
      startSeconds: z.number(),
      endSeconds: z.number(),
      from: point,
      to: point,
      outcome: z.enum(['completed', 'intercepted', 'blocked', 'saved', 'goal', 'off_target', 'unknown']),
      confidence: z.number(),
    }),
  ),
  timeline: z.array(z.object({ timeSeconds: z.number(), label: z.string(), eventType: eventType.nullable() })),
  warnings: z.array(z.string()),
});

export type VideoAnalysisWire = z.infer<typeof videoAnalysisWireSchema>;

// --- transport -----------------------------------------------------------------------

export const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;
export type AllowedVideoType = (typeof ALLOWED_VIDEO_TYPES)[number];

export type VideoErrorCode =
  | 'not_configured'
  | 'invalid_request'
  | 'unsupported_media'
  | 'file_too_large'
  | 'video_too_long'
  | 'processing_failed'
  | 'processing_timeout'
  | 'rate_limited'
  | 'provider_auth'
  | 'provider_unavailable'
  | 'timeout'
  | 'refused'
  | 'unreadable'
  | 'network'
  | 'unexpected';

export interface VideoFailure {
  code: VideoErrorCode;
  message: string;
  /** Asking again could succeed. (Never retried automatically: each attempt can cost money.) */
  retryable: boolean;
}

/** Limits the client may check before uploading; the server enforces them again. */
export interface VideoLimits {
  maxBytes: number;
  maxSeconds: number;
  samplingFps: number;
  types: readonly string[];
}

export interface VideoProviderStatus {
  configured: boolean;
  provider: 'gemini';
  model: string;
  limits: VideoLimits;
  reason?: string;
}

/** Facts about the analysis run, stored with the replay as provenance. */
export interface VideoAnalysisMeta {
  model: string;
  samplingFps: number;
  durationSeconds: number | null;
  analysedAt: string;
}
