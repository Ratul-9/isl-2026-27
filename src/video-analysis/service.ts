import type { ReplayAnalysis } from '@/domain/types';
import { validateVideoUpload } from './media';
import { normalizeAnalysis } from './normalize';
import { VideoAnalysisFailed } from './provider';
import type { VideoProvider } from './provider';
import type { VideoAnalysisMeta, VideoFailure, VideoLimits } from './schema';

export type VideoAnalysisResult =
  | { ok: true; analysis: ReplayAnalysis; meta: VideoAnalysisMeta }
  | { ok: false; failure: VideoFailure };

/** Request handling shared by the API route and tests: validate → provider → normalise. */
export async function analyzeVideo(
  input: { data: Blob; durationHintSeconds: number | null },
  deps: { provider: VideoProvider; limits: VideoLimits; now?: () => Date },
): Promise<VideoAnalysisResult> {
  const head = new Uint8Array(await input.data.slice(0, 64).arrayBuffer());
  const checked = validateVideoUpload(
    { sizeBytes: input.data.size, head, durationHintSeconds: input.durationHintSeconds },
    deps.limits,
  );
  if (!checked.ok) return checked;

  try {
    const result = await deps.provider.analyze({
      data: input.data,
      mimeType: checked.mimeType,
      durationHintSeconds: input.durationHintSeconds,
    });
    const analysis = normalizeAnalysis(result.wire, { durationSeconds: result.durationSeconds });
    return {
      ok: true,
      analysis,
      meta: {
        model: result.model,
        samplingFps: result.samplingFps,
        durationSeconds: result.durationSeconds,
        analysedAt: (deps.now?.() ?? new Date()).toISOString(),
      },
    };
  } catch (error) {
    if (error instanceof VideoAnalysisFailed) return { ok: false, failure: error.failure };
    return { ok: false, failure: { code: 'unexpected', message: 'Analysing the clip failed unexpectedly.', retryable: true } };
  }
}
