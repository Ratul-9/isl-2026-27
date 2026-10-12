import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockBoardLayout } from '@/components/board/boardTestUtils';
import { LibraryView } from '@/components/library/LibraryView';
import { MatchLoader } from '@/components/routes/MatchRoute';
import { BENGALURU_GROUND_TRUTH, SC_DELHI_GROUND_TRUTH } from '@/domain/lineupImport/fixtures';
import type { PreparedImage } from '@/lineup-extraction/imageFile';
import { MemoryStore, StoreMatchRepository } from '@/persistence/repository';
import { WithRepository } from '@/persistence/testHelpers';
import { LineupImportView } from './LineupImportView';
import type { ImportDeps } from './LineupImportView';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

/** Fakes for preparation/extraction (see LineupImportView.test.tsx): this file proves the created match is a normal one. */
const deps: ImportDeps = {
  prepare: async (file) => ({ mediaType: 'image/png', data: 'AAAA', width: 1, height: 1, originalBytes: 1, uploadBytes: 1, name: file.name }) as PreparedImage,
  extract: async (image) => (image.name === 'home.png' ? BENGALURU_GROUND_TRUTH : SC_DELHI_GROUND_TRUTH),
  status: async () => ({ configured: true, provider: 'gemini', model: 'gemini-3.8-flash' }),
};

type Screen = { at: 'import' } | { at: 'library' } | { at: 'match'; id: string };

function Harness() {
  const [screenState, setScreen] = useState<Screen>({ at: 'import' });
  if (screenState.at === 'import') {
    return <LineupImportView deps={deps} onCreated={(id) => setScreen({ at: 'match', id })} onCancel={() => setScreen({ at: 'library' })} />;
  }
  if (screenState.at === 'match') {
    return <MatchLoader key={screenState.id} id={screenState.id} onBack={() => setScreen({ at: 'library' })} />;
  }
  return <LibraryView onOpen={(id) => setScreen({ at: 'match', id })} onImportImages={() => setScreen({ at: 'import' })} />;
}

let repo: StoreMatchRepository;
beforeEach(() => {
  repo = new StoreMatchRepository(new MemoryStore(), true);
  mockBoardLayout();
  let n = 0;
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => `blob:p-${n++}`, revokeObjectURL: () => {} });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const png = (name: string) => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' });

describe('image-created match', () => {
  it('opens in the normal workspace and stays editable after leaving and reopening', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const user = userEvent.setup({ delay: null });
    render(
      <WithRepository repository={repo}>
        <Harness />
      </WithRepository>,
    );

    await user.upload(screen.getByLabelText('Home team lineup image'), png('home.png'));
    await user.upload(screen.getByLabelText('Away team lineup image'), png('away.png'));
    await waitFor(() => expect(screen.getByRole('button', { name: /Read lineups/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Read lineups/ }));
    await screen.findByRole('region', { name: 'Home team review' });
    await user.click(screen.getByLabelText(/I have checked both lineups/));
    await user.click(screen.getByRole('button', { name: 'Create match' }));

    // The same workspace a manually created match opens in.
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Bengaluru FC vs Sporting Club Delhi');
    expect(screen.getByRole('region', { name: 'Scoreboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Setup' })).toBeInTheDocument();

    // Edit like any other match, leave, and reopen from the library.
    await user.click(screen.getByRole('button', { name: 'Setup' }));
    await user.type(screen.getByLabelText('Competition or tournament'), 'Super Cup');
    await user.click(screen.getByRole('button', { name: 'Back to all matches' }));

    const list = screen.getByRole('list', { name: 'Saved matches' });
    await user.click(within(list).getByRole('button', { name: 'Open Bengaluru FC vs Sporting Club Delhi' }));
    await user.click(screen.getByRole('button', { name: 'Setup' }));
    expect(screen.getByLabelText('Competition or tournament')).toHaveValue('Super Cup');
  });
});
