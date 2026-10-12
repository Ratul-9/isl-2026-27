import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATTERNS } from '@/domain/patterns';
import { MatchWorkspace } from '@/components/MatchWorkspace';
import { board, matchWithSquads, mockBoardLayout, translate } from './boardTestUtils';

/** jsdom has no Fullscreen API, so entering fullscreen uses the overlay fallback; a native stand-in is installed where needed. */

function installNativeFullscreen() {
  const changed = () => document.dispatchEvent(new Event('fullscreenchange'));
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });
  const request = vi.fn(async function (this: HTMLElement) {
    // Remember which element is fullscreen (what the real API does).
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => this });
    changed();
  });
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, writable: true, value: request });
  const exit = vi.fn(async () => {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });
    changed();
  });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, writable: true, value: exit });
  return { request, exit };
}

beforeEach(() => mockBoardLayout());
afterEach(() => {
  for (const key of ['fullscreenEnabled', 'fullscreenElement', 'exitFullscreen']) delete (document as unknown as Record<string, unknown>)[key];
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).requestFullscreen;
  document.documentElement.style.overflow = '';
  vi.restoreAllMocks();
});

function setup() {
  const user = userEvent.setup();
  render(<MatchWorkspace initialMatch={matchWithSquads()} />);
  return user;
}

const bench = () => screen.getByRole('button', { name: 'Tactical Bench' });
const arrows = () => board().querySelectorAll('[data-drawing-id]');
const positions = () => within(board()).getAllByRole('button').map(translate);

describe('Tactical Bench (normal layout)', () => {
  it('replaces the sidebar section: one button above the pitch, nothing duplicated', () => {
    setup();
    expect(screen.queryByRole('region', { name: 'Tactical patterns' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Tactical Bench' })).toHaveLength(1);
    // Outside the pitch: not inside the board <svg>, and before it in the display container.
    expect(board().contains(bench())).toBe(false);
    expect(bench().compareDocumentPosition(board()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bench()).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens an anchored dropdown with every existing pattern and applies one through the existing logic', async () => {
    const user = setup();
    await user.click(bench());
    expect(bench()).toHaveAttribute('aria-expanded', 'true');
    const dialog = screen.getByRole('dialog', { name: 'Tactical Bench' });
    expect(dialog).not.toHaveAttribute('aria-modal');
    const options = within(within(dialog).getByLabelText('Pattern')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(PATTERNS.map((p) => p.name));
    expect(options.length).toBeGreaterThanOrEqual(12);

    const before = positions();
    await user.selectOptions(within(dialog).getByLabelText('Pattern'), 'Overlapping full-back');
    expect(arrows()).toHaveLength(0); // choosing is not applying
    await user.click(within(dialog).getByRole('button', { name: /apply to home fc/i }));
    expect(arrows().length).toBeGreaterThan(0);
    expect(positions()).not.toEqual(before);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); // closes after a successful application
    expect(bench()).toHaveFocus();
  });

  it('closes on Escape or an outside click without applying anything', async () => {
    const user = setup();
    await user.click(bench());
    await user.selectOptions(screen.getByLabelText('Pattern'), 'High press');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(arrows()).toHaveLength(0);

    await user.click(bench());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.pointerDown(board());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(arrows()).toHaveLength(0);
  });

  it('keeps the board shortcuts out of the panel', async () => {
    const user = setup();
    await user.click(bench());
    screen.getByRole('button', { name: 'Close Tactical Bench' }).focus();
    await user.keyboard('p'); // would select the Pass tool on the board
    expect(screen.getByRole('button', { name: /^Select/ })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Tactical Bench (fullscreen)', () => {
  it('stays in the top-right area and opens an in-app modal inside the fullscreen element, never a window', async () => {
    const open = vi.spyOn(window, 'open');
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Fullscreen' }));
    const stage = board().closest('[data-fullscreen]') as HTMLElement;
    expect(stage).toHaveAttribute('data-fullscreen', 'fallback');
    expect(stage.contains(bench())).toBe(true);

    await user.click(bench());
    const dialog = screen.getByRole('dialog', { name: 'Tactical Bench' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(stage.contains(dialog)).toBe(true); // above the fullscreen pitch, in the same stacking context
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    // Scrolls inside itself when the options exceed the height.
    expect(dialog.className).toMatch(/overflow-y-auto/);
    expect(dialog.className).toMatch(/max-h-/);
    expect(open).not.toHaveBeenCalled();
  });

  it('applies on Apply, closes, and stays fullscreen with positions, drawings and state intact', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Fullscreen' }));
    await user.click(bench());
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Pattern'), 'Overlapping full-back');
    await user.click(within(dialog).getByRole('button', { name: 'Away FC' })); // choose the side
    expect(arrows()).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: /apply to away fc/i }));
    expect(arrows().length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument();
    expect(board().closest('[data-fullscreen]')).toHaveAttribute('data-fullscreen', 'fallback');
  });

  it('Cancel, Escape and the backdrop dismiss without applying and without leaving fullscreen', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Fullscreen' }));

    await user.click(bench());
    await user.selectOptions(screen.getByLabelText('Pattern'), 'High press');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(bench());
    await user.selectOptions(screen.getByLabelText('Pattern'), 'High press');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument(); // Esc closed only the bench

    await user.click(bench());
    fireEvent.pointerDown(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(arrows()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument();
  });

  it('does not close when pressing inside the dialog', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Fullscreen' }));
    await user.click(bench());
    fireEvent.pointerDown(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('works with the browser Fullscreen API too: no exit is requested while using the bench', async () => {
    const native = installNativeFullscreen();
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Fullscreen' }));
    expect(native.request).toHaveBeenCalledTimes(1);
    await act(async () => {});
    await user.click(bench());
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /apply to home fc/i }));
    expect(arrows().length).toBeGreaterThan(0);
    expect(native.exit).not.toHaveBeenCalled();
    expect(board().closest('[data-fullscreen]')).toHaveAttribute('data-fullscreen', 'native');
  });

  it('closes the open bench when the layout changes', async () => {
    const user = setup();
    await user.click(bench());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fullscreen' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
