import { fireEvent, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import { fullTeam } from '@/domain/fixtures';
import { toView, viewBoxFor } from '@/domain/geometry';
import { createMatch } from '@/domain/match';
import type { Match, Point } from '@/domain/types';

/** Test-only helpers for driving the SVG board in jsdom (which has no layout). */

export const SCALE = 10; // px per metre in the mocked layout
export const rect = { left: 0, top: 0, width: 0, height: 0 };

/** Gives every <svg> a landscape-sized client rect; call in beforeEach. */
export function mockBoardLayout() {
  const vb = viewBoxFor('landscape');
  Object.assign(rect, { left: 0, top: 0, width: vb.width * SCALE, height: vb.height * SCALE });
  vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({ ...rect, x: rect.left, y: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height, toJSON: () => ({}) }) as DOMRect,
  );
}

export function matchWithSquads(): Match {
  const m = createMatch();
  return { ...m, home: { ...fullTeam('home'), name: 'Home FC' }, away: { ...fullTeam('away'), name: 'Away FC' } };
}

export const board = () => screen.getByRole('group', { name: /tactical board/i });

/** A home-team marker (both fixture squads share player names). */
export const marker = (label: string) =>
  within(board()).getByRole('button', { name: new RegExp(`^Home FC: ${label}\\b`) });

export const translate = (el: Element) => {
  const m = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(el.getAttribute('transform') ?? '');
  if (!m) throw new Error('no transform');
  return { x: Number(m[1]), y: Number(m[2]) };
};

/** Client pixel position of a view-unit point under the mocked landscape rect. */
export const toClient = (v: Point) => {
  const vb = viewBoxFor('landscape');
  return { clientX: rect.left + (v.x - vb.x) * SCALE, clientY: rect.top + (v.y - vb.y) * SCALE };
};

/** Client position of a canonical pitch point. */
export const pitchClient = (p: Point) => toClient(toView(p, 'landscape'));

type PointerInit = { pointerType?: string };

/** Press at `from`, move through `via`, release at the last point. Events go to `target`. */
export function gesture(target: Element, from: Point, to: Point, init: PointerInit = {}, pointerId = 1, via: Point[] = []) {
  fireEvent.pointerDown(target, { ...toClient(from), pointerId, button: 0, ...init });
  for (const v of [...via, to]) fireEvent.pointerMove(target, { ...toClient(v), pointerId, ...init });
  fireEvent.pointerUp(target, { ...toClient(to), pointerId, ...init });
}

/** Drag a marker to a view-unit point. */
export function drag(el: Element, toViewPoint: Point, init: PointerInit = {}) {
  gesture(el, translate(el), toViewPoint, init);
}

export const drawings = () => Array.from(board().querySelectorAll('[data-drawing-id]'));
