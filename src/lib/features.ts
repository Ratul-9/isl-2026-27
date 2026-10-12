/**
 * Feature switches read from the environment at build time (`NEXT_PUBLIC_*`, so the browser and the server agree).
 * Each one is OFF unless explicitly turned on, so a deployment that forgets the variable exposes nothing.
 */

/**
 * Video analysis: "AI sketch from a clip" (Gemini) and "Track a video" (the computer-vision service).
 * Set `NEXT_PUBLIC_VIDEO_ANALYSIS=on` to enable. When off, the buttons show "Coming soon" and the API routes refuse.
 */
export function videoAnalysisEnabled(): boolean {
  return process.env.NEXT_PUBLIC_VIDEO_ANALYSIS === 'on';
}
