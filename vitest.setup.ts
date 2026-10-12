import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// The video features are off by default in the app; the existing suites exercise them, so they are on here.
// Tests of the "off" behaviour override this (vi.stubEnv / the `videoAnalysis` prop).
process.env.NEXT_PUBLIC_VIDEO_ANALYSIS = 'on';

afterEach(() => {
  cleanup();
});
