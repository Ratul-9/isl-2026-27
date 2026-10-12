import type { Mat3, Vec2 } from '@/domain/tracking/homography';
import { containRect, frameBoxes, projectedPitchLines } from '@/domain/tracking/overlay';
import { frameAt, frameCalibrationSource, frameHomography } from '@/domain/tracking/sample';
import type { TrackingData } from '@/domain/types';
import { PITCH_THEME as T } from '@/components/pitch/pitchTheme';
import { trackColours, trackLabel } from './trackStyle';
import type { TrackNames } from './trackStyle';

export interface OverlayOptions {
  boxes: boolean;
  ids: boolean;
  lines: boolean;
}

interface OverlayInput {
  tracking: TrackingData;
  solver: (shot: number) => Mat3 | null;
  names: TrackNames;
  options: OverlayOptions;
  selectedTrackId: string | null;
  calibrating: { image: Vec2; label: string }[];
}

const CALIBRATION_TEXT: Record<ReturnType<typeof frameCalibrationSource>, string> = {
  keypoints: 'Pitch lines: automatic (unverified) — check they match the video',
  propagated: 'Pitch lines: automatic, carried from a nearby frame (unverified)',
  manual: 'Pitch lines: your manual calibration',
  rejected: 'Automatic calibration rejected — no pitch positions',
  none: 'No calibration for this frame — no pitch positions',
};

/** Paints boxes, IDs and projected markings for the frame shown at `mediaTimeS` (seconds in the source video). */
export function drawOverlay(canvas: HTMLCanvasElement, video: HTMLVideoElement, mediaTimeS: number, input: OverlayInput): void {
  const { tracking, options } = input;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  const { width: W, height: H } = tracking.source;
  const fit = containRect(video.videoWidth || W, video.videoHeight || H, cw, ch);
  const k = ((video.videoWidth || W) / W) * fit.scale;
  const px = (p: Vec2): Vec2 => [fit.x + p[0] * k, fit.y + p[1] * k];

  const rel = mediaTimeS * 1000 - tracking.segment.startMs;
  const last = tracking.frameTimesMs[tracking.frameTimesMs.length - 1] ?? 0;
  ctx.font = '600 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  if (rel < -1 || rel > last + 1000 / tracking.source.fps) {
    caption(ctx, 'Outside the tracked segment', 8, 18);
    return;
  }
  const frame = frameAt(tracking, rel + 1);

  if (options.lines) {
    const Hf = frameHomography(tracking, frame, input.solver);
    if (Hf) {
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.85)';
      ctx.lineWidth = 1.5;
      for (const line of projectedPitchLines(Hf, W, H)) {
        ctx.beginPath();
        line.map(px).forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.stroke();
      }
    }
    caption(ctx, CALIBRATION_TEXT[frameCalibrationSource(tracking, frame)], 8, ch - 10);
  }

  if (options.boxes) {
    for (const box of frameBoxes(tracking, frame)) {
      const [x0, y0] = px([box.bbox[0], box.bbox[1]]);
      const [x1, y1] = px([box.bbox[2], box.bbox[3]]);
      const selected = box.track.id === input.selectedTrackId;
      const colour = box.track.objectType === 'ball' ? T.pass : trackColours(tracking, box.track).fill;
      ctx.setLineDash(box.interpolated ? [4, 3] : []);
      ctx.lineWidth = selected ? 3 : 1.5;
      ctx.strokeStyle = box.rejected ? '#ef4444' : selected ? T.selection : colour;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([]);
      if (box.rejected) {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.moveTo(x1, y0);
        ctx.lineTo(x0, y1);
        ctx.stroke();
      }
      if (options.ids && box.track.objectType !== 'ball') {
        const label = trackLabel(tracking, box.track, input.names);
        caption(ctx, box.track.playerId ? label.inside : label.below, x0, y0 - 3, selected ? T.selection : '#ffffff');
      }
    }
  }

  input.calibrating.forEach((p, i) => {
    const [x, y] = px(p.image);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 7, y);
    ctx.lineTo(x + 7, y);
    ctx.moveTo(x, y - 7);
    ctx.lineTo(x, y + 7);
    ctx.stroke();
    caption(ctx, `${i + 1}`, x + 6, y - 6, '#facc15');
  });
  caption(ctx, `Frame ${frame + 1}/${tracking.frameTimesMs.length}`, cw - 96, 18);
}

function caption(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, colour = '#ffffff') {
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
}
