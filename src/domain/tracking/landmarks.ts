/**
 * Named pitch landmarks (metres on the 105 x 68 template, x from the left goal line as seen from the camera,
 * y from the far touchline) for manual calibration. Same template as cv-service/app/pitch.py.
 */
const L = 105;
const W = 68;
const PB = 16.5;
const PBW = 40.32;
const GB = 5.5;
const GBW = 18.32;
const R = 9.15;
const ARC = Math.sqrt(R * R - (PB - 11) ** 2);

export interface Landmark {
  id: string;
  label: string;
  pitchM: [number, number];
}

const side = (x0: number, sign: number, name: string): Landmark[] => [
  { id: `${name}-corner-far`, label: `${name} corner flag (far side)`, pitchM: [x0, 0] },
  { id: `${name}-corner-near`, label: `${name} corner flag (near side)`, pitchM: [x0, W] },
  { id: `${name}-box-goalline-far`, label: `${name} penalty box meets goal line (far)`, pitchM: [x0, (W - PBW) / 2] },
  { id: `${name}-box-goalline-near`, label: `${name} penalty box meets goal line (near)`, pitchM: [x0, (W + PBW) / 2] },
  { id: `${name}-box-far`, label: `${name} penalty box corner (far)`, pitchM: [x0 + sign * PB, (W - PBW) / 2] },
  { id: `${name}-box-near`, label: `${name} penalty box corner (near)`, pitchM: [x0 + sign * PB, (W + PBW) / 2] },
  { id: `${name}-goalarea-goalline-far`, label: `${name} goal area meets goal line (far)`, pitchM: [x0, (W - GBW) / 2] },
  { id: `${name}-goalarea-goalline-near`, label: `${name} goal area meets goal line (near)`, pitchM: [x0, (W + GBW) / 2] },
  { id: `${name}-goalarea-far`, label: `${name} goal area corner (far)`, pitchM: [x0 + sign * GB, (W - GBW) / 2] },
  { id: `${name}-goalarea-near`, label: `${name} goal area corner (near)`, pitchM: [x0 + sign * GB, (W + GBW) / 2] },
  { id: `${name}-spot`, label: `${name} penalty spot`, pitchM: [x0 + sign * 11, W / 2] },
  { id: `${name}-arc-far`, label: `${name} penalty arc meets box line (far)`, pitchM: [x0 + sign * PB, W / 2 - ARC] },
  { id: `${name}-arc-near`, label: `${name} penalty arc meets box line (near)`, pitchM: [x0 + sign * PB, W / 2 + ARC] },
];

export const LANDMARKS: readonly Landmark[] = [
  ...side(0, 1, 'Left'),
  { id: 'halfway-far', label: 'Halfway line meets far touchline', pitchM: [L / 2, 0] },
  { id: 'halfway-near', label: 'Halfway line meets near touchline', pitchM: [L / 2, W] },
  { id: 'centre-spot', label: 'Centre spot', pitchM: [L / 2, W / 2] },
  { id: 'circle-far', label: 'Centre circle meets halfway line (far)', pitchM: [L / 2, W / 2 - R] },
  { id: 'circle-near', label: 'Centre circle meets halfway line (near)', pitchM: [L / 2, W / 2 + R] },
  { id: 'circle-left', label: 'Centre circle, leftmost point', pitchM: [L / 2 - R, W / 2] },
  { id: 'circle-right', label: 'Centre circle, rightmost point', pitchM: [L / 2 + R, W / 2] },
  ...side(L, -1, 'Right'),
];

export const PITCH_LENGTH_M = L;
export const PITCH_WIDTH_M = W;

export function landmark(id: string): Landmark | undefined {
  return LANDMARKS.find((l) => l.id === id);
}

/** The template's line markings as polylines in metres (for projecting onto the video). */
export function pitchLinePolylines(): [number, number][][] {
  const circle = (cx: number, cy: number, r: number, from: number, to: number, n: number): [number, number][] =>
    Array.from({ length: n + 1 }, (_, i) => {
      const a = from + ((to - from) * i) / n;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    });
  const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  const arcHalf = Math.acos((PB - 11) / R);
  return [
    rect(0, 0, L, W),
    [[L / 2, 0], [L / 2, W]],
    circle(L / 2, W / 2, R, 0, 2 * Math.PI, 48),
    rect(0, (W - PBW) / 2, PB, (W + PBW) / 2),
    rect(L - PB, (W - PBW) / 2, L, (W + PBW) / 2),
    rect(0, (W - GBW) / 2, GB, (W + GBW) / 2),
    rect(L - GB, (W - GBW) / 2, L, (W + GBW) / 2),
    circle(11, W / 2, R, -arcHalf, arcHalf, 16),
    circle(L - 11, W / 2, R, Math.PI - arcHalf, Math.PI + arcHalf, 16),
  ];
}
