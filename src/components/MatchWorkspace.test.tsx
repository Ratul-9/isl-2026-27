import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createMatch } from '@/domain/match';
import { MatchWorkspace } from './MatchWorkspace';

type User = ReturnType<typeof userEvent.setup>;

function setup() {
  const user = userEvent.setup();
  render(<MatchWorkspace initialMatch={createMatch()} initialView="setup" />);
  return user;
}

async function openSection(user: User, name: RegExp | string) {
  const nav = screen.getByRole('navigation', { name: /setup sections/i });
  await user.click(within(nav).getByRole('button', { name }));
}

async function addPlayer(
  user: User,
  { name, number, role }: { name: string; number: string; role?: 'Starting XI' | 'Substitute' },
) {
  const form = screen.getByRole('form', { name: 'Add player' });
  await user.clear(within(form).getByLabelText('Full name'));
  await user.type(within(form).getByLabelText('Full name'), name);
  await user.clear(within(form).getByLabelText('Shirt number'));
  await user.type(within(form).getByLabelText('Shirt number'), number);
  if (role) await user.selectOptions(within(form).getByLabelText('Lineup role'), role);
  await user.click(within(form).getByRole('button', { name: 'Add player' }));
}

describe('MatchWorkspace', () => {
  it('shows the match name in the header as the teams are named', async () => {
    const user = setup();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Untitled match');

    await openSection(user, /home team/i);
    await user.type(screen.getByLabelText('Team name'), 'Mumbai City');
    await openSection(user, /away team/i);
    await user.type(screen.getByLabelText('Team name'), 'Goa');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Mumbai City vs Goa');
  });

  it('edits match details, officials and coaches', async () => {
    const user = setup();
    await user.type(screen.getByLabelText('Venue or stadium'), 'Salt Lake');
    expect(screen.getByLabelText('Venue or stadium')).toHaveValue('Salt Lake');

    await openSection(user, /match officials/i);
    await user.type(screen.getByLabelText('Referee'), 'R. Referee');
    await user.type(screen.getByLabelText('Fourth Official'), 'F. Official');
    expect(screen.getByLabelText('Referee')).toHaveValue('R. Referee');
    expect(screen.getByLabelText('Assistant Referee 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Assistant Referee 2')).toBeInTheDocument();

    await openSection(user, /home team/i);
    await user.type(screen.getByLabelText('Coach or manager'), 'Des Buckingham');
    expect(screen.getByLabelText('Coach or manager')).toHaveValue('Des Buckingham');
  });

  it('rejects an out-of-range duration and accepts a valid one', async () => {
    const user = setup();
    const duration = screen.getByLabelText('Match duration (minutes)');
    await user.clear(duration);
    await user.type(duration, '5');
    expect(screen.getByText(/between 10 and 180/i)).toBeInTheDocument();
    await user.clear(duration);
    await user.type(duration, '80');
    expect(screen.queryByText(/between 10 and 180/i)).not.toBeInTheDocument();
    expect(duration).toHaveValue(80);
  });

  it('adds a starter and a substitute to the correct lists', async () => {
    const user = setup();
    await openSection(user, /home team/i);
    await addPlayer(user, { name: 'Keeper One', number: '1' });
    await addPlayer(user, { name: 'Bench Two', number: '12', role: 'Substitute' });

    const xi = screen.getByRole('region', { name: /starting xi/i });
    const subs = screen.getByRole('region', { name: /substitutes/i });
    expect(within(xi).getByText('Keeper One')).toBeInTheDocument();
    expect(within(xi).queryByText('Bench Two')).not.toBeInTheDocument();
    expect(within(subs).getByText('Bench Two')).toBeInTheDocument();
    expect(within(xi).getByText('1 of 11 selected')).toBeInTheDocument();
    expect(within(subs).getByText('1 of 11 selected')).toBeInTheDocument();
  });

  it('blocks a duplicate shirt number within a team with a clear message', async () => {
    const user = setup();
    await openSection(user, /home team/i);
    await addPlayer(user, { name: 'First', number: '9' });
    await addPlayer(user, { name: 'Second', number: '9' });

    expect(screen.getByText(/#9 is already worn by First/)).toBeInTheDocument();
    const xi = screen.getByRole('region', { name: /starting xi/i });
    expect(within(xi).queryByText('Second')).not.toBeInTheDocument();
  });

  it('allows the same shirt number in the other team', async () => {
    const user = setup();
    await openSection(user, /home team/i);
    await addPlayer(user, { name: 'Home Nine', number: '9' });
    await openSection(user, /away team/i);
    await addPlayer(user, { name: 'Away Nine', number: '9' });

    expect(screen.getByText('Away Nine')).toBeInTheDocument();
    expect(screen.queryByText('Home Nine')).not.toBeInTheDocument();
    expect(screen.queryByText(/already worn/)).not.toBeInTheDocument();
  });

  it('moves players between the XI and the bench and edits them in place', async () => {
    const user = setup();
    await openSection(user, /home team/i);
    await addPlayer(user, { name: 'Mover', number: '8' });

    await user.click(screen.getByRole('button', { name: 'To bench' }));
    expect(within(screen.getByRole('region', { name: /substitutes/i })).getByText('Mover')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit Mover' }));
    const edit = screen.getByRole('form', { name: 'Save player' });
    await user.clear(within(edit).getByLabelText('Full name'));
    await user.type(within(edit).getByLabelText('Full name'), 'Renamed');
    await user.click(within(edit).getByRole('button', { name: 'Save player' }));

    const subs = screen.getByRole('region', { name: /substitutes/i });
    expect(within(subs).getByText('Renamed')).toBeInTheDocument();
    expect(within(subs).queryByText('Mover')).not.toBeInTheDocument();
  });

  it('removes a player only after confirmation', async () => {
    const user = setup();
    await openSection(user, /home team/i);
    await addPlayer(user, { name: 'Leaver', number: '3' });

    await user.click(screen.getByRole('button', { name: 'Remove Leaver' }));
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.getByText('Leaver')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove Leaver' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByText('Leaver')).not.toBeInTheDocument();
  });

  it('stops at 11 starters: the 12th player defaults to substitute and promotion is refused', async () => {
    const user = setup();
    await openSection(user, /home team/i);
    for (let n = 1; n <= 12; n++) {
      await addPlayer(user, { name: `Player ${n}`, number: String(n) });
    }
    const xi = screen.getByRole('region', { name: /starting xi/i });
    const subs = screen.getByRole('region', { name: /substitutes/i });
    expect(within(xi).getByText('11 of 11 selected')).toBeInTheDocument();
    expect(within(subs).getByText('Player 12')).toBeInTheDocument();

    await user.click(within(subs).getByRole('button', { name: 'To XI' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/already has 11/i);
    expect(within(subs).getByText('Player 12')).toBeInTheDocument();
  });

  it('lists incomplete setup items in the checklist', () => {
    setup();
    const checklist = screen.getByRole('complementary', { name: /setup checklist/i });
    expect(within(checklist).getByText(/home team name is not set/i)).toBeInTheDocument();
    expect(within(checklist).getByText(/home team starting XI has 0 of 11/i)).toBeInTheDocument();
    expect(within(checklist).getByText(/away team starting XI has 0 of 11/i)).toBeInTheDocument();
  });

  it('switches between the board and setup views from the header', async () => {
    const user = setup();
    const workspaceNav = screen.getByRole('navigation', { name: 'Workspace' });
    await user.click(within(workspaceNav).getByRole('button', { name: 'Board' }));
    expect(screen.getByRole('group', { name: /tactical board/i })).toBeInTheDocument();
    await user.click(within(workspaceNav).getByRole('button', { name: 'Setup' }));
    expect(screen.getByRole('navigation', { name: /setup sections/i })).toBeInTheDocument();
  });
});
