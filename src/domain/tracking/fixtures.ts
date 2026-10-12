import type { TrackingData, TrackingTrack } from '../types';

/** TEST FIXTURES ONLY: small hand-made tracking data with known geometry (identity "camera"). */

/** An image -> pitch-metres homography where 10 px = 1 m (image x = metres x 10). */
export const H_10PX: number[] = [0.1, 0, 0, 0, 0.1, 0, 0, 0, 1];
const IDENTITY: number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function track(id: string, frames: number[], xyMetres: (f: number) => [number, number], over: Partial<TrackingTrack> = {}): TrackingTrack {
  return {
    id,
    trackerId: Number(id.replace(/\D/g, '')) || null,
    objectType: 'player',
    team: 'A',
    side: null,
    playerId: null,
    hidden: false,
    mergedFrom: [],
    obs: {
      frame: frames,
      bbox: frames.map((f) => {
        const [x, y] = xyMetres(f);
        return [x * 10 - 5, y * 10 - 30, x * 10 + 5, y * 10] as [number, number, number, number];
      }),
      foot: frames.map((f) => {
        const [x, y] = xyMetres(f);
        return [x * 10, y * 10] as [number, number];
      }),
      pitch: frames.map((f) => {
        const [x, y] = xyMetres(f);
        return { x: (x / 105) * 100, y: (y / 68) * 100 };
      }),
      confidence: frames.map(() => 0.9),
      source: frames.map(() => 'detected' as const),
    },
    edits: {},
    ...over,
  };
}

export function trackingFixture(n = 50, fps = 25, tracks: TrackingTrack[] = []): TrackingData {
  return {
    schemaVersion: 1,
    source: { fileName: 'clip.mp4', width: 1280, height: 720, fps, durationS: 60 },
    segment: { startMs: 10_000, endMs: 10_000 + (n * 1000) / fps, frameStride: 1, processedFrames: n },
    frameTimesMs: Array.from({ length: n }, (_, i) => (i * 1000) / fps),
    calibration: {
      status: 'calibrated',
      method: 'test',
      perFrame: { source: Array(n).fill('keypoints'), errorM: Array(n).fill(0.3), shot: Array(n).fill(0) },
      homography: Array.from({ length: n }, () => [...H_10PX]),
      cameraMotion: Array.from({ length: n }, () => [...IDENTITY]),
      notes: [],
      autoRejected: false,
      manual: {},
    },
    teams: { clusters: [{ id: 'A', colorHex: '#eeeeee' }, { id: 'B', colorHex: '#cc3333' }], sideOf: { A: null, B: null } },
    tracks,
    models: [{ role: 'detector', name: 'test', licence: 'test' }],
    device: 'cpu',
    warnings: [],
  };
}
