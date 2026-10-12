/** Checks a segment choice before anything is uploaded. Returns a readable reason, or null. Pure. */
export function segmentError(startS: number, durationS: number, fileDurationS: number | null, maxSegmentS: number): string | null {
  if (!Number.isFinite(startS) || startS < 0) return 'The start must be 0 s or later.';
  if (!Number.isFinite(durationS) || durationS <= 0) return 'The length must be more than 0 s.';
  if (durationS > maxSegmentS + 1e-9) return `A segment can be at most ${maxSegmentS} s long.`;
  if (fileDurationS !== null && startS >= fileDurationS) return `The video is only ${fileDurationS.toFixed(1)} s long.`;
  return null;
}

/** The segment actually processed: clipped to the end of the video when its length is known. */
export function clippedSegment(startS: number, durationS: number, fileDurationS: number | null): { startSeconds: number; durationSeconds: number } {
  const end = fileDurationS === null ? startS + durationS : Math.min(startS + durationS, fileDurationS);
  return { startSeconds: Math.round(startS * 1000) / 1000, durationSeconds: Math.round((end - startS) * 1000) / 1000 };
}

export const formatSeconds = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
