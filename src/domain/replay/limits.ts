/** Bounds on a stored replay, shared by validation, the importer and the editor. */
export const MAX_REPLAYS_PER_MATCH = 20;
export const MAX_ACTORS = 30;
export const MAX_KEYFRAMES = 80;
export const MAX_PATHS = 60;
export const MAX_ANNOTATIONS = 40;
export const MAX_REPLAY_SECONDS = 300;
export const MAX_TITLE = 80;
export const MAX_TEXT = 300;
export const MAX_LONG_TEXT = 2000;
export const MAX_EVIDENCE_ITEMS = 12;
/** Below this an identity (name / shirt number) read by the model is not carried into the replay. */
export const IDENTITY_MIN_CONFIDENCE = 0.5;
/** Two keyframes closer than this are the same moment. */
export const KEYFRAME_EPSILON_SECONDS = 0.05;
