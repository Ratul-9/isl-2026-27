import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fullTeam } from '@/domain/fixtures';
import { toView, viewBoxFor } from '@/domain/geometry';
import { createMatch } from '@/domain/match';
import type { Match } from '@/domain/types';
import { MatchWorkspace } from '@/components/MatchWorkspace';

const SCALE = 10; // px per metre in the mocked layout
let rect = { left: 0, top: 0, width: 0, height: 0 };

beforeEach(() => {
  const vb = viewBoxFor('landscape');
  rect = { left: 0, top: 0, width: vb.width * SCALE, height: vb.height * SCALE };
  // jsdom has no layout: give the <svg> a size so pointer → pitch mapping works.
  vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ ...rect, x: rect.left, y: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height, toJSON: () => ({}) }) as DOMRect,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function matchWithSquads(): Match {
  const m = createMatch();
  return {
    ...m,
    home: { ...fullTeam('home'), name: 'Home FC' },
    away: { ...fullTeam('away'), name: 'Away FC' },
  };
}

function setup(match: Match = matchWithSquads()) {
  const user = userEvent.setup();
  render(<MatchWorkspace initialMatch={match} />);
  return user;
}

const board = () => screen.getByRole('group', { name: /tactical board/i });
/** A home-team marker (both fixture squads share player names). */
const marker = (label: string) =>
  within(board()).getByRole('button', { name: new RegExp(`^Home FC: ${label}\\b`) });
const translate = (el: Element) => {
  const m = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(el.getAttribute('transform') ?? '');
  if (!m) throw new Error('no transform');
  return { x: Number(m[1]), y: Number(m[2]) };
};
/** Client pixel position of a view-unit point under the mocked rect. */
const toClient = (v: { x: number; y: number }) => {
  const vb = viewBoxFor('landscape');
  return { clientX: rect.left + (v.x - vb.x) * SCALE, clientY: rect.top + (v.y - vb.y) * SCALE };
};

function drag(el: Element, toViewPoint: { x: number; y: number }) {
  const start = toClient(translate(el));
  fireEvent.pointerDown(el, { ...start, pointerId: 1, button: 0 });
  fireEvent.pointerMove(el, { ...toClient(toViewPoint), pointerId: 1 });
  fireEvent.pointerUp(el, { ...toClient(toViewPoint), pointerId: 1 });
}

describe('BoardView', () => {
  it('shows 11 markers per team with empty positions before squads exist', async () => {
    const user = setup(createMatch());
    expect(within(board()).getAllByRole('button', { name: /^Home team:/ })).toHaveLength(11);
    expect(within(board()).getAllByRole('button', { name: /^Away team:/ })).toHaveLength(11);
    expect(within(board()).getAllByRole('button', { name: /empty Goalkeeper position/ })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: /add squads/i }));
    expect(screen.getByRole('navigation', { name: /setup sections/i })).toBeInTheDocument();
  });

  it('labels markers with shirt number, surname and position', () => {
    setup();
    const striker = marker('#9 Striker');
    expect(striker).toHaveTextContent('9');
    expect(striker).toHaveTextContent('Striker');
    expect(striker).toHaveAttribute('data-position', 'ST');
  });

  it('drags a player to a new position and keeps it after the pitch is resized', () => {
    setup();
    const target = toView({ x: 0.4, y: 0.25 }, 'landscape');
    drag(marker('#9 Striker'), target);
    const after = translate(marker('#9 Striker'));
    expect(after.x).toBeCloseTo(target.x, 6);
    expect(after.y).toBeCloseTo(target.y, 6);

    // Resize: markers are positioned in viewBox units, so nothing moves...
    rect = { left: 30, top: 12, width: rect.width * 1.7, height: rect.height * 1.2 };
    fireEvent.pointerDown(document.body);
    expect(translate(marker('#9 Striker'))).toEqual(after);
    // ...and a drag at the new size still lands on the intended pitch point.
    const scale = Math.min(rect.width / viewBoxFor('landscape').width, rect.height / viewBoxFor('landscape').height);
    const vb = viewBoxFor('landscape');
    const offsetX = rect.left + (rect.width - vb.width * scale) / 2;
    const offsetY = rect.top + (rect.height - vb.height * scale) / 2;
    const el = marker('#9 Striker');
    const startClient = { clientX: offsetX + (after.x - vb.x) * scale, clientY: offsetY + (after.y - vb.y) * scale };
    const goal = toView({ x: 0.3, y: 0.6 }, 'landscape');
    const goalClient = { clientX: offsetX + (goal.x - vb.x) * scale, clientY: offsetY + (goal.y - vb.y) * scale };
    fireEvent.pointerDown(el, { ...startClient, pointerId: 2, button: 0 });
    fireEvent.pointerMove(el, { ...goalClient, pointerId: 2 });
    fireEvent.pointerUp(el, { ...goalClient, pointerId: 2 });
    const final = translate(marker('#9 Striker'));
    expect(final.x).toBeCloseTo(goal.x, 6);
    expect(final.y).toBeCloseTo(goal.y, 6);
  });

  it('selects on click without moving, and shows the player in the selection panel', () => {
    setup();
    const el = marker('#9 Striker');
    const before = translate(el);
    const at = toClient(before);
    fireEvent.pointerDown(el, { ...at, pointerId: 1, button: 0 });
    fireEvent.pointerUp(el, { ...at, pointerId: 1 });
    expect(translate(marker('#9 Striker'))).toEqual(before);
    expect(marker('#9 Striker')).toHaveAttribute('aria-pressed', 'true');
    const panel = screen.getByRole('region', { name: 'Selected player' });
    expect(within(panel).getByText('#9 Striker')).toBeInTheDocument();
  });

  it('nudges a focused player with the arrow keys', async () => {
    const user = setup();
    const el = marker('#9 Striker');
    const before = translate(el);
    el.focus();
    await user.keyboard('{ArrowRight}');
    expect(translate(marker('#9 Striker')).x).toBeCloseTo(before.x + 1, 6);
    await user.keyboard('{Shift>}{ArrowUp}{/Shift}');
    expect(translate(marker('#9 Striker')).y).toBeCloseTo(before.y - 5, 6);
  });

  it('redraws markers for portrait orientation from the same stored coordinates', async () => {
    const user = setup();
    const landscape = translate(marker('#1 Keeper'));
    await user.click(screen.getByRole('button', { name: 'portrait' }));
    expect(board()).toHaveAccessibleName(/portrait/);
    const portrait = translate(marker('#1 Keeper'));
    // Home keeper: near the bottom in portrait, near the left in landscape.
    expect(landscape.x).toBeLessThan(10);
    expect(portrait.y).toBeGreaterThan(95);
    expect(portrait.x).toBeCloseTo(34, 0);
  });

  it('switches formation, moving markers while keeping every player', async () => {
    const user = setup();
    const homePanel = screen.getByRole('region', { name: 'Home FC formation' });
    await user.selectOptions(within(homePanel).getByLabelText('Formation'), '3-5-2');
    expect(marker('#3 Left Back')).toHaveAttribute('data-position', 'LWB');
    expect(marker('#1 Keeper')).toHaveAttribute('data-position', 'GK');
    expect(within(board()).getAllByRole('button', { name: /^Home FC: #/ })).toHaveLength(11);
    // The away team is unaffected.
    expect(within(screen.getByRole('region', { name: 'Away FC formation' })).getByLabelText('Formation')).toHaveValue(
      'preset:4-3-3',
    );
  });

  it('asks before a formation switch discards custom positions, and resets on request', async () => {
    const user = setup();
    const homePanel = screen.getByRole('region', { name: 'Home FC formation' });
    const original = translate(marker('#9 Striker'));
    drag(marker('#9 Striker'), toView({ x: 0.45, y: 0.2 }, 'landscape'));
    expect(within(homePanel).getByText('Custom positions')).toBeInTheDocument();

    await user.selectOptions(within(homePanel).getByLabelText('Formation'), '4-4-2');
    expect(within(homePanel).getByRole('alertdialog')).toHaveTextContent(/replaces Home FC's custom positions/);
    await user.click(within(homePanel).getByRole('button', { name: 'Cancel' }));
    expect(within(homePanel).getByLabelText('Formation')).toHaveValue('preset:4-3-3');

    await user.click(within(homePanel).getByRole('button', { name: /reset to 4-3-3/i }));
    expect(translate(marker('#9 Striker'))).toEqual(original);
    expect(within(homePanel).getByRole('button', { name: /reset to 4-3-3/i })).toBeDisabled();
  });

  it('saves an arrangement, reuses it for the other team and deletes it', async () => {
    const user = setup();
    const homePanel = screen.getByRole('region', { name: 'Home FC formation' });
    drag(marker('#9 Striker'), toView({ x: 0.47, y: 0.3 }, 'landscape'));
    await user.type(within(homePanel).getByLabelText('Save current arrangement as'), 'Striker left');
    await user.click(within(homePanel).getByRole('button', { name: 'Save Home FC arrangement' }));
    expect(within(homePanel).getByRole('status')).toHaveTextContent('Saved “Striker left”');

    const awayPanel = screen.getByRole('region', { name: 'Away FC formation' });
    const awaySelect = within(awayPanel).getByLabelText('Formation');
    const option = within(awaySelect).getByRole('option', { name: 'Striker left' });
    await user.selectOptions(awaySelect, option);
    expect(awaySelect).toHaveValue((option as HTMLOptionElement).value);

    const saved = screen.getByRole('region', { name: 'Saved arrangements' });
    await user.click(within(saved).getByRole('button', { name: 'Delete saved arrangement Striker left' }));
    await user.click(within(saved).getByRole('button', { name: 'Delete' }));
    expect(screen.queryByRole('region', { name: 'Saved arrangements' })).not.toBeInTheDocument();
    expect(within(awayPanel).getByLabelText('Formation')).toHaveValue('preset:4-3-3');
  });

  it('applies a tactical pattern with arrows, then clears arrows without moving players', async () => {
    const user = setup();
    const patterns = screen.getByRole('region', { name: 'Tactical patterns' });
    await user.selectOptions(within(patterns).getByLabelText('Pattern'), 'Overlapping full-back');
    await user.click(within(patterns).getByRole('button', { name: /apply to home fc/i }));

    const arrows = () => board().querySelectorAll('line[data-kind]');
    expect(arrows().length).toBeGreaterThan(0);
    expect(board().querySelectorAll('line[data-kind="movement"]').length).toBeGreaterThan(0);
    expect(board().querySelectorAll('line[data-kind="pass"]').length).toBeGreaterThan(0);

    const positions = within(board()).getAllByRole('button').map(translate);
    await user.click(within(patterns).getByRole('button', { name: /clear arrows/i }));
    await user.click(within(patterns).getByRole('button', { name: 'Clear arrows' }));
    expect(arrows()).toHaveLength(0);
    expect(within(board()).getAllByRole('button').map(translate)).toEqual(positions);
    expect(within(patterns).getByRole('button', { name: /clear arrows/i })).toBeDisabled();
  });

  it('asks before a pattern overwrites custom positions', async () => {
    const user = setup();
    drag(marker('#9 Striker'), toView({ x: 0.45, y: 0.2 }, 'landscape'));
    const patterns = screen.getByRole('region', { name: 'Tactical patterns' });
    await user.click(within(patterns).getByRole('button', { name: /apply to home fc/i }));
    expect(within(patterns).getByRole('alertdialog')).toHaveTextContent(/custom positions/);
    await user.click(within(patterns).getByRole('button', { name: 'Cancel' }));
    expect(board().querySelectorAll('line[data-kind]')).toHaveLength(0);
    await user.click(within(patterns).getByRole('button', { name: /apply to home fc/i }));
    await user.click(within(patterns).getByRole('button', { name: 'Apply anyway' }));
    expect(board().querySelectorAll('line[data-kind]').length).toBeGreaterThan(0);
  });

  it('overrides the position label from the selection panel', async () => {
    const user = setup();
    await user.click(marker('#9 Striker'));
    const panel = screen.getByRole('region', { name: 'Selected player' });
    await user.selectOptions(within(panel).getByLabelText('Plays as'), 'CF');
    expect(marker('#9 Striker')).toHaveAttribute('data-position', 'CF');
  });
});

describe('BoardView keyboard + snap', () => {
  it('still nudges by 1 m when snap to grid is on, and focuses confirmations', async () => {
    const user = setup();
    await user.click(screen.getByLabelText('Snap to grid'));
    const el = marker('#9 Striker');
    const before = translate(el);
    el.focus();
    await user.keyboard('{ArrowLeft}');
    expect(translate(marker('#9 Striker')).x).toBeCloseTo(before.x - 1, 6);

    const homePanel = screen.getByRole('region', { name: 'Home FC formation' });
    await user.selectOptions(within(homePanel).getByLabelText('Formation'), '4-4-2');
    expect(within(homePanel).getByRole('button', { name: 'Switch' })).toHaveFocus();
  });

  it('snaps dragged players to the grid when enabled', async () => {
    const user = setup();
    await user.click(screen.getByLabelText('Snap to grid'));
    drag(marker('#9 Striker'), toView({ x: 0.401, y: 0.262 }, 'landscape'));
    const v = translate(marker('#9 Striker'));
    // 42 columns along 105 m → 2.5 m grid; 24 rows across 68 m.
    const offGrid = (n: number) => Math.abs(n - Math.round(n));
    expect(offGrid(v.x / 2.5)).toBeLessThan(1e-6);
    expect(offGrid((v.y / 68) * 24)).toBeLessThan(1e-6);
  });
});
