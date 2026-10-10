import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toView } from '@/domain/geometry';
import { MatchWorkspace } from '@/components/MatchWorkspace';
import {
  board,
  drag,
  drawings,
  gesture,
  marker,
  matchWithSquads,
  mockBoardLayout,
  toClient,
  translate,
} from './boardTestUtils';

beforeEach(() => {
  mockBoardLayout();
});

afterEach(() => {
  vi.restoreAllMocks();
});

type User = ReturnType<typeof userEvent.setup>;

function setup() {
  const user = userEvent.setup();
  render(<MatchWorkspace initialMatch={matchWithSquads()} />);
  return user;
}

const tool = (name: string) => screen.getByRole('button', { name: `${name} tool` });
const v = (x: number, y: number) => toView({ x, y }, 'landscape');

/** Draws on empty grass between two canonical points with the current tool. */
function drawOnGrass(from: [number, number], to: [number, number], init = {}) {
  gesture(board(), v(...from), v(...to), init);
}

async function pick(user: User, name: string) {
  await user.click(tool(name));
}

/** Clicks the hit area of the n-th drawing (select tool). */
function clickDrawing(index = 0) {
  const group = drawings()[index];
  const hit = group.querySelector('path[stroke="transparent"]')!;
  const label = group.querySelector('title')!;
  // Use the drawing's midpoint: parse the path's first and last coordinates.
  const n = (hit.getAttribute('d') ?? '').match(/-?\d+(\.\d+)?/g)!.map(Number);
  const mid = { x: (n[0] + n[n.length - 2]) / 2, y: (n[1] + n[n.length - 1]) / 2 };
  fireEvent.pointerDown(hit, { ...toClient(mid), pointerId: 7, button: 0 });
  fireEvent.pointerUp(hit, { ...toClient(mid), pointerId: 7 });
  return label;
}

describe('drawing tools', () => {
  it('shows the active tool clearly and starts in Select', async () => {
    const user = setup();
    expect(tool('Select')).toHaveAttribute('aria-pressed', 'true');
    await pick(user, 'Shot');
    expect(tool('Shot')).toHaveAttribute('aria-pressed', 'true');
    expect(tool('Select')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Shot tool')).toBeInTheDocument();
    expect(board()).toHaveAttribute('data-tool', 'shot');
  });

  it.each([
    ['Pass', 'pass'],
    ['Lofted', 'lofted'],
    ['Shot', 'shot'],
    ['Run', 'movement'],
  ])('%s tool draws a %s arrow on open grass', async (label, kind) => {
    const user = setup();
    await pick(user, label);
    drawOnGrass([0.55, 0.1], [0.75, 0.2]);
    expect(drawings()).toHaveLength(1);
    expect(drawings()[0]).toHaveAttribute('data-kind', kind);
  });

  it('labels lofted passes LD on the arrow itself, in yellow', async () => {
    const user = setup();
    await pick(user, 'Lofted');
    drawOnGrass([0.55, 0.1], [0.85, 0.4]);
    const lofted = drawings()[0];
    const ld = within(lofted as HTMLElement).getByText('LD');
    expect(ld).toHaveAttribute('fill', '#facc15');
    expect(lofted.querySelector('path[marker-end="url(#arrowhead-lofted)"]')).not.toBeNull();
  });

  it('uses yellow for passes, red for shots and a dashed stroke for runs', async () => {
    const user = setup();
    for (const [label, from, to] of [
      ['Pass', [0.55, 0.1], [0.7, 0.1]],
      ['Shot', [0.55, 0.3], [0.7, 0.3]],
      ['Run', [0.55, 0.5], [0.7, 0.5]],
    ] as const) {
      await pick(user, label);
      drawOnGrass([...from], [...to]);
    }
    const stroke = (i: number) => drawings()[i].querySelector('path[marker-end]')!;
    expect(stroke(0)).toHaveAttribute('stroke', '#facc15');
    expect(stroke(1)).toHaveAttribute('stroke', '#ef4444');
    expect(stroke(2)).toHaveAttribute('stroke-dasharray');
  });

  it('starts an arrow from a player without moving them, and can end on another player', async () => {
    const user = setup();
    await pick(user, 'Pass');
    const passer = marker('#6 Pivot');
    const receiver = marker('#9 Striker');
    const before = translate(passer);
    gesture(passer, translate(passer), translate(receiver));
    expect(translate(marker('#6 Pivot'))).toEqual(before);
    expect(drawings()).toHaveLength(1);

    // The arrow is attached to both players (shown in the editor).
    await pick(user, 'Select');
    await user.click(within(screen.getByRole('region', { name: 'Drawings' })).getByRole('button', { name: /pass/i }));
    expect(screen.getByRole('region', { name: 'Selected drawing' })).toHaveTextContent('From #6 Pivot to #9 Striker');
  });

  it('ignores clicks that are too short to be an arrow', async () => {
    const user = setup();
    await pick(user, 'Pass');
    drawOnGrass([0.6, 0.2], [0.601, 0.2]);
    expect(drawings()).toHaveLength(0);
  });

  it('draws freehand annotations', async () => {
    const user = setup();
    await pick(user, 'Draw');
    gesture(board(), v(0.6, 0.6), v(0.8, 0.6), {}, 1, [v(0.65, 0.7), v(0.7, 0.75), v(0.75, 0.7)]);
    expect(drawings()).toHaveLength(1);
    expect(drawings()[0]).toHaveAttribute('data-kind', 'freehand');
    expect(drawings()[0].querySelector('path[marker-end]')).toBeNull();
  });

  it('keeps every drawing when switching tools, by click or keyboard shortcut', async () => {
    const user = setup();
    await pick(user, 'Pass');
    drawOnGrass([0.55, 0.1], [0.7, 0.1]);
    await user.keyboard('s');
    expect(tool('Shot')).toHaveAttribute('aria-pressed', 'true');
    drawOnGrass([0.55, 0.3], [0.7, 0.3]);
    for (const key of ['l', 'm', 'f', 'e', 'v']) await user.keyboard(key);
    expect(tool('Select')).toHaveAttribute('aria-pressed', 'true');
    expect(drawings().map((d) => d.getAttribute('data-kind'))).toEqual(['pass', 'shot']);
  });

  it('cancels an arrow in progress with Escape', async () => {
    const user = setup();
    await pick(user, 'Pass');
    fireEvent.pointerDown(board(), { ...toClient(v(0.6, 0.2)), pointerId: 1, button: 0 });
    fireEvent.pointerMove(board(), { ...toClient(v(0.8, 0.2)), pointerId: 1 });
    expect(board().querySelector('[data-draft]')).not.toBeNull();
    await user.keyboard('{Escape}');
    fireEvent.pointerUp(board(), { ...toClient(v(0.8, 0.2)), pointerId: 1 });
    expect(drawings()).toHaveLength(0);
    expect(board().querySelector('[data-draft]')).toBeNull();
  });
});

describe('editing drawings', () => {
  async function withPass(user: User) {
    await pick(user, 'Pass');
    drawOnGrass([0.55, 0.1], [0.75, 0.1]);
    await pick(user, 'Select');
  }

  it('selects an arrow by clicking it and converts a pass into a lofted pass', async () => {
    const user = setup();
    await withPass(user);
    clickDrawing();
    const panel = screen.getByRole('region', { name: 'Selected drawing' });
    expect(within(panel).getByRole('heading', { name: 'Pass' })).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Make lofted pass (LD)' }));
    expect(drawings()[0]).toHaveAttribute('data-kind', 'lofted');
    expect(within(drawings()[0] as HTMLElement).getByText('LD')).toBeInTheDocument();
    await user.selectOptions(within(panel).getByLabelText('Type'), 'Shot');
    expect(drawings()[0]).toHaveAttribute('data-kind', 'shot');
  });

  it('adds a note that appears beside the arrow', async () => {
    const user = setup();
    await withPass(user);
    clickDrawing();
    const panel = screen.getByRole('region', { name: 'Selected drawing' });
    await user.type(within(panel).getByLabelText('Note (optional)'), 'Switch play{Enter}');
    expect(within(drawings()[0] as HTMLElement).getByText('Switch play')).toBeInTheDocument();
  });

  it('does not treat typing in the note field as tool shortcuts or delete', async () => {
    const user = setup();
    await withPass(user);
    clickDrawing();
    const panel = screen.getByRole('region', { name: 'Selected drawing' });
    await user.type(within(panel).getByLabelText('Note (optional)'), 'pass me{Backspace}{Backspace}');
    expect(tool('Select')).toHaveAttribute('aria-pressed', 'true');
    expect(drawings()).toHaveLength(1);
  });

  it('deletes the selected arrow with the Delete key and deselects with Escape', async () => {
    const user = setup();
    await pick(user, 'Pass');
    drawOnGrass([0.55, 0.1], [0.75, 0.1]);
    drawOnGrass([0.55, 0.3], [0.75, 0.3]);
    await pick(user, 'Select');
    clickDrawing(0);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Selected drawing' })).not.toBeInTheDocument();
    clickDrawing(0);
    await user.keyboard('{Delete}');
    expect(drawings()).toHaveLength(1);
  });

  it('drags an endpoint handle, snapping onto a player when released over one', async () => {
    const user = setup();
    await withPass(user);
    clickDrawing();
    const handle = () => board().querySelector('[data-handle="to"]')!;
    expect(handle()).not.toBeNull();
    gesture(handle(), translate(handle()), v(0.8, 0.3));
    expect(translate(handle()).x).toBeCloseTo(v(0.8, 0.3).x, 6);

    // Release on the striker: the end jumps to the player and attaches.
    gesture(handle(), translate(handle()), translate(marker('#9 Striker')));
    expect(translate(handle())).toEqual(translate(marker('#9 Striker')));
    expect(screen.getByRole('region', { name: 'Selected drawing' })).toHaveTextContent('to #9 Striker');
  });

  it('moves a whole arrow by dragging it, without moving any player', async () => {
    const user = setup();
    await withPass(user);
    const players = within(board()).getAllByRole('button').map(translate);
    const group = drawings()[0];
    const hit = group.querySelector('path[stroke="transparent"]')!;
    gesture(hit, v(0.65, 0.1), v(0.65, 0.25));
    const start = translate(board().querySelector('[data-handle="from"]')!);
    expect(start.y).toBeCloseTo(v(0.55, 0.25).y, 6);
    expect(within(board()).getAllByRole('button').map(translate)).toEqual(players);
  });

  it('reverses an arrow from the editor', async () => {
    const user = setup();
    await withPass(user);
    clickDrawing();
    const from = translate(board().querySelector('[data-handle="from"]')!);
    await user.click(screen.getByRole('button', { name: /reverse/i }));
    expect(translate(board().querySelector('[data-handle="to"]')!)).toEqual(from);
  });

  it('erases drawings under a sweep but never players', async () => {
    const user = setup();
    await pick(user, 'Pass');
    drawOnGrass([0.6, 0.1], [0.6, 0.3]);
    drawOnGrass([0.7, 0.1], [0.7, 0.3]);
    drawOnGrass([0.9, 0.8], [0.95, 0.9]);
    const players = within(board()).getAllByRole('button').map(translate);
    await pick(user, 'Erase');
    gesture(board(), v(0.55, 0.2), v(0.75, 0.2), {}, 1, [v(0.6, 0.2), v(0.65, 0.2), v(0.7, 0.2)]);
    expect(drawings()).toHaveLength(1);
    expect(within(board()).getAllByRole('button').map(translate)).toEqual(players);

    // One sweep is one undo step.
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(drawings()).toHaveLength(3);
  });
});

describe('undo and redo', () => {
  it('undoes and redoes drawing operations with buttons and shortcuts', async () => {
    const user = setup();
    const undo = () => screen.getByRole('button', { name: 'Undo' });
    const redo = () => screen.getByRole('button', { name: 'Redo' });
    expect(undo()).toBeDisabled();

    await pick(user, 'Pass');
    drawOnGrass([0.55, 0.1], [0.75, 0.1]);
    drawOnGrass([0.55, 0.3], [0.75, 0.3]);
    await user.click(undo());
    expect(drawings()).toHaveLength(1);
    await user.click(redo());
    expect(drawings()).toHaveLength(2);

    await user.keyboard('{Control>}z{/Control}');
    expect(drawings()).toHaveLength(1);
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(drawings()).toHaveLength(2);
    await user.keyboard('{Meta>}z{/Meta}{Control>}y{/Control}');
    expect(drawings()).toHaveLength(2);
  });

  it('undoes a player drag and restores cleared annotations without touching players', async () => {
    const user = setup();
    const start = translate(marker('#9 Striker'));
    drag(marker('#9 Striker'), v(0.6, 0.3));
    await pick(user, 'Run');
    drawOnGrass([0.6, 0.4], [0.8, 0.4]);
    const moved = translate(marker('#9 Striker'));

    await user.click(screen.getByRole('button', { name: /clear annotations/i }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(drawings()).toHaveLength(0);
    expect(translate(marker('#9 Striker'))).toEqual(moved);

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(drawings()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(translate(marker('#9 Striker'))).toEqual(start);
  });
});

describe('touch input', () => {
  it('drags players with touch in Select mode and draws arrows with touch in drawing modes', async () => {
    const user = setup();
    expect(board().style.touchAction).toBe('auto');
    drag(marker('#9 Striker'), v(0.6, 0.35), { pointerType: 'touch' });
    expect(translate(marker('#9 Striker')).x).toBeCloseTo(v(0.6, 0.35).x, 6);

    await pick(user, 'Pass');
    expect(board().style.touchAction).toBe('none');
    const before = translate(marker('#9 Striker'));
    gesture(marker('#9 Striker'), before, v(0.8, 0.2), { pointerType: 'touch' });
    expect(translate(marker('#9 Striker'))).toEqual(before);
    expect(drawings()).toHaveLength(1);
  });
});
