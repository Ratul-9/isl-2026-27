import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toView } from '@/domain/geometry';
import { MatchWorkspace } from '@/components/MatchWorkspace';
import { board, drag, drawings, gesture, marker, matchWithSquads, mockBoardLayout, translate } from './boardTestUtils';

/**
 * jsdom has no Fullscreen API, so it doubles as the "unsupported browser" case.
 * `installNativeFullscreen` provides a faithful stand-in for browsers that have it.
 */

function installNativeFullscreen() {
  let current: Element | null = null;
  const changed = () => document.dispatchEvent(new Event('fullscreenchange'));
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => current });
  const remember = (element: Element | null) => {
    current = element;
  };
  const request = vi.fn(async function (this: HTMLElement) {
    remember(this);
    changed();
  });
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, writable: true, value: request });
  const exit = vi.fn(async () => {
    current = null;
    changed();
  });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, writable: true, value: exit });
  return {
    request,
    exit,
    /** The browser leaves fullscreen by itself (Esc, OS gesture). */
    leaveByBrowser() {
      current = null;
      act(() => changed());
    },
  };
}

function uninstallNativeFullscreen() {
  for (const key of ['fullscreenEnabled', 'fullscreenElement', 'exitFullscreen']) {
    delete (document as unknown as Record<string, unknown>)[key];
  }
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).requestFullscreen;
}

beforeEach(() => {
  mockBoardLayout();
});
afterEach(() => {
  uninstallNativeFullscreen();
  document.documentElement.style.overflow = '';
  vi.restoreAllMocks();
});

function setup() {
  const user = userEvent.setup();
  const view = render(<MatchWorkspace initialMatch={matchWithSquads()} />);
  return { user, ...view };
}

const stage = () => board().closest('[data-fullscreen]') as HTMLElement;
const enterButton = () => screen.getByRole('button', { name: 'Fullscreen' });
const exitButton = () => screen.getByRole('button', { name: 'Exit fullscreen' });
const v = (x: number, y: number) => toView({ x, y }, 'landscape');

describe('fullscreen pitch (native Fullscreen API)', () => {
  it('fullscreens the one existing stage and swaps the control for an obvious exit', async () => {
    const api = installNativeFullscreen();
    const { user } = setup();
    expect(stage()).toHaveAttribute('data-fullscreen', 'off');
    const svgBefore = board();

    await user.click(enterButton());

    expect(api.request).toHaveBeenCalledTimes(1);
    expect(api.request.mock.contexts[0]).toBe(stage());
    expect(stage()).toHaveAttribute('data-fullscreen', 'native');
    // The same <svg> node: nothing was re-created or copied.
    expect(board()).toBe(svgBefore);
    expect(exitButton()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fullscreen' })).not.toBeInTheDocument();
    // Essential controls stay; unrelated ones step aside.
    expect(screen.getByRole('toolbar', { name: 'Drawing tools' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Pitch orientation' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /export png/i })).not.toBeInTheDocument();
  });

  it('keeps positions, drawings and undo history across entering and leaving', async () => {
    installNativeFullscreen();
    const { user } = setup();
    const target = v(0.4, 0.25);
    drag(marker('#9 Striker'), target);
    await user.click(screen.getByRole('button', { name: 'Pass tool' }));
    gesture(board(), v(0.3, 0.6), v(0.5, 0.6));
    expect(drawings()).toHaveLength(1);
    const placed = translate(marker('#9 Striker'));

    await user.click(enterButton());
    expect(translate(marker('#9 Striker'))).toEqual(placed);
    expect(drawings()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();

    await user.click(exitButton());
    expect(stage()).toHaveAttribute('data-fullscreen', 'off');
    expect(translate(marker('#9 Striker'))).toEqual(placed);
    expect(drawings()).toHaveLength(1);

    // History survived: undo removes the arrow, then the move.
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(drawings()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(translate(marker('#9 Striker')).x).not.toBeCloseTo(target.x, 3);
  });

  it('drags players and draws arrows while fullscreen, committing one undo step each', async () => {
    installNativeFullscreen();
    const { user } = setup();
    await user.click(enterButton());

    const target = v(0.35, 0.7);
    drag(marker('#9 Striker'), target);
    const moved = translate(marker('#9 Striker'));
    expect(moved.x).toBeCloseTo(target.x, 6);
    expect(moved.y).toBeCloseTo(target.y, 6);

    await user.click(screen.getByRole('button', { name: 'Shot tool' }));
    gesture(board(), v(0.5, 0.5), v(0.8, 0.5));
    expect(drawings()).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(drawings()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    expect(drawings()).toHaveLength(1);
  });

  it('exits through the button and restores the original controls', async () => {
    const api = installNativeFullscreen();
    const { user } = setup();
    await user.click(enterButton());
    await user.click(exitButton());
    expect(api.exit).toHaveBeenCalledTimes(1);
    expect(stage()).toHaveAttribute('data-fullscreen', 'off');
    expect(screen.getByRole('button', { name: /export png/i })).toBeInTheDocument();
    expect(enterButton()).toBeInTheDocument();
  });

  it('follows the browser when it leaves fullscreen on its own (Esc)', async () => {
    const api = installNativeFullscreen();
    const { user } = setup();
    await user.click(enterButton());
    expect(stage()).toHaveAttribute('data-fullscreen', 'native');
    api.leaveByBrowser();
    expect(stage()).toHaveAttribute('data-fullscreen', 'off');
    expect(enterButton()).toBeInTheDocument();
  });

  it('leaves fullscreen with Delete/Backspace when nothing is selected, but still deletes a selected arrow first', async () => {
    const api = installNativeFullscreen();
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Pass tool' }));
    gesture(board(), v(0.3, 0.6), v(0.5, 0.6));
    await user.click(screen.getByRole('button', { name: 'Select tool' }));
    await user.click(enterButton());

    // Select the arrow: Delete removes it and stays fullscreen…
    const group = drawings()[0];
    const hit = group.querySelector('path[stroke="transparent"]')!;
    fireEvent.pointerDown(hit, { pointerId: 5, button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(hit, { pointerId: 5, button: 0, clientX: 300, clientY: 300 });
    await user.keyboard('{Backspace}');
    expect(drawings()).toHaveLength(0);
    expect(stage()).toHaveAttribute('data-fullscreen', 'native');

    // …and with nothing selected, Delete (the Mac delete key) exits.
    await user.keyboard('{Backspace}');
    expect(api.exit).toHaveBeenCalledTimes(1);
    expect(stage()).toHaveAttribute('data-fullscreen', 'off');
  });

  it('exits on Escape (after cancelling any gesture), even if the browser does not do it itself', async () => {
    const api = installNativeFullscreen();
    const { user } = setup();
    await user.click(enterButton());
    await user.keyboard('{Escape}');
    expect(api.exit).toHaveBeenCalledTimes(1);
    expect(stage()).toHaveAttribute('data-fullscreen', 'off');
  });

  it('ignores Delete outside fullscreen (no accidental effects)', async () => {
    const api = installNativeFullscreen();
    const { user } = setup();
    await user.keyboard('{Backspace}');
    expect(api.exit).not.toHaveBeenCalled();
    expect(stage()).toHaveAttribute('data-fullscreen', 'off');
  });

  it('exits the browser fullscreen if the board is unmounted while fullscreen', async () => {
    const api = installNativeFullscreen();
    const { user, unmount } = setup();
    await user.click(enterButton());
    unmount();
    expect(api.exit).toHaveBeenCalled();
  });
});

describe('fullscreen pitch (overlay fallback)', () => {
  it('uses a viewport overlay when the Fullscreen API is unavailable, and Escape closes it', async () => {
    const { user } = setup();
    await user.click(enterButton());
    expect(stage()).toHaveAttribute('data-fullscreen', 'fallback');
    expect(stage().className).toContain('fixed');
    expect(stage().className).toContain('inset-0');
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(exitButton()).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(stage()).toHaveAttribute('data-fullscreen', 'off');
    expect(stage().className).not.toContain('fixed');
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('Escape first cancels a gesture in progress, then exits', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Pass tool' }));
    await user.click(enterButton());
    fireEvent.pointerDown(board(), { pointerId: 1, button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(board(), { pointerId: 1, clientX: 400, clientY: 320 });
    await user.keyboard('{Escape}');
    expect(stage()).toHaveAttribute('data-fullscreen', 'fallback');
    expect(drawings()).toHaveLength(0);
    await user.keyboard('{Escape}');
    expect(stage()).toHaveAttribute('data-fullscreen', 'off');
  });

  it('falls back to the overlay when the browser refuses the request', async () => {
    const api = installNativeFullscreen();
    api.request.mockRejectedValueOnce(new TypeError('Permissions check failed'));
    const { user } = setup();
    await user.click(enterButton());
    expect(api.request).toHaveBeenCalledTimes(1);
    expect(stage()).toHaveAttribute('data-fullscreen', 'fallback');
  });

  it('can be left with the exit button', async () => {
    const { user } = setup();
    await user.click(enterButton());
    await user.click(exitButton());
    expect(stage()).toHaveAttribute('data-fullscreen', 'off');
  });
});
