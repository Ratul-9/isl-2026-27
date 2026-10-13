import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchWorkspace } from '@/components/MatchWorkspace';
import { board, drawings, matchWithSquads, mockBoardLayout } from '@/components/board/boardTestUtils';

// --- a controllable animation-frame clock (same approach as the replay tests) -----------
let now = 0;
let frames = new Map<number, FrameRequestCallback>();
let frameId = 1;
function advance(ms: number) {
  now += ms;
  const due = [...frames.values()];
  frames = new Map();
  act(() => due.forEach((cb) => cb(now)));
}

beforeEach(() => {
  now = 0;
  frames = new Map();
  frameId = 1;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = frameId++;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => void frames.delete(id));
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  mockBoardLayout();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openScenario() {
  const user = userEvent.setup();
  render(<MatchWorkspace initialMatch={matchWithSquads()} />);
  const patterns = screen.getByRole('region', { name: 'Tactical patterns' });
  await user.selectOptions(within(patterns).getByLabelText('Pattern'), 'Overlapping full-back');
  await user.click(within(patterns).getByRole('button', { name: /watch animated scenario/i }));
  const dialog = screen.getByRole('dialog', { name: /overlapping full-back/i });
  return { user, dialog, patterns };
}

const slider = (dialog: HTMLElement) => within(dialog).getByRole('slider', { name: 'Replay position' }) as HTMLInputElement;
const time = (dialog: HTMLElement) => Number(slider(dialog).value);
const pitch = (dialog: HTMLElement) => dialog.querySelector('svg[data-replay-time]') as SVGSVGElement;
const seek = (dialog: HTMLElement, t: number) => fireEvent.change(slider(dialog), { target: { value: String(t) } });
const caption = (dialog: HTMLElement) => within(dialog).getByTestId('replay-caption').textContent ?? '';
const currentStage = (dialog: HTMLElement) =>
  within(within(dialog).getByRole('list', { name: 'Stages' })).getByRole('button', { current: 'step' }).textContent ?? '';
const spaceIds = (dialog: HTMLElement) =>
  Array.from(dialog.querySelectorAll('[data-space-id]')).map((e) => e.getAttribute('data-space-id'));
const markers = (dialog: HTMLElement) => Array.from(pitch(dialog).querySelectorAll('[data-actor-id]'));

describe('animated scenario on the overlap pattern', () => {
  it('opens from the existing pattern entry without applying anything to the board', async () => {
    const { dialog } = await openScenario();
    expect(within(dialog).getByRole('heading', { name: /overlapping full-back/i })).toBeInTheDocument();
    expect(drawings()).toHaveLength(0);
    expect(board()).toBeInTheDocument();
  });

  it('offers the animation only for patterns that have one', async () => {
    const user = userEvent.setup();
    render(<MatchWorkspace initialMatch={matchWithSquads()} />);
    const patterns = screen.getByRole('region', { name: 'Tactical patterns' });
    expect(within(patterns).queryByRole('button', { name: /watch animated scenario/i })).not.toBeInTheDocument();
    await user.selectOptions(within(patterns).getByLabelText('Pattern'), 'Overlapping full-back');
    expect(within(patterns).getByRole('button', { name: /watch animated scenario/i })).toBeInTheDocument();
    await user.selectOptions(within(patterns).getByLabelText('Pattern'), 'Underlapping full-back');
    expect(within(patterns).queryByRole('button', { name: /watch animated scenario/i })).not.toBeInTheDocument();
  });

  it('lists what each highlighted space means, in words, as the scene changes', async () => {
    const { dialog } = await openScenario();
    const list = () => within(dialog).getByRole('region', { name: 'Spaces right now' }).textContent ?? '';
    seek(dialog, 1);
    expect(list()).toMatch(/No\. 6 cover/);
    expect(list()).not.toMatch(/Open channel/);
    seek(dialog, 9.4);
    expect(list()).toMatch(/Open channel/);
    seek(dialog, 12.4);
    expect(list()).toMatch(/Crossing lane/);
    expect(list()).toMatch(/Lane to the 8/);
  });

  it('shows only the relevant ten players and the ball, with role labels', async () => {
    const { dialog } = await openScenario();
    const ms = markers(dialog);
    expect(ms).toHaveLength(11);
    expect(within(dialog).getAllByRole('img', { name: /Home FC:/ })).toHaveLength(5);
    expect(within(dialog).getAllByRole('img', { name: /Away FC:/ })).toHaveLength(5);
    expect(within(dialog).getByRole('img', { name: /Home FC: Left back/ })).toHaveTextContent('LB');
    expect(within(dialog).getByRole('img', { name: /Home FC: Number 9/ })).toHaveTextContent('9');
    expect(within(dialog).getByRole('img', { name: /Away FC: Right winger/ })).toHaveTextContent('RW');
    // The key explains each badge, since the markers carry only the badge.
    const key = within(dialog).getByRole('group', { name: 'Players' });
    expect(key).toHaveTextContent(/LB Left back/);
    expect(key).toHaveTextContent(/DM Def\. midfield/);
  });

  it('plays the stages in order and ends paused at the decision point', async () => {
    const { user, dialog } = await openScenario();
    expect(currentStage(dialog)).toMatch(/Stage 1/);
    expect(caption(dialog)).toMatch(/press/i);

    await user.click(within(dialog).getByRole('button', { name: 'Play' }));
    const seen: string[] = [];
    for (let i = 0; i < 70; i++) {
      advance(200);
      const s = currentStage(dialog).replace(/\s+/g, ' ');
      if (seen[seen.length - 1] !== s) seen.push(s);
    }
    expect(seen.map((s) => s.match(/Stage \d|Decision/)?.[0])).toEqual(['Stage 1', 'Stage 2', 'Stage 3', 'Stage 4', 'Decision']);
    expect(time(dialog)).toBeCloseTo(12.4, 1);
    expect(within(dialog).getByRole('button', { name: 'Play again' })).toBeInTheDocument();
    expect(caption(dialog)).toMatch(/decision point/i);
  }, 20000);

  it('moves the ball with the passing sequence: with the full-back, then the winger, then the full-back again', async () => {
    const { dialog } = await openScenario();
    const ball = () => pitch(dialog).querySelector('[data-actor-id="ball"]') as SVGGElement;
    const player = (id: string) => pitch(dialog).querySelector(`[data-actor-id="${id}"]`) as SVGGElement;
    const xy = (el: Element) => {
      const m = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(el.getAttribute('transform') ?? '')!;
      return { x: Number(m[1]), y: Number(m[2]) };
    };
    const gap = (a: Element, b: Element) => Math.hypot(xy(a).x - xy(b).x, xy(a).y - xy(b).y);
    seek(dialog, 1.5);
    expect(gap(ball(), player('a-fb'))).toBeLessThan(4);
    expect(gap(ball(), player('a-wg'))).toBeGreaterThan(10);
    seek(dialog, 6);
    expect(gap(ball(), player('a-wg'))).toBeLessThan(4);
    expect(gap(ball(), player('a-fb'))).toBeGreaterThan(8);
    seek(dialog, 11);
    expect(gap(ball(), player('a-fb'))).toBeLessThan(4);
  });

  it('highlights spaces only when they exist and labels each kind in a legend', async () => {
    const { dialog } = await openScenario();
    const legend = within(dialog).getByRole('list', { name: 'Legend' });
    for (const text of ['Open space', 'Passing lane', 'Defensive cover']) expect(within(legend).getByText(text)).toBeInTheDocument();

    seek(dialog, 1);
    expect(spaceIds(dialog)).toEqual(['cover-six']);
    seek(dialog, 9.4);
    expect(spaceIds(dialog)).toEqual(expect.arrayContaining(['channel', 'cover-six', 'behind-fb']));
    seek(dialog, 12.4);
    expect(spaceIds(dialog)).toEqual(expect.arrayContaining(['cross-lane', 'lane-8', 'cb-gap']));
    expect(spaceIds(dialog)).not.toContain('channel');
  });

  it('switches to outcome B, where the channel is contested and the full-back is under pressure', async () => {
    const { user, dialog } = await openScenario();
    seek(dialog, 9.8);
    expect(dialog.querySelector('[data-space-id="channel"]')).toHaveAttribute('data-status', 'open');
    await user.click(within(dialog).getByRole('button', { name: /Outcome B/ }));
    expect(time(dialog)).toBe(0);
    seek(dialog, 9.8);
    expect(dialog.querySelector('[data-space-id="channel"]')).toHaveAttribute('data-status', 'contested');
    seek(dialog, 9.9);
    expect(caption(dialog)).toMatch(/little time|close behind/i);
  });

  describe('final options', () => {
    async function atDecision() {
      const ctx = await openScenario();
      return ctx;
    }

    it('locks the options until the decision point, then unlocks all three', async () => {
      const { dialog } = await atDecision();
      const group = within(dialog).getByRole('group', { name: 'Final options' });
      for (const b of within(group).getAllByRole('button')) expect(b).toBeDisabled();
      seek(dialog, 12.4);
      expect(within(group).getAllByRole('button')).toHaveLength(3);
      for (const b of within(group).getAllByRole('button')) expect(b).toBeEnabled();
    });

    it.each([
      ['Cross to the number 9', 14.6],
      ['Pass back inside to the winger', 15],
      ['Pass to the number 8', 14.4],
    ])('plays only %s from the decision point', async (name, end) => {
      const { user, dialog } = await atDecision();
      seek(dialog, 12.4);
      const group = within(dialog).getByRole('group', { name: 'Final options' });
      await user.click(within(group).getByRole('button', { name }));

      expect(within(group).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
      expect(within(group).getAllByRole('button', { pressed: true })).toHaveLength(1);
      expect(Number(slider(dialog).max)).toBeCloseTo(end, 3);
      expect(time(dialog)).toBeCloseTo(12.4, 2);
      expect(within(dialog).getByRole('button', { name: 'Pause' })).toBeInTheDocument();

      for (let i = 0; i < 60; i++) advance(100);
      expect(time(dialog)).toBeCloseTo(end, 2);
      expect(caption(dialog)).toMatch(/\S/);
      expect(dialog.querySelector('[data-testid="option-detail"]')).toHaveTextContent(/Fits when/);
      // The verdict line is conditional wording, never a goal.
      expect(caption(dialog)).not.toMatch(/\bgoal\b|scores/i);
    });

    it('shows the target zone only for the cross', async () => {
      const { user, dialog } = await atDecision();
      seek(dialog, 12.4);
      await user.click(within(dialog).getByRole('button', { name: 'Cross to the number 9' }));
      advance(16);
      expect(spaceIds(dialog)).toContain('cross-target');
      await user.click(within(dialog).getByRole('button', { name: 'Pass to the number 8' }));
      expect(spaceIds(dialog)).not.toContain('cross-target');
    });

    it('goes back to the decision point and lets another option be chosen', async () => {
      const { user, dialog } = await atDecision();
      seek(dialog, 12.4);
      await user.click(within(dialog).getByRole('button', { name: 'Cross to the number 9' }));
      await user.click(within(dialog).getByRole('button', { name: /back to the decision point/i }));
      expect(time(dialog)).toBeCloseTo(12.4, 2);
      expect(Number(slider(dialog).max)).toBeCloseTo(12.4, 3);
      expect(within(dialog).queryByTestId('option-detail')).not.toBeInTheDocument();
      expect(within(dialog).getAllByRole('button', { pressed: true }).some((b) => /Cross|Pass/.test(b.textContent ?? ''))).toBe(false);
    });
  });

  it('supports reset, replay, scrubbing and stage stepping', async () => {
    const { user, dialog } = await openScenario();
    seek(dialog, 8);
    expect(time(dialog)).toBeCloseTo(8, 2);
    await user.click(within(dialog).getByRole('button', { name: 'Reset to start' }));
    expect(time(dialog)).toBe(0);

    await user.click(within(dialog).getByRole('button', { name: 'Next stage' }));
    expect(time(dialog)).toBeCloseTo(4.4, 2);
    await user.click(within(dialog).getByRole('button', { name: 'Next stage' }));
    expect(time(dialog)).toBeCloseTo(7, 2);
    await user.click(within(dialog).getByRole('button', { name: 'Previous stage' }));
    expect(time(dialog)).toBeCloseTo(4.4, 2);

    await user.click(within(dialog).getByRole('button', { name: 'Replay from the beginning' }));
    advance(1000);
    expect(time(dialog)).toBeGreaterThan(0.5);
    expect(within(dialog).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('jumps to a stage from the stage strip', async () => {
    const { user, dialog } = await openScenario();
    await user.click(within(within(dialog).getByRole('list', { name: 'Stages' })).getByRole('button', { name: /Stage 4/ }));
    expect(time(dialog)).toBeCloseTo(8.2, 2);
    expect(currentStage(dialog)).toMatch(/Stage 4/);
  });

  it('mirrors to the right flank', async () => {
    const { user, dialog } = await openScenario();
    await user.click(within(dialog).getByRole('button', { name: /right flank/i }));
    expect(within(dialog).getByRole('img', { name: /Home FC: Right back/ })).toHaveTextContent('RB');
  });

  it('attacks as the chosen side', async () => {
    const user = userEvent.setup();
    render(<MatchWorkspace initialMatch={matchWithSquads()} />);
    const patterns = screen.getByRole('region', { name: 'Tactical patterns' });
    await user.click(within(patterns).getByRole('button', { name: 'Away FC' }));
    await user.selectOptions(within(patterns).getByLabelText('Pattern'), 'Overlapping full-back');
    await user.click(within(patterns).getByRole('button', { name: /watch animated scenario/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('img', { name: /Away FC: Number 9/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: /Home FC: Centre-back/ })).toBeInTheDocument();
  });

  it('closes with the button or Escape, returns focus, and leaves the match untouched', async () => {
    const { user, dialog, patterns } = await openScenario();
    const opener = within(patterns).getByRole('button', { name: /watch animated scenario/i });
    await user.click(within(dialog).getByRole('button', { name: 'Close animated scenario' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(drawings()).toHaveLength(0);

    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not let board shortcuts fire while the scenario is open', async () => {
    const { user, dialog } = await openScenario();
    const tool = (name: string) => screen.getByRole('button', { name, hidden: true });
    expect(tool('Select tool')).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('p');
    await user.click(within(dialog).getByRole('button', { name: 'Close animated scenario' }));
    expect(tool('Select tool')).toHaveAttribute('aria-pressed', 'true');
    expect(tool('Pass tool')).toHaveAttribute('aria-pressed', 'false');
    // Back on the board the shortcut works as before.
    await user.keyboard('p');
    expect(tool('Pass tool')).toHaveAttribute('aria-pressed', 'true');
  });
});
