import type { AllowedImageType, ExtractionFailure, LineupExtractionOutput } from './schema';

/** Something that can read one lineup image. The service only depends on this. */
export interface LineupProvider {
  extract(image: { mediaType: AllowedImageType; data: string }): Promise<LineupExtractionOutput>;
}

/** Thrown by providers; carries the user-facing failure. */
export class ExtractionFailed extends Error {
  constructor(readonly failure: ExtractionFailure) {
    super(failure.message);
  }
}

export const fail = (code: ExtractionFailure['code'], message: string, retryable: boolean) =>
  new ExtractionFailed({ code, message, retryable });
