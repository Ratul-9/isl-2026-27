import type { TrackingData, TrackingTrack } from '../types';
import { applyH, invert } from './homography';
import type { Mat3, Vec2 } from './homography';
import { pitchLinePolylines } from './landmarks';

/** Geometry for drawing tracking data over the source video. Pure. */

/** Index of `frame` in a track's observations, or -1. */
export function observationIndex(track: TrackingTrack, frame: number): number {
  const f = track.obs.frame;
  let lo = 0;
  let hi = f.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (f[mid] === frame) return mid;
    if (f[mid] < frame) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

export interface FrameBox {
  track: TrackingTrack;
  bbox: [number, number, number, number];
  interpolated: boolean;
  rejected: boolean;
  corrected: boolean;
}

/** Detector boxes (image pixels) shown at a frame. Hidden tracks are left out. */
export function frameBoxes(tracking: TrackingData, frame: number): FrameBox[] {
  const out: FrameBox[] = [];
  for (const track of tracking.tracks) {
    if (track.hidden) continue;
    const i = observationIndex(track, frame);
    if (i < 0) continue;
    const edit = track.edits[String(frame)];
    out.push({ track, bbox: track.obs.bbox[i], interpolated: track.obs.source[i] === 'interpolated', rejected: edit?.kind === 'rejected', corrected: edit?.kind === 'position' });
  }
  return out;
}

/** Where a `contentW x contentH` video sits inside a `boxW x boxH` element with object-fit: contain. */
export function containRect(contentW: number, contentH: number, boxW: number, boxH: number): { x: number; y: number; scale: number } {
  if (!(contentW > 0 && contentH > 0 && boxW > 0 && boxH > 0)) return { x: 0, y: 0, scale: 1 };
  const scale = Math.min(boxW / contentW, boxH / contentH);
  return { x: (boxW - contentW * scale) / 2, y: (boxH - contentH * scale) / 2, scale };
}

/**
 * The pitch markings projected into the image with `H` (image -> metres). Lines are densified so the parts
 * behind the camera or far outside the picture can be dropped; each returned polyline is drawable as is.
 */
export function projectedPitchLines(H: Mat3, imageW: number, imageH: number): Vec2[][] {
  const toImage = invert(H);
  if (!toImage) return [];
  // The sign of w for points in front of the camera: take the pitch point under the image centre.
  const centre = applyH(H, [imageW / 2, imageH / 2]);
  if (!centre) return [];
  const wOf = (m: Vec2) => toImage[6] * m[0] + toImage[7] * m[1] + toImage[8];
  const visibleSign = Math.sign(wOf(centre));
  const limit = 4 * Math.max(imageW, imageH);
  const out: Vec2[][] = [];
  for (const line of pitchLinePolylines()) {
    let current: Vec2[] = [];
    const flush = () => {
      if (current.length > 1) out.push(current);
      current = [];
    };
    for (let i = 0; i < line.length; i++) {
      const a = line[i];
      const b = line[i + 1];
      const steps = b ? Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2)) : 1;
      for (let s = 0; s < (b ? steps : 1); s++) {
        const m: Vec2 = b ? [a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps] : a;
        const w = wOf(m);
        const p = Math.sign(w) === visibleSign && Math.abs(w) > 1e-9 ? applyH(toImage, m) : null;
        if (!p || Math.abs(p[0]) > limit || Math.abs(p[1]) > limit) flush();
        else current.push(p);
      }
    }
    flush();
  }
  return out;
}
