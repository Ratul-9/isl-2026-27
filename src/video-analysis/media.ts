import { ALLOWED_VIDEO_TYPES } from './schema';
import type { AllowedVideoType, VideoFailure, VideoLimits } from './schema';

/**
 * Checks on an uploaded clip that need no decoding: the container is decided
 * from its first bytes (never from the file name or declared type), and the
 * size and duration hint are held against the configured limits.
 */

function ascii(bytes: Uint8Array, from: number, to: number): string {
  let out = '';
  for (let i = from; i < Math.min(to, bytes.length); i++) out += String.fromCharCode(bytes[i]);
  return out;
}

/** The container type from the leading bytes, or null when it is not one we accept. */
export function sniffVideoType(head: Uint8Array): AllowedVideoType | null {
  if (head.length >= 12 && ascii(head, 4, 8) === 'ftyp') {
    // Brands "qt  " are QuickTime (.mov); every other ISO-BMFF brand we accept is MP4-compatible.
    return ascii(head, 8, 12) === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  }
  const ebml = head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
  if (ebml && ascii(head, 0, Math.min(head.length, 64)).includes('webm')) return 'video/webm';
  return null;
}

const MB = 1024 * 1024;

export function validateVideoUpload(
  input: { sizeBytes: number; head: Uint8Array; durationHintSeconds: number | null },
  limits: VideoLimits,
): { ok: true; mimeType: AllowedVideoType } | { ok: false; failure: VideoFailure } {
  const bad = (code: VideoFailure['code'], message: string): { ok: false; failure: VideoFailure } => ({
    ok: false,
    failure: { code, message, retryable: false },
  });
  if (!(input.sizeBytes > 0)) return bad('invalid_request', 'The video file is empty.');
  if (input.sizeBytes > limits.maxBytes) {
    return bad('file_too_large', `The video is ${(input.sizeBytes / MB).toFixed(1)} MB; the limit is ${(limits.maxBytes / MB).toFixed(0)} MB. Trim or compress the clip.`);
  }
  const type = sniffVideoType(input.head);
  if (!type || !(ALLOWED_VIDEO_TYPES as readonly string[]).includes(type)) {
    return bad('unsupported_media', 'This is not an MP4, MOV or WebM video. Other formats are not supported.');
  }
  if (input.durationHintSeconds !== null && input.durationHintSeconds > limits.maxSeconds) {
    return bad('video_too_long', `The clip is ${Math.round(input.durationHintSeconds)} s long; the limit is ${limits.maxSeconds} s. Trim it to the moment you want analysed.`);
  }
  return { ok: true, mimeType: type };
}
