/** Bounds on stored tracking data (a 15 s clip at 50 fps is 750 frames; fragments can be numerous). */
export const MAX_TRACKING_FRAMES = 3000;
export const MAX_TRACKS = 400;
export const MAX_OBSERVATIONS = 60000;
export const MAX_MANUAL_POINTS = 40;
/** Two observations further apart than this are a GAP: nothing is drawn between them. */
export const MAX_INTERPOLATION_GAP_S = 0.5;
/** How long the last observation is still shown after it (covers one dropped frame). */
export const HOLD_S = 0.06;
