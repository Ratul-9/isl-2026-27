import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMatch } from '@/domain/match';
import { parseMatchJson, serializeDocument } from '@/persistence/document';
import { KEY_PREFIX, MemoryStore, StoreMatchRepository } from '@/persistence/repository';
import { FlakyRepository, WithRepository } from '@/persistence/testHelpers';
import { richMatch } from '@/persistence/testFixtures';
import { readFileText } from '@/lib/download';
import { LibraryView } from './LibraryView';

let store: MemoryStore;
let repo: FlakyRepository;
let tick = 0;
const downloads: Blob[] = [];

beforeEach(() => {
  store = new MemoryStore();
  tick = 0;
  repo = new FlakyRepository(new StoreMatchRepository(store, true, () => new Date(Date.UTC(2026, 9, 10, 12, tick++))));
  downloads.length = 0;
  vi.stubGlobal('URL', { ...URL, createObjectURL: (b: Blob) => (downloads.push(b), 'blob:x'), revokeObjectURL: () => {} });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderLibrary(notice: string | null = null) {
  const onOpen = vi.fn();
  const onImportImages = vi.fn();
  const user = userEvent.setup();
  render(
    <WithRepository repository={repo} notice={notice}>
      <LibraryView onOpen={onOpen} onImportImages={onImportImages} />
    </WithRepository>,
  );
  return { user, onOpen, onImportImages };
}

const card = (title: string) => screen.getByRole('article', { name: title });
const importInput = () => screen.getByLabelText('Import match file') as HTMLInputElement;
const jsonFile = (text: string, name = 'match.json') => new File([text], name, { type: 'application/json' });

describe('library', () => {
  it('starts empty and creates a new saved match', async () => {
    const { user, onOpen } = renderLibrary();
    expect(screen.getByRole('region', { name: 'No matches' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create match manually' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    const id = onOpen.mock.calls[0][0] as string;
    expect(repo.load(id)).toMatchObject({ ok: true });
  });

  it('offers both ways to create a match and does not create anything for the image route itself', async () => {
    const { user, onOpen, onImportImages } = renderLibrary();
    expect(screen.getByRole('button', { name: 'Create match manually' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create from lineup images' }));
    expect(onImportImages).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    expect(repo.list().entries).toHaveLength(0);
    expect(repo.saves).toBe(0);
  });

  it('lists matches newest first with their details', () => {
    repo.save({ ...richMatch(), id: 'old', name: 'Old tie' });
    repo.save({ ...createMatch(), id: 'new' });
    renderLibrary();
    const items = within(screen.getByRole('list', { name: 'Saved matches' })).getAllByRole('article');
    expect(items.map((a) => a.getAttribute('aria-label'))).toEqual(['Untitled match', 'Old tie']);
    expect(within(card('Old tie')).getByText('Home FC vs Away FC')).toBeInTheDocument();
    expect(within(card('Old tie')).getByText(/2026-10-10 · 19:30 · In progress · Saved/)).toBeInTheDocument();
  });

  it('opens a match', async () => {
    repo.save({ ...richMatch(), id: 'm1', name: 'Cup tie' });
    const { user, onOpen } = renderLibrary();
    await user.click(screen.getByRole('button', { name: 'Open Cup tie' }));
    expect(onOpen).toHaveBeenCalledWith('m1');
  });

  it('renames a match and persists the new name', async () => {
    repo.save({ ...richMatch(), id: 'm1', name: 'Cup tie' });
    const { user } = renderLibrary();
    await user.click(screen.getByRole('button', { name: 'Rename Cup tie' }));
    const field = screen.getByLabelText('Match name');
    await user.clear(field);
    await user.type(field, 'Final{Enter}');
    expect(screen.getByRole('article', { name: 'Final' })).toBeInTheDocument();
    const loaded = repo.load('m1');
    expect(loaded.ok && loaded.match.name).toBe('Final');
  });

  it('duplicates a match with new ids, leaving the original untouched and pausing a live clock', async () => {
    const original = { ...richMatch(), id: 'm1', name: 'Cup tie' };
    repo.save(original);
    const { user } = renderLibrary();
    await user.click(screen.getByRole('button', { name: 'Duplicate Cup tie' }));

    const listing = repo.list();
    expect(listing.entries).toHaveLength(2);
    const copyEntry = listing.entries.find((e) => e.id !== 'm1')!;
    expect(copyEntry.title).toBe('Cup tie (copy)');
    const copy = repo.load(copyEntry.id);
    const orig = repo.load('m1');
    expect(copy.ok && orig.ok).toBe(true);
    if (copy.ok && orig.ok) {
      expect(copy.match.home.id).not.toBe(orig.match.home.id);
      expect(copy.match.events).toHaveLength(orig.match.events.length);
      expect(copy.match.events[1].id).not.toBe(orig.match.events[1].id);
      expect(copy.match.clock.runningSinceEpochMs).toBeNull();
      expect(orig.match.clock.runningSinceEpochMs).toBe(original.clock.runningSinceEpochMs);
      expect(orig.match).toEqual(original);
    }
    expect(screen.getByRole('status')).toHaveTextContent('Created “Cup tie (copy)”.');
  });

  it('deletes only after confirmation', async () => {
    repo.save({ ...richMatch(), id: 'm1', name: 'Cup tie' });
    const { user } = renderLibrary();
    await user.click(screen.getByRole('button', { name: 'Delete Cup tie' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(repo.list().entries).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Delete Cup tie' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete match' }));
    expect(repo.list().entries).toHaveLength(0);
    expect(screen.getByRole('region', { name: 'No matches' })).toBeInTheDocument();
  });

  it('exports a match as JSON that imports back identically', async () => {
    const original = { ...richMatch(), id: 'm1', name: 'Cup tie' };
    repo.save(original);
    const { user } = renderLibrary();
    await user.click(screen.getByRole('button', { name: 'Export Cup tie as JSON' }));
    expect(downloads).toHaveLength(1);
    const parsed = parseMatchJson(await readFileText(downloads[0]));
    expect(parsed.ok && parsed.match).toEqual(original);
  });
});

describe('import', () => {
  it('imports a valid file as a new library entry and offers to open it', async () => {
    const { user, onOpen } = renderLibrary();
    const m = { ...richMatch(), id: 'imported-1', name: 'From file' };
    await user.upload(importInput(), jsonFile(serializeDocument(m, new Date())));
    expect(await screen.findByRole('article', { name: 'From file' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Imported “From file”.');
    await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalledWith('imported-1');
    const loaded = repo.load('imported-1');
    expect(loaded.ok && loaded.match).toEqual(m);
  });

  it('never overwrites an existing match: a colliding id becomes a separate copy', async () => {
    const existing = { ...richMatch(), id: 'dup', name: 'Original' };
    repo.save(existing);
    const { user } = renderLibrary();
    await user.upload(importInput(), jsonFile(serializeDocument({ ...existing, venue: 'Other ground' }, new Date())));
    expect(await screen.findByRole('article', { name: 'Original (imported)' })).toBeInTheDocument();
    const original = repo.load('dup');
    expect(original.ok && original.match.venue).toBe('Fatorda');
    expect(repo.list().entries).toHaveLength(2);
  });

  it('shows what is wrong with an invalid file and saves nothing', async () => {
    const { user } = renderLibrary();
    const broken = JSON.parse(serializeDocument(richMatch(), new Date()));
    broken.match.home.players[0].shirtNumber = 500;
    await user.upload(importInput(), jsonFile(JSON.stringify(broken), 'broken.json'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('“broken.json” could not be imported.');
    expect(alert).toHaveTextContent('home.players[0].shirtNumber');
    expect(repo.list().entries).toHaveLength(0);
  });

  it('rejects non-JSON and foreign JSON files', async () => {
    const { user } = renderLibrary();
    await user.upload(importInput(), jsonFile('not json at all', 'notes.json'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid JSON/);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    await user.upload(importInput(), jsonFile('{"hello":"world"}', 'other.json'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not a DizPitch match export/);
  });

  it('warns about repaired or inconsistent data but still imports', async () => {
    const { user } = renderLibrary();
    const doc = JSON.parse(serializeDocument({ ...richMatch(), id: 'w' }, new Date()));
    doc.match.events.push({ id: 'bad', type: 'substitution', teamId: doc.match.home.id, outPlayerId: 'home-s1', inPlayerId: 'home-s2', period: 'secondHalf', matchTimeMs: 3_000_000 });
    await user.upload(importInput(), jsonFile(JSON.stringify(doc)));
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/1 event is inconsistent/);
    expect(repo.load('w')).toMatchObject({ ok: true });
  });
});

describe('failures', () => {
  it('lists unreadable entries separately and lets the user delete them', async () => {
    repo.save({ ...createMatch(), id: 'ok', name: 'Fine' });
    store.setItem(`${KEY_PREFIX}damaged`, '{"truncated":');
    const { user } = renderLibrary();
    expect(screen.getByRole('article', { name: 'Fine' })).toBeInTheDocument();
    const section = screen.getByRole('region', { name: 'Unreadable matches' });
    expect(within(section).getByText(/1 saved match could not be read/)).toBeInTheDocument();
    expect(within(section).getByText(/not valid JSON/)).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: /delete entry/i }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    expect(screen.queryByRole('region', { name: 'Unreadable matches' })).not.toBeInTheDocument();
    expect(store.getItem(`${KEY_PREFIX}damaged`)).toBeNull();
  });

  it('reports a storage failure when creating and does not navigate', async () => {
    repo.failWith = { kind: 'quota', message: 'Browser storage is full.' };
    const { user, onOpen } = renderLibrary();
    await user.click(screen.getByRole('button', { name: 'Create match manually' }));
    expect(screen.getByRole('alert')).toHaveTextContent('could not be saved. Browser storage is full.');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('explains when browser storage is unavailable', () => {
    renderLibrary('Browser storage is blocked. Matches will be kept only until you close or reload this tab.');
    expect(screen.getByRole('status')).toHaveTextContent(/only until you close or reload/);
  });
});
