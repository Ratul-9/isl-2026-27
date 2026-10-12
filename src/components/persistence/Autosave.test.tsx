import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchWorkspace } from '@/components/MatchWorkspace';
import { board, mockBoardLayout } from '@/components/board/boardTestUtils';
import { analyzeEvents } from '@/domain/events';
import type { Match } from '@/domain/types';
import { FlakyRepository, persistentMemoryRepository, WithRepository } from '@/persistence/testHelpers';
import { KICKOFF_EPOCH, richMatch } from '@/persistence/testFixtures';
import { createMemoryRepository } from '@/persistence/repository';
import { AUTOSAVE_DELAY_MS } from './AutosaveProvider';

// The fixture's clock is running in the second half since kick-off + 1 h.
const RUNNING_SINCE = KICKOFF_EPOCH + 3_600_000;

beforeEach(() => {
  // setTimeout stays real: testing-library's async helpers hang on a faked one outside Jest.
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(RUNNING_SINCE + 5 * 60_000);
  mockBoardLayout();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const user = () => userEvent.setup({ delay: null });
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const timer = () => screen.getByRole('timer');
const status = () => screen.getByRole('status');

function open(repository: FlakyRepository | ReturnType<typeof persistentMemoryRepository>, match: Match, view: 'board' | 'setup' = 'setup') {
  return render(
    <WithRepository repository={repository}>
      <MatchWorkspace key={match.id} initialMatch={match} initialView={view} />
    </WithRepository>,
  );
}

async function openMatchesSetup(u: ReturnType<typeof user>) {
  const nav = screen.getByRole('navigation', { name: /setup sections/i });
  await u.click(within(nav).getByRole('button', { name: 'Match details' }));
}

describe('autosave', () => {
  it('saves changes after a short pause and shows the status', async () => {
    const repo = persistentMemoryRepository();
    const match = richMatch();
    repo.save(match);
    const u = user();
    open(repo, match);
    expect(status()).toHaveTextContent('Saved');

    const venue = screen.getByLabelText('Venue or stadium');
    await u.clear(venue);
    await u.type(venue, 'Salt Lake');
    expect(status()).toHaveTextContent('Saving…');
    // Nothing is written on every keystroke.
    expect(((repo.load(match.id) as { match: Match }).match).venue).toBe('Fatorda');

    await vi.waitFor(() => expect(status()).toHaveTextContent(/Saved/), { timeout: AUTOSAVE_DELAY_MS * 4 });
    expect((repo.load(match.id) as { match: Match }).match.venue).toBe('Salt Lake');
  });

  it('does not write anything for a match that has not changed', async () => {
    const flaky = new FlakyRepository(persistentMemoryRepository());
    open(flaky, richMatch());
    await new Promise((r) => setTimeout(r, AUTOSAVE_DELAY_MS + 200));
    expect(flaky.saves).toBe(0);
  });

  it('writes immediately when the editor closes, without waiting for the pause', async () => {
    const repo = persistentMemoryRepository();
    const match = richMatch();
    repo.save(match);
    const u = user();
    const view = open(repo, match);
    const venue = screen.getByLabelText('Venue or stadium');
    await u.clear(venue);
    await u.type(venue, 'Closed early');
    view.unmount();
    expect((repo.load(match.id) as { match: Match }).match.venue).toBe('Closed early');
  });

  it('keeps the work in memory when storage is full and lets the user retry', async () => {
    const flaky = new FlakyRepository(persistentMemoryRepository());
    const match = richMatch();
    flaky.save(match);
    const u = user();
    open(flaky, match);
    flaky.failWith = { kind: 'quota', message: 'Browser storage is full.' };

    const venue = screen.getByLabelText('Venue or stadium');
    await u.clear(venue);
    await u.type(venue, 'Unsaved venue');
    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument(), { timeout: AUTOSAVE_DELAY_MS * 4 });
    expect(screen.getByRole('alert')).toHaveTextContent('Not saved — Browser storage is full.');
    expect(venue).toHaveValue('Unsaved venue'); // nothing lost on screen
    expect((flaky.load(match.id) as { match: Match }).match.venue).toBe('Fatorda');

    flaky.failWith = null;
    await u.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(status()).toHaveTextContent(/Saved/);
    expect((flaky.load(match.id) as { match: Match }).match.venue).toBe('Unsaved venue');
  });

  it('says so plainly when the match only lives in this session', () => {
    open(createMemoryRepository(), richMatch());
    expect(status()).toHaveTextContent('Not saved (this session only)');
  });
});

describe('reload and restore', () => {
  it('restores the whole match after a reload, including a still-running clock', async () => {
    const repo = persistentMemoryRepository();
    const original = richMatch();
    repo.save(original);
    const u = user();
    const first = open(repo, original, 'board');

    // Work on the match: edit setup, move a player, draw an arrow, record a goal.
    expect(timer()).toHaveTextContent('60:00'); // 45:00 + 10:00 played + 5:00 since the clock reference
    await u.click(screen.getByRole('button', { name: 'Setup' }));
    await openMatchesSetup(u);
    const venue = screen.getByLabelText('Venue or stadium');
    await u.clear(venue);
    await u.type(venue, 'Reloaded Park');
    await u.click(screen.getByRole('button', { name: 'Events' }));
    await u.click(within(screen.getByRole('group', { name: 'Event type' })).getByRole('button', { name: 'Goal' }));
    const form = screen.getByRole('form', { name: 'Record goal' });
    await u.selectOptions(within(form).getByLabelText('Scorer'), 'home-p8');
    await u.click(within(form).getByRole('button', { name: 'Add to timeline' }));
    expect(screen.getByTestId('score')).toHaveTextContent('3–0');

    // "Close the tab": the debounce hasn't fired, but hiding/unmounting flushes.
    first.unmount();

    // Twenty minutes later the app is opened again from storage.
    vi.setSystemTime(RUNNING_SINCE + 25 * 60_000);
    const stored = repo.load(original.id);
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    open(repo, stored.match, 'board');

    expect(timer()).toHaveTextContent('80:00'); // clock kept running while the app was closed
    expect(screen.getByTestId('score')).toHaveTextContent('3–0');
    expect(within(board()).getAllByRole('button', { name: /^Home FC: / })).toHaveLength(11);
    expect(board().querySelectorAll('[data-drawing-id]')).toHaveLength(4);
    expect(stored.match.venue).toBe('Reloaded Park');
    expect(stored.match.savedLayouts).toEqual(original.savedLayouts);
    expect(analyzeEvents(stored.match).score).toEqual({ home: 3, away: 0 });
  });

  it('restores a paused clock without drift', async () => {
    const repo = persistentMemoryRepository();
    const paused: Match = {
      ...richMatch(),
      clock: { period: 'firstHalf', elapsedMs: 12 * 60_000 + 30_000, runningSinceEpochMs: null, endedPeriod: null },
    };
    repo.save(paused);
    vi.setSystemTime(RUNNING_SINCE + 10 * 3_600_000);
    const stored = repo.load(paused.id);
    if (!stored.ok) throw new Error('load failed');
    open(repo, stored.match);
    expect(timer()).toHaveTextContent('12:30');
    advance(60_000);
    expect(timer()).toHaveTextContent('12:30');
  });
});
