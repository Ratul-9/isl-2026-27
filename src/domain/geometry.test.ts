import { describe, expect, it } from 'vitest';
import {
  clampPoint,
  clientToPitch,
  clientToViewBox,
  distanceMetres,
  fromTeamFrame,
  fromView,
  nudge,
  shortenSegment,
  PITCH_LENGTH,
  PITCH_WIDTH,
  snapPoint,
  toTeamFrame,
  toView,
  viewBoxFor,
} from './geometry';
import type { Orientation } from './geometry';

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

describe('team frame', () => {
  it('is the identity for home and a 180° rotation for away', () => {
    const leftBack = { x: 0.17, y: 0.14 };
    expect(fromTeamFrame(leftBack, 'home')).toEqual(leftBack);
    close(fromTeamFrame(leftBack, 'away'), { x: 0.83, y: 0.86 });
  });

  it('keeps each team’s left-sided players on that team’s left', () => {
    // Home attacks toward x = 1 (screen right): its left is the top (y < 0.5).
    expect(fromTeamFrame({ x: 0.2, y: 0.1 }, 'home').y).toBeLessThan(0.5);
    // Away attacks toward x = 0 (screen left): its left is the bottom (y > 0.5).
    expect(fromTeamFrame({ x: 0.2, y: 0.1 }, 'away').y).toBeGreaterThan(0.5);
    // Both own halves: home x < 0.5, away x > 0.5.
    expect(fromTeamFrame({ x: 0.2, y: 0.5 }, 'away').x).toBeGreaterThan(0.5);
  });

  it('round-trips', () => {
    const p = { x: 0.31, y: 0.77 };
    close(toTeamFrame(fromTeamFrame(p, 'away'), 'away'), p);
  });
});

describe('view transforms', () => {
  const orientations: Orientation[] = ['landscape', 'portrait'];

  it.each(orientations)('round-trips canonical ↔ view in %s', (o) => {
    for (const p of [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0.25, y: 0.8 },
    ]) {
      close(fromView(toView(p, o), o), p);
    }
  });

  it('draws landscape with the length horizontal', () => {
    expect(toView({ x: 1, y: 1 }, 'landscape')).toEqual({ x: PITCH_LENGTH, y: PITCH_WIDTH });
    expect(viewBoxFor('landscape')).toMatchObject({ width: PITCH_LENGTH + 8, height: PITCH_WIDTH + 8 });
  });

  it('draws portrait with the home goal at the bottom and home’s left on the left', () => {
    expect(toView({ x: 0, y: 0.5 }, 'portrait')).toEqual({ x: PITCH_WIDTH / 2, y: PITCH_LENGTH });
    expect(toView({ x: 1, y: 0.5 }, 'portrait')).toEqual({ x: PITCH_WIDTH / 2, y: 0 });
    expect(toView({ x: 0.5, y: 0 }, 'portrait').x).toBe(0);
    expect(viewBoxFor('portrait')).toMatchObject({ width: PITCH_WIDTH + 8, height: PITCH_LENGTH + 8 });
  });
});

describe('client → pitch mapping (resize behaviour)', () => {
  it('maps the same relative screen point to the same pitch point at any size', () => {
    const vb = viewBoxFor('landscape');
    const target = { x: 0.3, y: 0.6 };
    for (const scale of [3, 7.5, 12]) {
      const rect = { left: 40, top: 20, width: vb.width * scale, height: vb.height * scale };
      const view = toView(target, 'landscape');
      const client = { x: rect.left + (view.x - vb.x) * scale, y: rect.top + (view.y - vb.y) * scale };
      close(clientToPitch(client, rect, 'landscape')!, target);
    }
  });

  it('accounts for letterboxing when the element aspect ratio differs', () => {
    const vb = viewBoxFor('portrait');
    // Element twice as wide as needed: content is centred horizontally.
    const scale = 5;
    const rect = { left: 0, top: 0, width: vb.width * scale * 2, height: vb.height * scale };
    const extra = vb.width * scale / 2;
    const centre = { x: rect.width / 2, y: rect.height / 2 };
    const v = clientToViewBox(centre, rect, vb)!;
    close(v, { x: vb.x + vb.width / 2, y: vb.y + vb.height / 2 });
    // Leftmost visible pitch edge sits after the left letterbox band.
    const edge = clientToViewBox({ x: extra + (0 - vb.x) * scale, y: 0 }, rect, vb)!;
    expect(edge.x).toBeCloseTo(0, 9);
  });

  it('clamps points dragged off the pitch and ignores zero-size elements', () => {
    const rect = { left: 0, top: 0, width: 1130, height: 760 };
    expect(clientToPitch({ x: -500, y: 5000 }, rect, 'landscape')).toEqual({ x: 0, y: 1 });
    expect(clientToPitch({ x: 1, y: 1 }, { left: 0, top: 0, width: 0, height: 0 }, 'landscape')).toBeNull();
  });
});

describe('helpers', () => {
  it('measures in metres, not normalised units', () => {
    expect(distanceMetres({ x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(105);
    expect(distanceMetres({ x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(68);
  });

  it('clamps and snaps', () => {
    expect(clampPoint({ x: -1, y: 2 })).toEqual({ x: 0, y: 1 });
    const snapped = snapPoint({ x: 0.511, y: 0.27 });
    expect(snapped.x * 42).toBeCloseTo(Math.round(snapped.x * 42));
    expect(snapped.y * 24).toBeCloseTo(Math.round(snapped.y * 24));
  });

  it('nudges in screen directions for both orientations', () => {
    const p = { x: 0.5, y: 0.5 };
    expect(nudge(p, 'right', 1, 'landscape').x).toBeGreaterThan(0.5);
    expect(nudge(p, 'down', 1, 'landscape').y).toBeGreaterThan(0.5);
    // Portrait: "up" on screen is toward the away goal (x increases).
    expect(nudge(p, 'up', 1, 'portrait').x).toBeGreaterThan(0.5);
    expect(nudge(p, 'right', 1, 'portrait').y).toBeGreaterThan(0.5);
    expect(distanceMetres(p, nudge(p, 'left', 2, 'portrait'))).toBeCloseTo(2);
  });
});

describe('shortenSegment', () => {
  it('trims both ends along the segment', () => {
    const [a, b] = shortenSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 2, 3);
    expect(a).toEqual({ x: 2, y: 0 });
    expect(b).toEqual({ x: 7, y: 0 });
  });

  it('never inverts a short segment', () => {
    const [a, b] = shortenSegment({ x: 0, y: 0 }, { x: 1, y: 0 }, 2, 2);
    expect(b.x - a.x).toBeCloseTo(0.1);
  });

  it('leaves zero-length segments alone', () => {
    const p = { x: 3, y: 3 };
    expect(shortenSegment(p, p, 1, 1)).toEqual([p, p]);
  });
});
