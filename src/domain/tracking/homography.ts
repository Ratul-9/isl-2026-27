/**
 * Planar homographies for manual pitch calibration. Pure. Matrices are row-major arrays of 9 numbers.
 * Estimation uses the normalised DLT (Hartley): points are centred and scaled before solving, which keeps the
 * linear system well conditioned with pixel-sized coordinates.
 */

export type Mat3 = number[]; // length 9, row-major
export type Vec2 = [number, number];

export function applyH(H: Mat3, p: Vec2): Vec2 | null {
  const w = H[6] * p[0] + H[7] * p[1] + H[8];
  if (!Number.isFinite(w) || Math.abs(w) < 1e-12) return null;
  return [(H[0] * p[0] + H[1] * p[1] + H[2]) / w, (H[3] * p[0] + H[4] * p[1] + H[5]) / w];
}

export function multiply(A: Mat3, B: Mat3): Mat3 {
  const out = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c];
  return out;
}

export function invert(M: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = M;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-15) return null;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
}

function normaliser(points: Vec2[]): Mat3 {
  const n = points.length;
  const cx = points.reduce((s, p) => s + p[0], 0) / n;
  const cy = points.reduce((s, p) => s + p[1], 0) / n;
  const meanDist = points.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / n || 1;
  const k = Math.SQRT2 / meanDist;
  return [k, 0, -k * cx, 0, k, -k * cy, 0, 0, 1];
}

/** Solves A x = b (n x n) by Gaussian elimination with partial pivoting; null when singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Twice the area of the convex hull, used to reject (nearly) collinear point sets. */
function hullArea(points: Vec2[]): number {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  let area = 0;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i];
    const [x2, y2] = hull[(i + 1) % hull.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

/** Least-squares homography from >= 4 correspondences (src -> dst), or null when degenerate. */
export function estimateHomography(src: Vec2[], dst: Vec2[]): Mat3 | null {
  if (src.length < 4 || src.length !== dst.length) return null;
  const Ts = normaliser(src);
  const Td = normaliser(dst);
  const s = src.map((p) => applyH(Ts, p) as Vec2);
  const d = dst.map((p) => applyH(Td, p) as Vec2);
  // h33 = 1; normal equations of the 2n x 8 DLT system.
  const ATA = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  const ATb = new Array<number>(8).fill(0);
  for (let i = 0; i < s.length; i++) {
    const [x, y] = s[i];
    const [u, v] = d[i];
    const rows: [number[], number][] = [
      [[x, y, 1, 0, 0, 0, -u * x, -u * y], u],
      [[0, 0, 0, x, y, 1, -v * x, -v * y], v],
    ];
    for (const [row, rhs] of rows) {
      for (let r = 0; r < 8; r++) {
        ATb[r] += row[r] * rhs;
        for (let c = 0; c < 8; c++) ATA[r][c] += row[r] * row[c];
      }
    }
  }
  const h = solve(ATA, ATb);
  if (!h) return null;
  const Hn: Mat3 = [...h, 1];
  const TdInv = invert(Td);
  if (!TdInv) return null;
  const H = multiply(multiply(TdInv, Hn), Ts);
  return H.map((v) => v / H[8]);
}

export interface CalibrationFit {
  H: Mat3;
  /** Median leave-one-out error in destination units (metres), when 5+ points; else null. */
  errorM: number | null;
}

/** Fits image -> pitch metres, rejecting too few or (nearly) collinear points. Throws a readable Error. */
export function fitCalibration(image: Vec2[], pitchM: Vec2[]): CalibrationFit {
  if (image.length < 4) throw new Error('At least 4 landmarks are needed.');
  if (hullArea(pitchM) < 10) throw new Error('The landmarks are (nearly) on one line. Choose points spread over the visible pitch.');
  if (hullArea(image) < 50) throw new Error('The clicked image points are (nearly) on one line.');
  const H = estimateHomography(image, pitchM);
  if (!H) throw new Error('No homography fits these points.');
  let errorM: number | null = null;
  if (image.length >= 5) {
    const errs: number[] = [];
    for (let i = 0; i < image.length; i++) {
      const keep = image.map((_, j) => j !== i);
      const Hi = estimateHomography(image.filter((_, j) => keep[j]), pitchM.filter((_, j) => keep[j]));
      const p = Hi ? applyH(Hi, image[i]) : null;
      if (p) errs.push(Math.hypot(p[0] - pitchM[i][0], p[1] - pitchM[i][1]));
    }
    errs.sort((a, b) => a - b);
    errorM = errs.length ? errs[Math.floor(errs.length / 2)] : null;
  }
  return { H, errorM };
}
