import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchWorkspace } from '@/components/MatchWorkspace';
import type { WorkspaceView } from '@/components/layout/AppHeader';
import { board, matchWithSquads, mockBoardLayout } from '@/components/board/boardTestUtils';
import { at, goal, sub, withEvents } from '@/domain/eventFixtures';
import type { Match } from '@/domain/types';
import { MINUTE_MS } from '@/domain/time';

const T0 = Date.UTC(2026, 9, 10, 19, 30);
type User = ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  // Fake only time sources; user-event keeps using the real setTimeout.
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(T0);
  mockBoardLayout();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup(match: Match = matchWithSquads(), view: WorkspaceView = 'events') {
  const user = userEvent.setup();
  render(<MatchWorkspace initialMatch={match} initialView={view} />);
  return user;
}

/** A match whose second half started `minutesIn` minutes before the faked "now". */
function secondHalfAt(minutesIn: number): Match {
  return {
    ...matchWithSquads(),
    clock: {
      period: 'secondHalf',
      elapsedMs: minutesIn * MINUTE_MS,
      runningSinceEpochMs: T0,
      endedPeriod: 'firstHalf',
    },
  };
}

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const timer = () => screen.getByRole('timer');
const score = () => screen.getByTestId('score').textContent;
const scoreboard = () => screen.getByRole('region', { name: 'Scoreboard' });
const timeline = () => screen.getByRole('list', { name: 'Match timeline' });
const entries = () => within(timeline()).getAllByRole('button');
const goTo = (user: User, tab: 'Board' | 'Events' | 'Setup') =>
  user.click(within(screen.getByRole('navigation', { name: 'Workspace' })).getByRole('button', { name: tab }));

async function kickOff(user: User) {
  await user.click(within(scoreboard()).getByRole('button', { name: 'Kick off' }));
}

async function record(user: User, kind: 'Goal' | 'Substitution' | 'Card' | 'Note') {
  await user.click(within(screen.getByRole('group', { name: 'Event type' })).getByRole('button', { name: kind }));
}

const form = (name: RegExp | string) => screen.getByRole('form', { name });

describe('scoreboard and clock', () => {
  it('starts the clock from timestamps and keeps time across pause and resume', async () => {
    const user = setup();
    expect(timer()).toHaveTextContent('00:00');
    expect(within(scoreboard()).getByText(/Not started/)).toBeInTheDocument();

    await kickOff(user);
    expect(within(scoreboard()).getByText(/First half/)).toBeInTheDocument();
    advance(90_000);
    expect(timer()).toHaveTextContent('01:30');

    await user.click(within(scoreboard()).getByRole('button', { name: 'Pause' }));
    advance(60_000);
    expect(timer()).toHaveTextContent('01:30');

    await user.click(within(scoreboard()).getByRole('button', { name: 'Resume' }));
    advance(30_000);
    expect(timer()).toHaveTextContent('02:00');
  });

  it('keeps counting, in the same element, when the user changes sections', async () => {
    const user = setup(matchWithSquads(), 'board');
    await kickOff(user);
    const before = timer();
    advance(5 * 60_000);
    await goTo(user, 'Setup');
    expect(timer()).toBe(before);
    expect(timer()).toHaveTextContent('05:00');
    advance(60_000);
    await goTo(user, 'Events');
    expect(timer()).toHaveTextContent('06:00');
    await goTo(user, 'Board');
    expect(timer()).toHaveTextContent('06:00');
  });

  it('moves through the periods, records markers and shows stoppage time', async () => {
    const user = setup();
    await kickOff(user);
    advance(47 * 60_000 + 13_000);
    expect(timer()).toHaveTextContent('45:00');
    expect(timer()).toHaveTextContent('+2:13');

    await user.click(within(scoreboard()).getByRole('button', { name: 'Half time' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Half time' }));
    expect(within(scoreboard()).getByText(/Half time/)).toBeInTheDocument();
    expect(within(scoreboard()).queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();

    await user.click(within(scoreboard()).getByRole('button', { name: 'Start second half' }));
    advance(10 * 60_000);
    expect(timer()).toHaveTextContent('55:00');

    await user.click(within(scoreboard()).getByRole('button', { name: 'Full time' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Full time' }));
    expect(within(scoreboard()).getByText(/Full time/)).toBeInTheDocument();

    const text = entries().map((b) => b.getAttribute('aria-label'));
    expect(text).toEqual([
      expect.stringContaining('Kick-off'),
      expect.stringContaining('Half-time'),
      expect.stringContaining('Second-half kick-off'),
      expect.stringContaining('Full-time'),
    ]);
  });

  it('corrects the period and time, with clear validation', async () => {
    const user = setup();
    await kickOff(user);
    await user.click(within(scoreboard()).getByRole('button', { name: /correct clock/i }));
    const correction = form('Correct match clock');

    await user.selectOptions(within(correction).getByLabelText('Period'), 'Second half');
    const time = within(correction).getByLabelText('Match time (mm:ss)');
    await user.clear(time);
    await user.type(time, 'soon');
    await user.click(within(correction).getByRole('button', { name: 'Set clock' }));
    expect(within(correction).getByText('Enter the time as mm:ss, e.g. 67:30.')).toBeInTheDocument();

    await user.clear(time);
    await user.type(time, '10:00');
    await user.click(within(correction).getByRole('button', { name: 'Set clock' }));
    expect(within(correction).getByText(/runs from 45:00/)).toBeInTheDocument();

    await user.clear(time);
    await user.type(time, '67:30');
    await user.click(within(correction).getByRole('button', { name: 'Set clock' }));
    expect(screen.queryByRole('form', { name: 'Correct match clock' })).not.toBeInTheDocument();
    expect(timer()).toHaveTextContent('67:30');
    advance(30_000);
    expect(timer()).toHaveTextContent('68:00');
  });
});

describe('goals', () => {
  async function liveAt(user: User, minutes: number) {
    await kickOff(user);
    advance(minutes * 60_000 + 20_000);
  }

  it('records a goal at the live minute and updates the scoreboard and timeline', async () => {
    const user = setup();
    expect(screen.getByText(/No events yet/)).toBeInTheDocument();
    await liveAt(user, 12);
    await record(user, 'Goal');
    const goalForm = form('Record goal');
    expect(within(goalForm).getByLabelText('Minute')).toHaveValue(13);
    await user.selectOptions(within(goalForm).getByLabelText('Scorer'), 'home-p9');
    await user.selectOptions(within(goalForm).getByLabelText('Assist (optional)'), 'home-p8');
    await user.click(within(goalForm).getByRole('button', { name: 'Add to timeline' }));

    expect(score()).toBe('1–0');
    expect(screen.getByRole('group', { name: /Score: Home FC 1, Away FC 0/ })).toBeInTheDocument();
    const entry = entries().find((b) => /Goal: Striker/.test(b.getAttribute('aria-label')!))!;
    expect(entry).toHaveAttribute('aria-label', "13' Home FC Goal: Striker, assist Left Wing");
    // The form closes after saving.
    expect(screen.queryByRole('form', { name: 'Record goal' })).not.toBeInTheDocument();
  });

  it('allows a goal with no scorer and no assist', async () => {
    const user = setup();
    await liveAt(user, 5);
    await record(user, 'Goal');
    await user.click(within(form('Record goal')).getByRole('button', { name: 'Add to timeline' }));
    expect(score()).toBe('1–0');
    expect(screen.getByText('Goal: scorer not recorded')).toBeInTheDocument();
  });

  it('keeps the scorer out of the assist list', async () => {
    const user = setup();
    await liveAt(user, 5);
    await record(user, 'Goal');
    const goalForm = form('Record goal');
    await user.selectOptions(within(goalForm).getByLabelText('Scorer'), 'home-p9');
    const assist = within(goalForm).getByLabelText('Assist (optional)');
    expect(within(assist).queryByRole('option', { name: '#9 Striker' })).not.toBeInTheDocument();
    expect(within(assist).getByRole('option', { name: '#8 Left Mid' })).toBeInTheDocument();
  });

  it('credits an own goal to the opposing team and takes the player from the other squad', async () => {
    const user = setup();
    await liveAt(user, 30);
    await record(user, 'Goal');
    const goalForm = form('Record goal');
    await user.selectOptions(within(goalForm).getByLabelText('Goal type'), 'Own goal');
    expect(within(goalForm).queryByLabelText('Assist (optional)')).not.toBeInTheDocument();
    // Needs the responsible player first.
    expect(within(goalForm).getByRole('button', { name: 'Add to timeline' })).toBeDisabled();
    expect(within(goalForm).getByText('Choose the player who scored the own goal.')).toBeInTheDocument();

    const scorer = within(goalForm).getByLabelText(/Own goal scored by \(Away FC player\)/);
    await user.selectOptions(scorer, 'away-p3');
    expect(within(goalForm).getByText('The goal is credited to Home FC.')).toBeInTheDocument();
    await user.click(within(goalForm).getByRole('button', { name: 'Add to timeline' }));

    expect(score()).toBe('1–0');
    expect(screen.getByText('Own goal: Right CB')).toBeInTheDocument();
    expect(screen.getByText('credited to Home FC')).toBeInTheDocument();
  });

  it('edits a goal (team change moves the score) and deletes it', async () => {
    const user = setup();
    await liveAt(user, 8);
    await record(user, 'Goal');
    await user.selectOptions(within(form('Record goal')).getByLabelText('Scorer'), 'home-p9');
    await user.click(within(form('Record goal')).getByRole('button', { name: 'Add to timeline' }));
    expect(score()).toBe('1–0');

    await user.click(entries().find((b) => /Goal: Striker/.test(b.getAttribute('aria-label')!))!);
    const edit = form('Edit goal');
    await user.click(within(edit).getByRole('radio', { name: 'Away FC' }));
    await user.selectOptions(within(edit).getByLabelText('Scorer'), 'away-p9');
    await user.click(within(edit).getByRole('button', { name: 'Save changes' }));
    expect(score()).toBe('0–1');

    await user.click(entries().find((b) => /Goal: Striker/.test(b.getAttribute('aria-label')!))!);
    await user.click(within(form('Edit goal')).getByRole('button', { name: /delete event/i }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    expect(score()).toBe('0–0');
    expect(screen.queryByText(/Goal: Striker/)).not.toBeInTheDocument();
  });

  it('rejects an invalid minute without saving', async () => {
    const user = setup();
    await record(user, 'Goal');
    const goalForm = form('Record goal');
    const minute = within(goalForm).getByLabelText('Minute');
    await user.clear(minute);
    expect(within(goalForm).getByRole('button', { name: 'Add to timeline' })).toBeDisabled();
    expect(within(goalForm).getAllByText(/Enter a valid minute/).length).toBeGreaterThan(0);
  });

  it('orders the timeline by match time, not entry order', async () => {
    const base = matchWithSquads();
    const user = setup(withEvents(base, goal(base, 'home', at(70), { scorer: 'home-p9' }), goal(base, 'away', at(10), { scorer: 'away-p9' }), goal(base, 'home', at(45, 2), { scorer: 'home-p8' })));
    expect(entries().map((b) => b.getAttribute('aria-label')!.split(' ')[0])).toEqual(["10'", "45+2'", "70'"]);
    expect(score()).toBe('2–1');
    // First-half stoppage time sits under First half, not after the second-half goal.
    expect(within(timeline()).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['First half', 'Second half']);
    void user;
  });
});

describe('substitutions', () => {
  it('records a substitution, updates the pitch and bench, and shows the standard text', async () => {
    const user = setup(secondHalfAt(21));
    await record(user, 'Substitution');
    const subForm = form('Record substitution');
    expect(within(subForm).getByLabelText('Minute')).toHaveValue(67);
    // Only on-pitch players can go off; only unused substitutes can come on.
    const out = within(subForm).getByLabelText('Player going off');
    const inn = within(subForm).getByLabelText('Player coming on');
    expect(within(out).queryByRole('option', { name: '#12 Sub 0' })).not.toBeInTheDocument();
    expect(within(inn).queryByRole('option', { name: '#9 Striker' })).not.toBeInTheDocument();
    await user.selectOptions(out, 'home-p9');
    await user.selectOptions(inn, 'home-s0');
    await user.type(within(subForm).getByLabelText('Reason (optional)'), 'Tired');
    await user.click(within(subForm).getByRole('button', { name: 'Add to timeline' }));

    expect(screen.getByRole('button', { name: "67' Home FC Striker OFF, Sub 0 ON" })).toBeInTheDocument();
    expect(screen.getByText('Tired')).toBeInTheDocument();

    await goTo(user, 'Board');
    const marker = within(board()).getByRole('button', { name: /^Home FC: #12 Sub 0/ });
    expect(marker).toHaveAttribute('data-position', 'ST');
    expect(within(board()).queryByRole('button', { name: /^Home FC: #9 Striker/ })).not.toBeInTheDocument();
    const bench = screen.getByRole('group', { name: 'Home FC bench' });
    expect(within(bench).getByText('#13 Sub 1, #14 Sub 2')).toBeInTheDocument();
    expect(within(bench).getByText('Substituted off')).toBeInTheDocument();
    expect(within(bench).getByText(/1 substitution/)).toBeInTheDocument();
  });

  it('supports several substitutions in the same minute', async () => {
    const user = setup(secondHalfAt(25));
    for (const [out, inn] of [
      ['home-p9', 'home-s0'],
      ['home-p8', 'home-s1'],
    ]) {
      await record(user, 'Substitution');
      const f = form('Record substitution');
      await user.selectOptions(within(f).getByLabelText('Player going off'), out);
      await user.selectOptions(within(f).getByLabelText('Player coming on'), inn);
      await user.click(within(f).getByRole('button', { name: 'Add to timeline' }));
    }
    expect(entries().filter((b) => /OFF/.test(b.getAttribute('aria-label')!))).toHaveLength(2);
    await goTo(user, 'Board');
    expect(within(board()).getAllByRole('button', { name: /^Home FC: #1[23] Sub/ })).toHaveLength(2);
  });

  it('requires both players before it can be saved', async () => {
    const user = setup();
    await record(user, 'Substitution');
    const f = form('Record substitution');
    expect(within(f).getByRole('button', { name: 'Add to timeline' })).toBeDisabled();
    expect(within(f).getByText('Choose the outgoing player.')).toBeInTheDocument();
    expect(within(f).getByText('Choose the incoming player.')).toBeInTheDocument();
  });

  it('flags later substitutions when an earlier one is corrected, without duplicating players', async () => {
    const base = matchWithSquads();
    const user = setup(
      withEvents(
        base,
        sub(base, 'home', at(60), 'home-p9', 'home-s0', 'first'),
        sub(base, 'home', at(80), 'home-s0', 'home-s1', 'second'),
      ),
    );
    await user.click(screen.getByRole('button', { name: "60' Home FC Striker OFF, Sub 0 ON" }));
    const edit = form('Edit substitution');
    await user.selectOptions(within(edit).getByLabelText('Player coming on'), 'home-s2');
    expect(within(edit).getByLabelText('Later events affected')).toHaveTextContent('Sub 0 OFF, Sub 1 ON');
    await user.click(within(edit).getByRole('button', { name: 'Save and flag 1' }));

    const second = screen.getByRole('button', { name: /80' Home FC Sub 0 OFF, Sub 1 ON \(invalid\)/ });
    expect(second).toHaveTextContent(/Invalid/);

    await goTo(user, 'Board');
    const bench = screen.getByRole('group', { name: 'Home FC bench' });
    const onPitch = within(board()).getAllByRole('button', { name: /^Home FC: #/ });
    expect(onPitch).toHaveLength(11);
    expect(within(board()).getByRole('button', { name: /^Home FC: #14 Sub 2/ })).toBeInTheDocument();
    expect(within(bench).getByText('#12 Sub 0, #13 Sub 1')).toBeInTheDocument();
  });

  it('opens the substitution form from the board bench panel', async () => {
    const user = setup(matchWithSquads(), 'board');
    await user.click(screen.getByRole('button', { name: /record substitution/i }));
    expect(form('Record substitution')).toBeInTheDocument();
  });
});

describe('cards and notes', () => {
  it('records yellow cards, warns about the second, and removes a sent-off player from the pitch', async () => {
    const user = setup();
    await kickOff(user);
    advance(20 * 60_000);
    const book = async (card: 'Yellow card' | 'Red card', player: string) => {
      await record(user, 'Card');
      const f = form('Record card');
      await user.click(within(f).getByRole('radio', { name: card }));
      await user.selectOptions(within(f).getByLabelText('Player'), player);
      return f;
    };

    let f = await book('Yellow card', 'home-p5');
    await user.click(within(f).getByRole('button', { name: 'Add to timeline' }));
    expect(screen.getByText('Yellow card: Pivot')).toBeInTheDocument();

    advance(30 * 60_000);
    f = await book('Yellow card', 'home-p5');
    expect(within(f).getByLabelText('Warnings')).toHaveTextContent('Second yellow card');
    await user.click(within(f).getByRole('button', { name: 'Add to timeline' }));

    await goTo(user, 'Board');
    expect(within(board()).queryByRole('button', { name: /^Home FC: #6 Pivot/ })).not.toBeInTheDocument();
    expect(within(board()).getAllByRole('button', { name: /^Home FC: empty/ })).toHaveLength(1);
    expect(within(screen.getByRole('group', { name: 'Home FC bench' })).getByText('Sent off')).toBeInTheDocument();

    // Sent-off players can no longer be carded.
    await goTo(user, 'Events');
    await record(user, 'Card');
    const again = form('Record card');
    expect(within(within(again).getByLabelText('Player')).queryByRole('option', { name: '#6 Pivot' })).not.toBeInTheDocument();
  });

  it('records a note without a team and filters the timeline', async () => {
    const base = matchWithSquads();
    const user = setup(withEvents(base, goal(base, 'home', at(10), { scorer: 'home-p9' })));
    await record(user, 'Note');
    const f = form('Record note');
    await user.type(within(f).getByLabelText('Note'), 'VAR check');
    await user.click(within(f).getByRole('button', { name: 'Add to timeline' }));
    expect(screen.getByText('VAR check')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Show'), 'Notes');
    expect(entries()).toHaveLength(1);
    await user.selectOptions(screen.getByLabelText('Show'), 'Cards');
    expect(screen.getByText('Nothing matches this filter.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Show'), 'All');
    expect(entries()).toHaveLength(2);
  });

  it('requires note text', async () => {
    const user = setup();
    await record(user, 'Note');
    const f = form('Record note');
    expect(within(f).getByRole('button', { name: 'Add to timeline' })).toBeDisabled();
    expect(within(f).getByText('Write the note.')).toBeInTheDocument();
  });
});

describe('inspecting events', () => {
  it('opens a timeline entry for editing and can edit a period marker time', async () => {
    const user = setup();
    await kickOff(user);
    await user.click(entries()[0]);
    const edit = form('Edit period marker');
    expect(within(edit).getByLabelText('Minute')).toHaveValue(1);
    await user.click(within(edit).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Edit period marker' })).not.toBeInTheDocument();
  });

  it('shows invalid events with their reason and explains deletion consequences', async () => {
    const base = matchWithSquads();
    const user = setup(
      withEvents(
        base,
        sub(base, 'home', at(60), 'home-p9', 'home-s0', 'first'),
        sub(base, 'home', at(80), 'home-s0', 'home-s1', 'second'),
      ),
    );
    await user.click(screen.getByRole('button', { name: "60' Home FC Striker OFF, Sub 0 ON" }));
    await user.click(within(form('Edit substitution')).getByRole('button', { name: /delete event/i }));
    expect(within(screen.getByRole('alertdialog')).getByText(/1 later event will become invalid/)).toBeInTheDocument();
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));

    const remaining = entries();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toHaveAttribute('aria-label', expect.stringContaining('(invalid)'));
    expect(screen.getByText(/ignored in the score and lineups/)).toBeInTheDocument();
  });
});
