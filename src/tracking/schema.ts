import { z } from 'zod';
import type { TrackingServiceResult } from '@/domain/tracking/build';

/**
 * Validates what the cv-service returns (its schemaVersion 1, `cv-service/app/schemas.py`) before anything
 * is used. Unknown fields are stripped; structural problems are reported with their path.
 */

const num = z.number().finite();
const point = z.array(num).length(2);

export const trackingResultSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.object({ fileName: z.string().nullable(), width: z.number().int().positive(), height: z.number().int().positive(), fps: z.number().positive(), durationS: z.number().min(0) }),
  segment: z.object({ startMs: z.number().min(0), endMs: z.number().min(0), frameStride: z.number().int().positive(), processedFrames: z.number().int().min(0) }),
  models: z.array(z.object({ role: z.string(), name: z.string(), licence: z.string() })),
  device: z.string(),
  frames: z.object({ tMs: z.array(z.number().min(0)) }),
  calibration: z.object({
    status: z.enum(['calibrated', 'partial', 'unavailable']),
    method: z.string(),
    perFrame: z.object({
      source: z.array(z.enum(['keypoints', 'propagated', 'manual', 'none'])),
      errorM: z.array(z.number().min(0).nullable()),
      shot: z.array(z.number().int().min(0)),
    }),
    homography: z.array(z.array(num).length(9).nullable()),
    cameraMotion: z.array(z.array(num).length(9)),
    notes: z.array(z.string()),
  }),
  teams: z.object({ clusters: z.array(z.object({ id: z.enum(['A', 'B']), colorHex: z.string().regex(/^#[0-9a-f]{6}$/i) })) }),
  tracks: z.array(
    z.object({
      trackId: z.string().min(1).max(40),
      trackerId: z.number().int().min(0).nullable(),
      objectType: z.enum(['player', 'goalkeeper', 'referee', 'ball']),
      team: z.enum(['A', 'B', 'unknown']).nullable(),
      mergedFrom: z.array(z.number().int().min(0)).default([]),
      observations: z.object({
        frame: z.array(z.number().int().min(0)),
        bbox: z.array(z.array(num).length(4)),
        foot: z.array(point),
        pitch: z.array(z.array(z.number().min(0).max(100)).length(2).nullable()),
        confidence: z.array(z.number().min(0).max(1).nullable()),
        source: z.array(z.enum(['detected', 'interpolated'])),
      }),
    }),
  ),
  warnings: z.array(z.string()),
});

/** Compile-time proof that a validated result is what the domain builder expects. */
export function asServiceResult(parsed: z.infer<typeof trackingResultSchema>): TrackingServiceResult {
  return parsed satisfies TrackingServiceResult;
}
