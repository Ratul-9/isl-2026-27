import type { VideoAnalysisWire, VideoFailure } from './schema';

/** Something that can analyse one clip. The service depends only on this, so the AI provider can be swapped. */
export interface VideoProvider {
  analyze(input: {
    data: Blob;
    mimeType: string;
    /** Client-declared duration, used only when the provider cannot measure it. */
    durationHintSeconds: number | null;
  }): Promise<VideoProviderResult>;
}

interface VideoProviderResult {
  wire: VideoAnalysisWire;
  /** Measured by the provider when it can, else the hint, else null. */
  durationSeconds: number | null;
  samplingFps: number;
  model: string;
}

/** Thrown by providers; carries the user-facing failure. */
export class VideoAnalysisFailed extends Error {
  constructor(readonly failure: VideoFailure) {
    super(failure.message);
  }
}

export const failVideo = (code: VideoFailure['code'], message: string, retryable: boolean) =>
  new VideoAnalysisFailed({ code, message, retryable });
