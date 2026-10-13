import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchWorkspace } from '@/components/MatchWorkspace';
import { drawings, matchWithSquads, mockBoardLayout } from '@/components/board/boardTestUtils';

// A controllable animation-frame clock, as in the other replay tests.
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

async function open() {
  const user = userEvent.setup();
  render(<MatchWorkspace initialMatch={matchWithSquads()} />);
  await user.click(screen.getByRole('button', { name: 'Tactical Bench' }));
  const patterns = screen.getByRole('region', { name: 'Tactical patterns' });
  await user.selectOptions(within(patterns).getByLabelText('Pattern'), 'Wide overload');
  await user.click(within(patterns).getByRole('button', { name: /watch animated scenario/i }));
  return { user, dialog: screen.getByRole('dialog', { name: /wide overload/i }), patterns };
}

const slider = (d: HTMLElement) => within(d).getByRole('slider', { name: 'Replay position' }) as HTMLInputElement;
const time = (d: HTMLElement) => Number(slider(d).value);
const seek = (d: HTMLElement, t: number) => fireEvent.change(slider(d), { target: { value: String(t) } });
const caption = (d: HTMLElement) => within(d).getByTestId('replay-caption').textContent ?? '';
const stages = (d: HTMLElement) => within(within(d).getByRole('list', { name: 'Stages' })).getAllByRole('button');
const currentStage = (d: HTMLElement) => stages(d).find((b) => b.getAttribute('aria-current') === 'step')?.textContent ?? '';
const spaceIds = (d: HTMLElement) => Array.from(d.querySelectorAll('[data-space-id]')).map((e) => e.getAttribute('data-space-id'));
const pitch = (d: HTMLElement) => d.querySelector('svg[data-replay-time]') as SVGSVGElement;

describe('Wide overload scenario in the UI', () => {
  it('opens from the existing pattern entry and applies nothing to the board', async () => {
    const { dialog } = await open();
    expect(within(dialog).getByRole('heading', { name: /wide overload/i })).toBeInTheDocument();
    expect(drawings()).toHaveLength(0);
  });

  it('shows seventeen players with their shirt numbers and a key', async () => {
    const { dialog } = await open();
    expect(pitch(dialog).querySelectorAll('[data-actor-id]:not([data-actor-id="ball"])')).toHaveLength(17);
    expect(within(dialog).getByRole('img', { name: /Home FC: 11 Left winger/ })).toHaveTextContent('11');
    expect(within(dialog).getByRole('img', { name: /Home FC: 3 Left back/ })).toHaveTextContent('3');
    expect(within(dialog).getByRole('img', { name: /Home FC: 7 Right winger/ })).toHaveTextContent('7');
    expect(within(dialog).getByRole('img', { name: /Away FC: 8 Central mid/ })).toHaveTextContent('8');
    const key = within(dialog).getByRole('group', { name: 'Players' });
    expect(key).toHaveTextContent('11 Left winger');
    expect(key).not.toHaveTextContent('11 11');
  });

  it('lists seven stages, the last unreachable until an option is chosen, and plays 1 → 6 in order', async () => {
    const { user, dialog } = await open();
    expect(stages(dialog)).toHaveLength(7);
    expect(stages(dialog)[6]).toBeDisabled();
    expect(currentStage(dialog)).toMatch(/Stage 1.*Initial structure/);
    await user.click(within(dialog).getByRole('button', { name: 'Play' }));
    const seen: string[] = [];
    for (let i = 0; i < 70; i++) {
      advance(250);
      const s = currentStage(dialog).match(/Stage \d/)?.[0] ?? '';
      if (seen[seen.length - 1] !== s) seen.push(s);
    }
    expect(seen).toEqual(['Stage 1', 'Stage 2', 'Stage 3', 'Stage 4', 'Stage 5', 'Stage 6']);
    expect(time(dialog)).toBeCloseTo(13.6, 1);
    expect(within(dialog).getByRole('button', { name: 'Play again' })).toBeInTheDocument();
    expect(caption(dialog)).toMatch(/decision point/i);
  }, 20000);

  it('shows the count only when the positions support it', async () => {
    const { dialog } = await open();
    const overload = () => dialog.querySelector('[data-space-id="overload"]')?.textContent ?? '';
    seek(dialog, 3);
    expect(overload()).toBe('');
    seek(dialog, 9);
    expect(overload()).toMatch(/4v2 overload/);
    seek(dialog, 10.4);
    expect(overload()).toMatch(/4v3 overload/);
    expect(within(dialog).getByRole('region', { name: 'Spaces right now' })).toHaveTextContent(/4v3 overload/);
  });

  it('opens different space for each defensive response, and only when the defenders leave it', async () => {
    const { user, dialog } = await open();
    seek(dialog, 13.6);
    expect(spaceIds(dialog)).toEqual(expect.arrayContaining(['far-space', 'switch-lane']));
    expect(spaceIds(dialog)).not.toContain('central-space');
    expect(spaceIds(dialog)).not.toContain('break-lane');
    await user.click(within(dialog).getByRole('button', { name: 'Midfielder steps out' }));
    expect(time(dialog)).toBe(0);
    seek(dialog, 13.6);
    expect(spaceIds(dialog)).toEqual(expect.arrayContaining(['central-space', 'break-lane']));
    expect(spaceIds(dialog)).not.toContain('far-space');
    expect(spaceIds(dialog)).not.toContain('switch-lane');
  });

  it('plays the line-breaking pass where it is on, and keeps the ball where it is not', async () => {
    const { user, dialog } = await open();
    seek(dialog, 13.6);
    await user.click(within(dialog).getByRole('button', { name: /Line-breaking pass/ }));
    for (let i = 0; i < 40; i++) advance(250);
    expect(stages(dialog)[6]).toBeEnabled();
    expect(currentStage(dialog)).toMatch(/Stage 7/);
    expect(caption(dialog)).toMatch(/is closed at this moment/);
    expect(caption(dialog)).toMatch(/keeps the ball/);

    await user.click(within(dialog).getByRole('button', { name: /Back to the decision point/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Midfielder steps out' }));
    seek(dialog, 13.6);
    await user.click(within(dialog).getByRole('button', { name: /Line-breaking pass/ }));
    for (let i = 0; i < 40; i++) advance(250);
    expect(caption(dialog)).toMatch(/The lane was open at release/);
    expect(caption(dialog)).toMatch(/No\. 9 receives/);
  }, 20000);

  it('plays the diagonal switch only where it is on, and each option independently', async () => {
    const { user, dialog } = await open();
    seek(dialog, 13.6);
    await user.click(within(dialog).getByRole('button', { name: /Diagonal switch/ }));
    for (let i = 0; i < 45; i++) advance(250);
    expect(caption(dialog)).toMatch(/lane was open at release/i);
    expect(Number(slider(dialog).max)).toBeCloseTo(17, 3);
    const group = within(dialog).getByRole('group', { name: 'Final options' });
    expect(within(group).getAllByRole('button', { pressed: true })).toHaveLength(1);

    await user.click(within(group).getByRole('button', { name: /Recycle/ }));
    expect(Number(slider(dialog).max)).toBeCloseTo(15.8, 3);
    for (let i = 0; i < 30; i++) advance(250);
    expect(caption(dialog)).toMatch(/Possession is kept/);
  }, 20000);

  it('resets and replays from the start with the same outcome and option', async () => {
    const { user, dialog } = await open();
    seek(dialog, 13.6);
    await user.click(within(dialog).getByRole('button', { name: /Recycle/ }));
    for (let i = 0; i < 30; i++) advance(250);
    await user.click(within(dialog).getByRole('button', { name: 'Reset to start' }));
    expect(time(dialog)).toBe(0);
    expect(currentStage(dialog)).toMatch(/Stage 1/);
    expect(within(dialog).getByRole('button', { name: /Recycle/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(dialog).getByRole('button', { name: 'Replay from the beginning' }));
    advance(2000);
    expect(time(dialog)).toBeGreaterThan(1.5);
  }, 20000);

  it('steps between stages and jumps from the stage strip', async () => {
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Next stage' }));
    expect(time(dialog)).toBeCloseTo(2.6, 2);
    await user.click(stages(dialog)[3]);
    expect(time(dialog)).toBeCloseTo(9, 2);
    expect(currentStage(dialog)).toMatch(/Stage 4/);
  });

  it('mirrors to the right flank: the winger who overloads becomes the No. 7 and the far-side winger the No. 11', async () => {
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: /right flank/i }));
    expect(within(dialog).getByRole('img', { name: /Home FC: 7 Right winger/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: /Home FC: 2 Right back/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: /Home FC: 11 Left winger/ })).toBeInTheDocument();
    seek(dialog, 9);
    expect(within(dialog).getByRole('region', { name: 'Spaces right now' })).toHaveTextContent(/overload/);
  });

  it('leaves the overlap scenario untouched', async () => {
    const user = userEvent.setup();
    render(<MatchWorkspace initialMatch={matchWithSquads()} />);
    await user.click(screen.getByRole('button', { name: 'Tactical Bench' }));
  const patterns = screen.getByRole('region', { name: 'Tactical patterns' });
    await user.selectOptions(within(patterns).getByLabelText('Pattern'), 'Overlapping full-back');
    await user.click(within(patterns).getByRole('button', { name: /watch animated scenario/i }));
    const dialog = screen.getByRole('dialog', { name: /overlapping/i });
    expect(stages(dialog)).toHaveLength(5);
    expect(within(dialog).getByRole('button', { name: /Outcome B/ })).toBeInTheDocument();
  });
});
