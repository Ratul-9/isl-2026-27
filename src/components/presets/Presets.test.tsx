import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { board, mockBoardLayout } from '@/components/board/boardTestUtils';
import { MatchWorkspace } from '@/components/MatchWorkspace';
import { LibraryView } from '@/components/library/LibraryView';
import { MatchLoader } from '@/components/routes/MatchRoute';
import { PlayerAvatar, TeamLogo } from '@/components/ui/Avatars';
import { presetPlayer, presetSeason, presetTeam } from '@/domain/presets/fixtures';
import { buildMatchFromPresets } from '@/domain/presets/toMatch';
import type { PresetManifest, SeasonPresets } from '@/domain/presets/types';
import { MemoryStore, StoreMatchRepository } from '@/persistence/repository';
import { WithRepository } from '@/persistence/testHelpers';
import { NewMatchView } from './NewMatchView';
import type { PresetDeps } from './usePresetCatalog';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const manifestFor = (season: SeasonPresets): PresetManifest => ({
  format: 'dizpitch.presetindex',
  schemaVersion: 1,
  seasons: [
    {
      league: season.league,
      season: season.season,
      file: `${season.league.id}/${season.season}.json`,
      teams: season.teams.length,
      players: season.teams.reduce((n, t) => n + t.players.length, 0),
      generatedAt: season.generatedAt,
    },
  ],
});

/**
 * Deps that serve `current()` each time, so a test can "refresh the preset" between loads. The very
 * object is handed out (no copy), so any code that mutated a preset would be caught by the tests.
 */
function depsFor(current: () => SeasonPresets): PresetDeps {
  return {
    loadManifest: async () => ({ ok: true, value: manifestFor(current()) }),
    loadSeason: async () => ({ ok: true, value: current() }),
  };
}

type Screen = { at: 'new' } | { at: 'library' } | { at: 'match'; id: string };

function Harness({ deps }: { deps: PresetDeps }) {
  const [state, setState] = useState<Screen>({ at: 'new' });
  if (state.at === 'new') {
    return <NewMatchView deps={deps} now={() => new Date('2026-10-12T09:00:00.000Z')} onCreated={(id) => setState({ at: 'match', id })} onCancel={() => setState({ at: 'library' })} />;
  }
  if (state.at === 'match') return <MatchLoader key={state.id} id={state.id} onBack={() => setState({ at: 'library' })} />;
  return <LibraryView onOpen={(id) => setState({ at: 'match', id })} onCreateFromPresets={() => setState({ at: 'new' })} />;
}

let repo: StoreMatchRepository;
beforeEach(() => {
  repo = new StoreMatchRepository(new MemoryStore(), true);
  mockBoardLayout();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const renderHarness = (deps: PresetDeps) =>
  render(
    <WithRepository repository={repo}>
      <Harness deps={deps} />
    </WithRepository>,
  );

describe('Create match: ISL presets', () => {
  it('shows how to initialise when nothing has been imported, with no fake teams', async () => {
    const user = userEvent.setup();
    renderHarness({
      loadManifest: async () => ({ ok: false, kind: 'not-imported', message: 'The team presets have not been imported yet.' }),
      loadSeason: async () => {
        throw new Error('should not be called');
      },
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No team presets have been imported yet.');
    expect(alert).toHaveTextContent('npm run presets -- fetch --profiles --apply');
    expect(screen.queryByRole('list', { name: 'Teams' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Choose .* as the home team/ })).not.toBeInTheDocument();

    // Custom teams still work from the same screen.
    await user.click(screen.getByLabelText(/Custom teams/));
    expect(screen.getByRole('button', { name: 'Create match with custom teams' })).toBeEnabled();
  });

  it('shows a failure message and can check again', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const season = presetSeason();
    renderHarness({
      loadManifest: async () => {
        attempts += 1;
        return attempts === 1
          ? { ok: false, kind: 'unreachable', message: 'The team preset files could not be loaded. Check your connection and try again.' }
          : { ok: true, value: manifestFor(season) };
      },
      loadSeason: async () => ({ ok: true, value: season }),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    await user.click(screen.getByRole('button', { name: /Check again/ }));
    expect(await screen.findByRole('list', { name: 'Teams' })).toBeInTheDocument();
  });

  it('lists the teams with their details and enforces two different teams', async () => {
    const user = userEvent.setup();
    const season = presetSeason();
    renderHarness(depsFor(() => season));

    const teams = await screen.findByRole('list', { name: 'Teams' });
    const cardA = within(teams).getByRole('article', { name: 'Test FC A' });
    expect(cardA).toHaveTextContent('City A');
    expect(cardA).toHaveTextContent('Coach A');
    expect(cardA).toHaveTextContent('26 players');
    expect(cardA).toHaveTextContent('2026-27');

    const create = screen.getByRole('button', { name: 'Create match' });
    expect(create).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Choose Test FC A as the home team' }));
    // The home team cannot also be the away team.
    expect(screen.getByRole('button', { name: 'Choose Test FC A as the away team' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Choose Test FC A as the away team' }));
    expect(create).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Choose Test FC B as the away team' }));
    expect(create).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('Test FC A');
    expect(screen.getByRole('status')).toHaveTextContent('Test FC B');

    // Un-choosing the home team frees it for the other side.
    await user.click(screen.getByRole('button', { name: 'Remove Test FC A as the home team' }));
    expect(create).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Choose Test FC A as the away team' })).toBeEnabled();
  });

  it('creates a normal match, then the whole existing setup/board/events workflow works on the imported squad', async () => {
    const user = userEvent.setup();
    const season = presetSeason([presetTeam('a', { size: 30 }), presetTeam('b')]);
    const pristine = structuredClone(season);
    renderHarness(depsFor(() => season));

    await user.click(await screen.findByRole('button', { name: 'Choose Test FC A as the home team' }));
    await user.click(screen.getByRole('button', { name: 'Choose Test FC B as the away team' }));
    await user.click(screen.getByRole('button', { name: 'Create match' }));

    // It is an ordinary match, saved through the ordinary repository, with nobody pre-selected.
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Test FC A vs Test FC B');
    const [entry] = repo.list().entries;
    const saved = repo.load(entry.id);
    expect(saved.ok && saved.match.competition).toBe('Indian Super League 2026-27');
    expect(saved.ok && saved.match.home.players).toEqual([]);
    expect(saved.ok && saved.match.home.pool).toHaveLength(30);

    await user.click(screen.getByRole('button', { name: 'Setup' }));
    await user.click(screen.getByRole('button', { name: /^Test FC A/ }));
    expect(screen.getByLabelText('Home team setup')).toBeInTheDocument();
    expect(screen.getByLabelText('Team name')).toHaveValue('Test FC A');
    expect(screen.getByLabelText('Coach or manager')).toHaveValue('Coach A');
    const pool = screen.getByRole('region', { name: 'Squad pool' });
    expect(pool).toHaveTextContent('30 registered players not in the matchday squad');
    expect(screen.getByRole('complementary', { name: 'Team preset' })).toHaveTextContent('Changes here stay in this match');

    // Choose the XI from the pool.
    for (let i = 1; i <= 11; i++) {
      await user.click(screen.getByRole('button', { name: `Move Player A${i} to the starting XI` }));
    }
    expect(within(screen.getByRole('region', { name: 'Starting XI' })).getAllByRole('listitem')).toHaveLength(11);
    expect(screen.getByRole('region', { name: 'Squad pool' })).toHaveTextContent('19 registered players');

    // The 12th starter is refused with a reason; a substitute is fine.
    await user.click(screen.getByRole('button', { name: 'Move Player A12 to the starting XI' }));
    expect(within(screen.getByRole('region', { name: 'Squad pool' })).getByRole('alert')).toHaveTextContent('11');
    await user.click(screen.getByRole('button', { name: 'Move Player A12 to the substitutes' }));
    expect(within(screen.getByRole('region', { name: 'Substitutes' })).getAllByRole('listitem')).toHaveLength(1);

    // Imported players carry no "added by you"/"corrected" badges; hand-added ones are labelled.
    await user.type(screen.getByLabelText('Full name'), 'Local Trialist');
    await user.type(screen.getByLabelText('Shirt number'), '77');
    await user.click(screen.getByRole('button', { name: 'Add player' }));
    const subs = screen.getByRole('region', { name: 'Substitutes' });
    expect(within(subs).getByText('Local Trialist')).toBeInTheDocument();
    expect(within(subs).getByText('Added by you')).toBeInTheDocument();

    // Correct a pool player: it is marked as corrected, and keeps its imported identity.
    await user.click(screen.getByRole('button', { name: 'Edit Player A20' }));
    const nameField = within(screen.getByRole('region', { name: 'Squad pool' })).getByLabelText('Full name');
    await user.clear(nameField);
    await user.type(nameField, 'Player A20 (corrected)');
    await user.click(screen.getByRole('button', { name: 'Save player' }));
    const row = within(screen.getByRole('region', { name: 'Squad pool' })).getByText('Player A20 (corrected)').closest('li')!;
    expect(within(row).getByText('Corrected')).toBeInTheDocument();

    // The board shows the chosen XI on the pitch; the pool never appears there.
    await user.click(screen.getByRole('button', { name: 'Board' }));
    expect(within(board()).getAllByRole('button', { name: /^Test FC A:/ })).toHaveLength(11);

    // Editing the match never reaches the shared preset.
    expect(season).toEqual(pristine);
  });

  it('keeps matches independent of later preset updates, and survives leaving and reopening', async () => {
    const user = userEvent.setup();
    let season = presetSeason([presetTeam('a'), presetTeam('b')]);
    renderHarness(depsFor(() => season));

    await user.click(await screen.findByRole('button', { name: 'Choose Test FC A as the home team' }));
    await user.click(screen.getByRole('button', { name: 'Choose Test FC B as the away team' }));
    await user.click(screen.getByRole('button', { name: 'Create match' }));
    await screen.findByRole('heading', { level: 1 });
    await user.click(screen.getByRole('button', { name: 'Setup' }));
    await user.click(screen.getByRole('button', { name: /^Test FC A/ }));
    await user.click(screen.getByRole('button', { name: 'Move Player A1 to the starting XI' }));
    await user.click(screen.getByRole('button', { name: 'Back to all matches' }));

    // The league data is refreshed: a new coach and a transfer.
    season = presetSeason([
      presetTeam('a', { coach: 'Brand New Coach', players: presetTeam('a').players.slice(1) }),
      presetTeam('b'),
    ]);

    // Reopen the existing match: unchanged.
    const list = await screen.findByRole('list', { name: 'Saved matches' });
    await user.click(within(list).getByRole('button', { name: 'Open Test FC A vs Test FC B' }));
    await user.click(screen.getByRole('button', { name: 'Setup' }));
    await user.click(screen.getByRole('button', { name: /^Test FC A/ }));
    expect(screen.getByLabelText('Coach or manager')).toHaveValue('Coach A');
    expect(within(screen.getByRole('region', { name: 'Starting XI' })).getByText('Player A1')).toBeInTheDocument();

    // A new match made now gets the refreshed data.
    await user.click(screen.getByRole('button', { name: 'Back to all matches' }));
    await user.click(await screen.findByRole('button', { name: /Create from ISL teams/ }));
    await user.click(await screen.findByRole('button', { name: 'Choose Test FC A as the home team' }));
    await user.click(screen.getByRole('button', { name: 'Choose Test FC B as the away team' }));
    await user.click(screen.getByRole('button', { name: 'Create match' }));
    await screen.findByRole('heading', { level: 1 });
    await user.click(screen.getByRole('button', { name: 'Setup' }));
    await user.click(screen.getByRole('button', { name: /^Test FC A/ }));
    expect(screen.getByLabelText('Coach or manager')).toHaveValue('Brand New Coach');
    expect(screen.getByRole('region', { name: 'Squad pool' })).toHaveTextContent('25 registered players');
    expect(repo.list().entries).toHaveLength(2);
  });

  it('a hand-edited team name or coach is kept in the match and flagged, not reverted', async () => {
    const user = userEvent.setup();
    renderHarness(depsFor(() => presetSeason()));
    await user.click(await screen.findByRole('button', { name: 'Choose Test FC A as the home team' }));
    await user.click(screen.getByRole('button', { name: 'Choose Test FC B as the away team' }));
    await user.click(screen.getByRole('button', { name: 'Create match' }));
    await screen.findByRole('heading', { level: 1 });
    await user.click(screen.getByRole('button', { name: 'Setup' }));
    await user.click(screen.getByRole('button', { name: /^Test FC A/ }));
    const coach = screen.getByLabelText('Coach or manager');
    await user.clear(coach);
    await user.type(coach, 'Interim Coach');
    expect(screen.getByRole('complementary', { name: 'Team preset' })).toHaveTextContent('Coach edited');
    expect(screen.getByRole('complementary', { name: 'Team preset' })).toHaveTextContent('Test FC A');
  });
});

describe('Create match: custom teams', () => {
  it('still creates the empty match the old way, with no preset data', async () => {
    const user = userEvent.setup();
    renderHarness(depsFor(() => presetSeason()));
    await screen.findByRole('list', { name: 'Teams' });
    await user.click(screen.getByLabelText(/Custom teams/));
    await user.click(screen.getByRole('button', { name: 'Create match with custom teams' }));
    await screen.findByRole('heading', { level: 1 });

    const [entry] = repo.list().entries;
    const saved = repo.load(entry.id);
    expect(saved.ok && saved.match.home.pool).toBeUndefined();
    expect(saved.ok && saved.match.home.preset).toBeUndefined();
    expect(saved.ok && saved.match.home.name).toBe('');

    // And the manual roster workflow is intact.
    await user.click(screen.getByRole('button', { name: 'Setup' }));
    await user.click(screen.getByRole('button', { name: /^Home team/ }));
    expect(screen.queryByRole('region', { name: 'Squad pool' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Full name'), 'Home Keeper');
    await user.type(screen.getByLabelText('Shirt number'), '1');
    await user.click(screen.getByRole('button', { name: 'Add player' }));
    expect(within(screen.getByRole('region', { name: 'Starting XI' })).getByText('Home Keeper')).toBeInTheDocument();
  });
});

describe('images', () => {
  it('shows initials while an image is missing, blocked, loading or broken, and the picture once it loads', () => {
    const { rerender, container } = render(<PlayerAvatar url={null} name="Sunil Chhetri" />);
    expect(screen.getByText('SC')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();

    // A host that is not allow-listed is never requested.
    rerender(<PlayerAvatar url="https://tracker.example/pixel.png" name="Sunil Chhetri" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('SC')).toBeInTheDocument();

    // While loading the fallback is shown; once loaded it is replaced.
    rerender(<PlayerAvatar url="https://www.indiansuperleague.com/static-assets/images/players/19150.png" name="Sunil Chhetri" />);
    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(screen.getByText('SC')).toBeInTheDocument();
    fireEvent.load(img);
    expect(screen.queryByText('SC')).not.toBeInTheDocument();

    // A broken URL falls back and leaves no broken-image icon.
    rerender(<PlayerAvatar url="https://www.indiansuperleague.com/static-assets/images/players/404.png" name="Sunil Chhetri" />);
    const broken = container.querySelector('img')!;
    fireEvent.error(broken);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('SC')).toBeInTheDocument();
  });

  it('shows the club abbreviation when a logo is unavailable', () => {
    render(<TeamLogo url="https://www.indiansuperleague.com/static-assets/images/club/1.png" name="Bengaluru FC" abbreviation="BFC" />);
    fireEvent.error(document.querySelector('img')!);
    expect(screen.getByText('BFC')).toBeInTheDocument();
  });

  it('the setup stays usable when every image request fails', async () => {
    const user = userEvent.setup();
    const season = presetSeason();
    season.teams[0].abbreviation = 'TFA';
    renderHarness(depsFor(() => season));
    await user.click(await screen.findByRole('button', { name: 'Choose Test FC A as the home team' }));
    await user.click(screen.getByRole('button', { name: 'Choose Test FC B as the away team' }));
    expect(document.querySelectorAll('img').length).toBeGreaterThan(0);
    for (const img of Array.from(document.querySelectorAll('img'))) fireEvent.error(img);
    expect(document.querySelectorAll('img')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Create match' })).toBeEnabled();
    // The crest fallback (abbreviation) is shown in the card and in the chosen-teams bar.
    expect(within(screen.getByRole('article', { name: 'Test FC A' })).getAllByText('TFA').length).toBeGreaterThan(0);
  });
});

describe('presets with missing data', () => {
  it('shows what is missing instead of inventing it', async () => {
    const user = userEvent.setup();
    const sparse = presetTeam('a', {
      coach: null,
      players: [presetPlayer({ id: 'isl-player-1', name: 'Only Player', shirtNumber: null, position: null, headshotUrl: null, dateOfBirth: null, nationality: null })],
    });
    sparse.city = null;
    sparse.logoUrl = null;
    sparse.abbreviation = null;
    renderHarness(depsFor(() => presetSeason([sparse, presetTeam('b')])));
    const card = await screen.findByRole('article', { name: 'Test FC A' });
    expect(card).toHaveTextContent('Home cityNot available');
    expect(card).toHaveTextContent('Head coachNot available');
    expect(card).toHaveTextContent('1 player');

    await user.click(screen.getByRole('button', { name: 'Choose Test FC A as the home team' }));
    await user.click(screen.getByRole('button', { name: 'Choose Test FC B as the away team' }));
    await user.click(screen.getByRole('button', { name: 'Create match' }));
    await screen.findByRole('heading', { level: 1 });
    await user.click(screen.getByRole('button', { name: 'Setup' }));
    await user.click(screen.getByRole('button', { name: /^Test FC A/ }));
    expect(screen.getByLabelText('Coach or manager')).toHaveValue('');
    const pool = screen.getByRole('region', { name: 'Squad pool' });
    expect(within(pool).getByText('Number missing')).toBeInTheDocument();

    // The user can fill the gap: move the player in with a corrected number.
    await user.click(within(pool).getByRole('button', { name: 'Edit Only Player' }));
    const number = within(pool).getByLabelText('Shirt number');
    await user.clear(number);
    await user.type(number, '9');
    await user.click(screen.getByRole('button', { name: 'Save player' }));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Squad pool' })).toHaveTextContent('Only Player'));
  });
});

describe('match events and the board with imported players', () => {
  it('records a goal and a substitution with promoted preset players, and the pool stays out of every picker', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(Date.UTC(2026, 9, 12, 14, 0));
    const user = userEvent.setup({ delay: null });
    const season = presetSeason([presetTeam('a'), presetTeam('b')]);
    const match = buildMatchFromPresets(season, season.teams[0], season.teams[1], '2026-10-12T09:00:00.000Z', (p) => `${p}_${Math.random().toString(36).slice(2)}`);
    render(<MatchWorkspace initialMatch={match} initialView="setup" />);

    await user.click(screen.getByRole('button', { name: /^Test FC A/ }));
    for (const n of [1, 3, 9]) await user.click(screen.getByRole('button', { name: `Move Player A${n} to the starting XI` }));
    await user.click(screen.getByRole('button', { name: 'Move Player A12 to the substitutes' }));

    const nav = screen.getByRole('navigation', { name: 'Workspace' });
    await user.click(within(nav).getByRole('button', { name: 'Events' }));
    await user.click(within(screen.getByRole('region', { name: 'Scoreboard' })).getByRole('button', { name: 'Kick off' }));

    // Goal: only squad players (starters + substitute) are offered; the 22 pool players are not.
    await user.click(within(screen.getByRole('group', { name: 'Event type' })).getByRole('button', { name: 'Goal' }));
    const goalForm = screen.getByRole('form', { name: 'Record goal' });
    const scorer = within(goalForm).getByLabelText('Scorer');
    const options = within(scorer).getAllByRole('option').map((o) => o.textContent);
    expect(options.some((t) => t?.includes('Player A9'))).toBe(true);
    expect(options.some((t) => t?.includes('Player A20'))).toBe(false);
    await user.selectOptions(scorer, within(scorer).getByRole('option', { name: /Player A9/ }));
    await user.click(within(goalForm).getByRole('button', { name: 'Add to timeline' }));
    expect(screen.getByTestId('score').textContent).toBe('1–0');

    // Substitution: the bench player comes on for a starter and takes the slot.
    await user.click(within(screen.getByRole('group', { name: 'Event type' })).getByRole('button', { name: 'Substitution' }));
    const subForm = screen.getByRole('form', { name: 'Record substitution' });
    const off = within(subForm).getByLabelText('Player going off');
    const on = within(subForm).getByLabelText('Player coming on');
    expect(within(on).queryByRole('option', { name: /Player A20/ })).not.toBeInTheDocument();
    await user.selectOptions(off, within(off).getByRole('option', { name: /Player A3/ }));
    await user.selectOptions(on, within(on).getByRole('option', { name: /Player A12/ }));
    await user.click(within(subForm).getByRole('button', { name: 'Add to timeline' }));

    await user.click(within(nav).getByRole('button', { name: 'Board' }));
    const markers = within(board()).getAllByRole('button', { name: /^Test FC A:/ }).map((m) => m.getAttribute('aria-label'));
    // All 11 slots are drawn (empty ones included); the substitute now stands where Player A3 started.
    expect(markers).toHaveLength(11);
    expect(markers.filter((l) => l?.includes('Player A'))).toHaveLength(3);
    expect(markers.some((l) => l?.includes('Player A12'))).toBe(true);
    expect(markers.some((l) => l?.includes('Player A3'))).toBe(false);

    // A player named by an event cannot be returned to the pool.
    await user.click(within(nav).getByRole('button', { name: 'Setup' }));
    await user.click(screen.getByRole('button', { name: /^Test FC A/ }));
    await user.click(screen.getByRole('button', { name: 'Return Player A9 to the squad pool' }));
    expect(screen.getByRole('alert')).toHaveTextContent('appears in 1 match event');
    expect(within(screen.getByRole('region', { name: 'Starting XI' })).getByText('Player A9')).toBeInTheDocument();
    vi.useRealTimers();
  });
});
