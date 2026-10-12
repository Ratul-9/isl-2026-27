import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchWorkspace } from '@/components/MatchWorkspace';
import { board, mockBoardLayout, marker, toClient } from '@/components/board/boardTestUtils';
import { toView } from '@/domain/geometry';
import { richMatch } from '@/persistence/testFixtures';
import { prepareBoardSvg } from './exportBoard';

beforeEach(() => {
  mockBoardLayout();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function renderBoard() {
  const user = userEvent.setup();
  render(<MatchWorkspace initialMatch={richMatch()} initialView="board" />);
  return { user };
}

const svgOf = () => board() as unknown as SVGSVGElement;

describe('prepareBoardSvg', () => {
  it('produces a standalone image of pitch, players, labels and arrows only', async () => {
    const { user } = renderBoard();
    // Selected marker + focus ring and a half-drawn arrow must not leak into the image.
    await user.click(marker('#1 Keeper'));
    const { markup, width, height } = prepareBoardSvg(svgOf());

    // Must be well-formed XML with a single namespace declaration, or browsers refuse to load it.
    expect(markup.match(/xmlns="/g)).toHaveLength(1);
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
    expect(parsed.querySelector('parsererror')).toBeNull();
    expect(parsed.documentElement.nodeName).toBe('svg');
    expect(Math.max(width, height)).toBe(2000);
    expect(width / height).toBeCloseTo(113 / 76, 2);
    // Pitch markings and colours.
    expect(markup).toContain('#1f7a3a');
    expect(markup).toContain('#f5f7f5');
    // Player markers with numbers and labels (the striker was replaced by Sub 0 in the fixture).
    expect(markup).toContain('>12<'); // Sub 0's shirt number, in the striker's slot
    expect(markup).toContain('>Keeper<');
    expect(markup).toContain('>GK<');
    // Annotations: yellow pass, LD badge, note text, freehand colour, dashed run.
    expect(markup).toContain('stroke="#facc15"');
    expect(markup).toContain('>LD<');
    expect(markup).toContain('>Switch<');
    expect(markup).toContain('#7dd3fc');
    expect(markup).toMatch(/stroke-dasharray="1.4 0.9"/);
  });

  it('removes interaction-only parts and unresolved CSS variables', async () => {
    const { user } = renderBoard();
    await user.click(marker('#1 Keeper'));
    await user.click(screen.getByRole('button', { name: 'Select tool' }));
    const { markup } = prepareBoardSvg(svgOf());
    expect(markup).not.toContain('data-handle');
    expect(markup).not.toContain('data-draft');
    expect(markup).not.toContain('pitch-marker-ring');
    expect(markup).not.toContain('stroke="transparent"');
    expect(markup).not.toContain('<title');
    expect(markup).not.toContain('var(--');
    expect(markup).not.toContain('tabindex');
    expect(markup).not.toContain('aria-');
    expect(markup).toMatch(/font-family="ui-sans-serif/);
  });

  it('omits endpoint handles even when a drawing is selected on screen', async () => {
    const { user } = renderBoard();
    await user.click(within(screen.getByRole('region', { name: 'Drawings' })).getAllByRole('button')[0]);
    expect(board().querySelectorAll('[data-handle]')).toHaveLength(2);

    const { markup } = prepareBoardSvg(svgOf());
    expect(markup).not.toContain('data-handle');
    expect(markup.match(/data-drawing-id=/g)).toHaveLength(4);
  });

  it('omits an arrow that is still being drawn', async () => {
    const { user } = renderBoard();
    await user.click(screen.getByRole('button', { name: 'Pass tool' }));
    fireEvent.pointerDown(board(), { ...toClient(toView({ x: 0.6, y: 0.2 }, 'landscape')), pointerId: 1, button: 0 });
    fireEvent.pointerMove(board(), { ...toClient(toView({ x: 0.8, y: 0.2 }, 'landscape')), pointerId: 1 });
    expect(board().querySelectorAll('[data-draft]')).toHaveLength(1);

    const { markup } = prepareBoardSvg(svgOf());
    expect(markup).not.toContain('data-draft');
    expect(markup.match(/data-drawing-id=/g)).toHaveLength(4);
  });

  it('exports portrait with portrait proportions', async () => {
    const { user } = renderBoard();
    await user.click(screen.getByRole('button', { name: 'portrait' }));
    const { width, height } = prepareBoardSvg(svgOf());
    expect(height).toBe(2000);
    expect(width / height).toBeCloseTo(76 / 113, 2);
  });

  it('draws every arrow and marker exactly where it is on screen', () => {
    renderBoard();
    const live = svgOf();
    const doc = new DOMParser().parseFromString(prepareBoardSvg(live).markup, 'image/svg+xml');

    const liveShapes = Array.from(live.querySelectorAll('[data-drawing-id]'));
    expect(liveShapes).toHaveLength(4);
    for (const shape of liveShapes) {
      const exported = doc.querySelector(`[data-drawing-id="${shape.getAttribute('data-drawing-id')}"]`);
      expect(exported).not.toBeNull();
      expect(exported!.querySelector('path[marker-end], path[stroke]')!.getAttribute('d')).toBe(
        shape.querySelector('path[marker-end], path[stroke]')!.getAttribute('d'),
      );
    }

    const liveMarkers = Array.from(live.querySelectorAll('[data-slot-id]')).map((g) => g.getAttribute('transform'));
    const exportedMarkers = Array.from(doc.querySelectorAll('[data-slot-id]')).map((g) => g.getAttribute('transform'));
    expect(exportedMarkers).toHaveLength(22);
    expect(exportedMarkers).toEqual(liveMarkers);
  });

  it('refuses a board without a size', () => {
    const empty = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    expect(() => prepareBoardSvg(empty)).toThrow(/no valid size/);
  });
});

describe('Export PNG button', () => {
  it('rasterises the board and downloads a named PNG', async () => {
    const user = userEvent.setup();
    const blob = new Blob(['png'], { type: 'image/png' });
    const click = vi.fn();
    const created: Blob[] = [];
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (b: Blob) => (created.push(b), 'blob:fake'),
      revokeObjectURL: () => {},
    });
    // Skip real canvas work: jsdom has no 2D canvas.
    const exportModule = await import('./exportBoard');
    const spy = vi.spyOn(exportModule, 'svgToPngBlob').mockResolvedValue(blob);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click);

    render(<MatchWorkspace initialMatch={richMatch()} initialView="board" />);
    await user.click(screen.getByRole('button', { name: /export png/i }));
    await vi.waitFor(() => expect(click).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledTimes(1);
    const prepared = spy.mock.calls[0][0];
    expect(prepared.markup).toContain('>LD<');
    expect(created).toContain(blob);
    vi.unstubAllGlobals();
  });

  it('shows an error when rendering fails', async () => {
    const user = userEvent.setup();
    const exportModule = await import('./exportBoard');
    vi.spyOn(exportModule, 'svgToPngBlob').mockRejectedValue(new Error('canvas blocked'));
    render(<MatchWorkspace initialMatch={richMatch()} initialView="board" />);
    await user.click(screen.getByRole('button', { name: /export png/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('PNG export failed: canvas blocked');
  });
});
