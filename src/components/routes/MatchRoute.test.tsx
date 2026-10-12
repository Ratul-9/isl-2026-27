import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryView } from '@/components/library/LibraryView';
import { mockBoardLayout } from '@/components/board/boardTestUtils';
import { serializeDocument } from '@/persistence/document';
import { KEY_PREFIX, MemoryStore, StoreMatchRepository } from '@/persistence/repository';
import { WithRepository } from '@/persistence/testHelpers';
import { richMatch } from '@/persistence/testFixtures';
import { MatchLoader } from './MatchRoute';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

let store: MemoryStore;
let repo: StoreMatchRepository;
beforeEach(() => {
  store = new MemoryStore();
  repo = new StoreMatchRepository(store, true);
  mockBoardLayout();
});
afterEach(() => vi.restoreAllMocks());

function Harness() {
  const [openId, setOpenId] = useState<string | null>(null);
  return openId ? <MatchLoader key={openId} id={openId} onBack={() => setOpenId(null)} /> : <LibraryView onOpen={setOpenId} />;
}

describe('MatchLoader', () => {
  it('opens a stored match in the workspace', () => {
    repo.save({ ...richMatch(), id: 'm1' });
    render(
      <WithRepository repository={repo}>
        <MatchLoader id="m1" onBack={() => {}} />
      </WithRepository>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Cup tie');
    expect(screen.getByRole('region', { name: 'Scoreboard' })).toBeInTheDocument();
  });

  it('explains a missing match and goes back', async () => {
    const onBack = vi.fn();
    render(
      <WithRepository repository={repo}>
        <MatchLoader id="nope" onBack={onBack} />
      </WithRepository>,
    );
    expect(screen.getByRole('heading', { name: 'Match not found' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Back to all matches' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('explains a damaged match instead of crashing', () => {
    store.setItem(`${KEY_PREFIX}bad`, serializeDocument(richMatch(), new Date()).replace('"status": "inProgress"', '"status": "weird"'));
    render(
      <WithRepository repository={repo}>
        <MatchLoader id="bad" onBack={() => {}} />
      </WithRepository>,
    );
    expect(screen.getByRole('heading', { name: 'This match could not be opened' })).toBeInTheDocument();
    expect(screen.getByText(/status/)).toBeInTheDocument();
  });

  it('shows load warnings and lets the user dismiss them', async () => {
    const doc = JSON.parse(serializeDocument(richMatch(), new Date()));
    doc.match.events.push({ id: 'bad', type: 'substitution', teamId: doc.match.home.id, outPlayerId: 'home-s1', inPlayerId: 'home-s2', period: 'secondHalf', matchTimeMs: 3_000_000 });
    store.setItem(`${KEY_PREFIX}warn`, JSON.stringify({ ...doc, match: { ...doc.match, id: 'warn' } }));
    render(
      <WithRepository repository={repo}>
        <MatchLoader id="warn" onBack={() => {}} />
      </WithRepository>,
    );
    const note = screen.getByText(/opened with issues/);
    expect(note).toHaveTextContent('1 event is inconsistent');
    await userEvent.setup().click(within(note.parentElement as HTMLElement).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/opened with issues/)).not.toBeInTheDocument();
  });
});

describe('library → workspace → library', () => {
  it('creates a match, edits it, returns to the library and reopens it with the edits', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const user = userEvent.setup({ delay: null });
    render(
      <WithRepository repository={repo}>
        <Harness />
      </WithRepository>,
    );
    await user.click(screen.getByRole('button', { name: 'Create match manually' }));
    await user.click(screen.getByRole('button', { name: 'Setup' }));
    await user.type(screen.getByLabelText('Competition or tournament'), 'Super Cup');
    await user.click(screen.getByRole('button', { name: 'Back to all matches' }));

    // Back in the library: saved immediately on leaving, no waiting.
    const card = screen.getByRole('list', { name: 'Saved matches' });
    expect(within(card).getByText('Untitled match')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Open Untitled match' }));
    await user.click(screen.getByRole('button', { name: 'Setup' }));
    expect(screen.getByLabelText('Competition or tournament')).toHaveValue('Super Cup');
    vi.useRealTimers();
  });
});
