import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toView } from '@/domain/geometry';
import type { Match, Player, Team, TeamOrigin } from '@/domain/types';
import { MatchWorkspace } from '@/components/MatchWorkspace';
import { board, drag, marker, matchWithSquads, mockBoardLayout, translate } from './boardTestUtils';

beforeEach(() => mockBoardLayout());
afterEach(() => vi.restoreAllMocks());

const origin = (presetId: string): TeamOrigin => ({
  presetId,
  league: 'isl',
  season: '2026-27',
  snapshotAt: '2026-10-12T09:00:00.000Z',
  verifiedAt: null,
  officialName: presetId,
  shortName: null,
  abbreviation: null,
  city: null,
  logoUrl: null,
  profileUrl: null,
  coach: null,
});

/** Home = Mohun Bagan, away = Kerala Blasters (both with kit themes). The striker's number is a temporary one. */
function presetMatch(overrides: { home?: Partial<Team>; away?: Partial<Team>; playerDisplay?: Match['playerDisplay'] } = {}): Match {
  const m = matchWithSquads();
  const unknown = (p: Player): Player =>
    p.name === 'Striker'
      ? { ...p, origin: { presetId: 'p1', season: '2026-27', imported: { name: 'Striker', shirtNumber: null, position: 'ST' }, assignedNumber: p.shirtNumber, sourcePosition: null, nationality: null, dateOfBirth: null, photoUrl: null, profileUrl: null } }
      : p;
  return {
    ...m,
    home: { ...m.home, players: m.home.players.map(unknown), preset: origin('isl-club-1874'), ...overrides.home },
    away: { ...m.away, preset: origin('isl-club-498'), ...overrides.away },
    ...(overrides.playerDisplay ? { playerDisplay: overrides.playerDisplay } : {}),
  };
}

function setup(match: Match) {
  const user = userEvent.setup();
  render(<MatchWorkspace initialMatch={match} />);
  return user;
}

const display = () => screen.queryByRole('group', { name: 'Player display' });
const jerseys = () => board().querySelectorAll('[data-kit]');

describe('player display mode', () => {
  it('is not offered, and circles stay, for a match with custom teams', () => {
    setup(matchWithSquads());
    expect(display()).not.toBeInTheDocument();
    expect(jerseys()).toHaveLength(0);
    expect(screen.queryByRole('region', { name: 'Kits' })).not.toBeInTheDocument();
    expect(marker('#11 Left Wing')).toHaveTextContent('11');
  });

  it('is offered for preset teams with circles as the default', () => {
    setup(presetMatch());
    const group = within(display()!);
    expect(group.getByRole('button', { name: 'circles' })).toHaveAttribute('aria-pressed', 'true');
    expect(group.getByRole('button', { name: 'jerseys' })).toHaveAttribute('aria-pressed', 'false');
    expect(jerseys()).toHaveLength(0);
  });

  it('draws team-coloured jerseys with the real shirt numbers, and nothing for an unknown number', async () => {
    const user = setup(presetMatch());
    await user.click(within(display()!).getByRole('button', { name: 'jerseys' }));
    expect(jerseys().length).toBe(22);
    // Home = Mohun Bagan (green/maroon halves); away = Kerala Blasters (yellow).
    const homeKeeper = marker('#1 Keeper');
    expect(homeKeeper.querySelector('[data-kit="isl-club-1874-home"]')).not.toBeNull();
    expect(homeKeeper.querySelector('[data-pattern="halves"]')).not.toBeNull();
    expect(homeKeeper.querySelector('text')?.textContent).toBe('1');
    const awayKeeper = within(board()).getAllByRole('button', { name: /^Away FC: #1 / })[0];
    expect(awayKeeper.querySelector('[data-kit="isl-club-498-home"]')).not.toBeNull();
    // The striker still carries a temporary number: no number is printed or announced.
    const striker = within(board()).getByRole('button', { name: /^Home FC: Striker,/ });
    const printed = Array.from(striker.querySelectorAll('text')).map((t) => t.textContent);
    expect(printed).toEqual(['Striker', 'ST']); // name and position labels only; no number text
  });

  it('keeps positions, selection and everything else when switching back and forth', async () => {
    const user = setup(presetMatch());
    const target = toView({ x: 0.4, y: 0.25 }, 'landscape');
    drag(marker('#11 Left Wing'), target);
    await user.click(marker('#8 Left Mid'));
    const before = translate(marker('#8 Left Mid'));
    const strikerBefore = translate(marker('#11 Left Wing'));

    await user.click(within(display()!).getByRole('button', { name: 'jerseys' }));
    expect(translate(marker('#8 Left Mid'))).toEqual(before);
    expect(translate(marker('#11 Left Wing'))).toEqual(strikerBefore);
    expect(marker('#8 Left Mid')).toHaveAttribute('aria-pressed', 'true'); // selection kept

    await user.click(within(display()!).getByRole('button', { name: 'circles' }));
    expect(jerseys()).toHaveLength(0);
    expect(translate(marker('#11 Left Wing'))).toEqual(strikerBefore);
    expect(marker('#8 Left Mid')).toHaveAttribute('aria-pressed', 'true');
  });

  it('still drags players while jerseys are shown', async () => {
    const user = setup(presetMatch({ playerDisplay: 'jerseys' }));
    expect(jerseys().length).toBe(22);
    const target = toView({ x: 0.6, y: 0.3 }, 'landscape');
    drag(marker('#11 Left Wing'), target);
    const after = translate(marker('#11 Left Wing'));
    expect(after.x).toBeCloseTo(target.x, 6);
    expect(after.y).toBeCloseTo(target.y, 6);
    await user.keyboard('{Control>}z{/Control}');
    expect(translate(marker('#11 Left Wing')).x).not.toBeCloseTo(target.x, 3);
  });

  it('lets a side change kit and explains a generic away kit', async () => {
    const user = setup(presetMatch({ playerDisplay: 'jerseys' }));
    const kits = screen.getByRole('region', { name: 'Kits' });
    await user.selectOptions(within(kits).getByLabelText('Away FC kit'), 'away');
    expect(within(board()).getAllByRole('button', { name: /^Away FC: #1 / })[0].querySelector('[data-kit="isl-club-498-away"]')).not.toBeNull();
    expect(kits).toHaveTextContent('No documented away kit');
    expect(kits).toHaveTextContent('simplified designs');
  });

  it('keeps circles for a custom team in a mixed match', async () => {
    const user = setup(presetMatch({ away: { preset: undefined } }));
    await user.click(within(display()!).getByRole('button', { name: 'jerseys' }));
    expect(board().querySelectorAll('[data-side="home"] [data-kit]').length).toBe(11);
    expect(board().querySelectorAll('[data-side="away"] [data-kit]').length).toBe(0);
    expect(within(board()).getAllByRole('button', { name: /^Away FC: #1 / })[0]).toHaveTextContent('1');
  });
});
