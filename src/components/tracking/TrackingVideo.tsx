'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { Mat3, Vec2 } from '@/domain/tracking/homography';
import { containRect } from '@/domain/tracking/overlay';
import { frameAt } from '@/domain/tracking/sample';
import type { TrackingData } from '@/domain/types';
import { drawOverlay } from './drawOverlay';
import type { OverlayOptions } from './drawOverlay';
import type { TrackNames } from './trackStyle';

/** Keeps the video within this many seconds of the replay clock while playing (it is exact when paused). */
const MAX_DRIFT_S = 0.12;

interface TrackingVideoProps {
  url: string;
  tracking: TrackingData;
  /** Replay clock, seconds from the start of the segment. */
  time: number;
  playing: boolean;
  speed: number;
  solver: (shot: number) => Mat3 | null;
  names: TrackNames;
  options: OverlayOptions;
  selectedTrackId: string | null;
  /** While calibrating, clicks on the picture report image pixels; pending points are drawn. */
  calibrating?: { points: { image: Vec2; label: string }[]; onPick: (image: Vec2) => void };
}

/**
 * The user's own video beside the pitch, with detector boxes, tracker IDs and the projected pitch markings
 * drawn for the frame the video is showing. The replay clock is the only clock: the video follows it.
 */
export function TrackingVideo({ url, tracking, time, playing, speed, solver, names, options, selectedTrackId, calibrating }: TrackingVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const startS = tracking.segment.startMs / 1000;
  const halfFrame = 0.5 / tracking.source.fps;

  // Follow the clock: native playback (drift-corrected) while playing, an exact frame seek when paused.
  const follow = useEffectEvent(() => {
    const v = videoRef.current;
    if (!v || v.readyState < 1) return;
    v.playbackRate = speed;
    if (playing) {
      const target = startS + time;
      if (Math.abs(v.currentTime - target) > MAX_DRIFT_S) v.currentTime = target;
      if (v.paused) void v.play().catch(() => undefined);
    } else {
      if (!v.paused) v.pause();
      const frame = frameAt(tracking, time * 1000 + 1);
      const exact = startS + (tracking.frameTimesMs[frame] ?? 0) / 1000 + halfFrame;
      if (Math.abs(v.currentTime - exact) > 0.002) v.currentTime = exact;
    }
  });
  useEffect(() => follow(), [time, playing, speed, startS, halfFrame, tracking]);

  const draw = useEffectEvent((mediaTimeS?: number) => {
    const v = videoRef.current;
    const canvas = canvasRef.current;
    if (!v || !canvas) return;
    drawOverlay(canvas, v, mediaTimeS ?? v.currentTime, { tracking, solver, names, options, selectedTrackId, calibrating: calibrating?.points ?? [] });
  });

  // Redraw for every frame the video presents (requestVideoFrameCallback where supported) and after seeks/resizes.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    let vfc = 0;
    // requestVideoFrameCallback is missing in some browsers even though the DOM typings declare it.
    const video = v as Omit<HTMLVideoElement, 'requestVideoFrameCallback'> & { requestVideoFrameCallback?: HTMLVideoElement['requestVideoFrameCallback'] };
    const hasVfc = typeof video.requestVideoFrameCallback === 'function';
    if (hasVfc) {
      const onFrame: VideoFrameRequestCallback = (_now, meta) => {
        draw(meta.mediaTime);
        vfc = v.requestVideoFrameCallback(onFrame);
      };
      vfc = v.requestVideoFrameCallback(onFrame);
    }
    // Without requestVideoFrameCallback: repaint on animation frames, but only while the video plays.
    const loop = () => {
      draw();
      raf = v.paused ? 0 : requestAnimationFrame(loop);
    };
    const onPlay = () => {
      if (hasVfc || raf) return;
      raf = requestAnimationFrame(loop);
    };
    const redraw = () => draw();
    // A video attached mid-replay starts at the clock's frame, not at the segment start.
    const onMetadata = () => follow();
    v.addEventListener('loadedmetadata', onMetadata);
    v.addEventListener('play', onPlay);
    v.addEventListener('seeked', redraw);
    v.addEventListener('loadeddata', redraw);
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(redraw) : null;
    resize?.observe(v);
    return () => {
      cancelAnimationFrame(raf);
      if (vfc) v.cancelVideoFrameCallback(vfc);
      v.removeEventListener('loadedmetadata', onMetadata);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('seeked', redraw);
      v.removeEventListener('loadeddata', redraw);
      resize?.disconnect();
    };
  }, [url]);

  // Data or display options changed: repaint the current frame.
  useEffect(() => draw(), [tracking, options, selectedTrackId, calibrating]);

  function onPointerDown(e: PointerEvent<HTMLCanvasElement>) {
    const v = videoRef.current;
    if (!calibrating || !v) return;
    const r = e.currentTarget.getBoundingClientRect();
    const fit = containRect(v.videoWidth || tracking.source.width, v.videoHeight || tracking.source.height, r.width, r.height);
    const k = ((v.videoWidth || tracking.source.width) / tracking.source.width) * fit.scale;
    const x = (e.clientX - r.left - fit.x) / k;
    const y = (e.clientY - r.top - fit.y) / k;
    if (x < 0 || y < 0 || x > tracking.source.width || y > tracking.source.height) return;
    calibrating.onPick([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  }

  return (
    <div className="relative overflow-hidden rounded-md border border-zinc-800 bg-black" style={{ aspectRatio: `${tracking.source.width} / ${tracking.source.height}` }}>
      <video
        ref={videoRef}
        src={url}
        muted
        playsInline
        preload="auto"
        aria-label="Source video"
        className="absolute inset-0 h-full w-full object-contain"
        onError={() => setFailed(true)}
      />
      <canvas
        ref={canvasRef}
        aria-hidden
        data-testid="video-overlay"
        className="absolute inset-0 h-full w-full"
        style={{ pointerEvents: calibrating ? 'auto' : 'none', cursor: calibrating ? 'crosshair' : undefined }}
        onPointerDown={onPointerDown}
      />
      {failed ? (
        <p role="alert" className="absolute inset-x-0 bottom-0 bg-black/80 p-2 text-xs text-red-200">
          This browser cannot play the video file. The tracking data is still shown on the pitch.
        </p>
      ) : null}
    </div>
  );
}
