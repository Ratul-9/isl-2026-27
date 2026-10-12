import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BENGALURU_GROUND_TRUTH, SC_DELHI_GROUND_TRUTH } from '@/domain/lineupImport/fixtures';
import type { ExtractedLineup } from '@/domain/lineupImport/types';
import { ExtractionClientError } from '@/lineup-extraction/client';
import { ImageProblem } from '@/lineup-extraction/imageFile';
import type { PreparedImage } from '@/lineup-extraction/imageFile';
import { MemoryStore, StoreMatchRepository } from '@/persistence/repository';
import { FlakyRepository, WithRepository } from '@/persistence/testHelpers';
import { LineupImportView } from './LineupImportView';
import type { ImportDeps } from './LineupImportView';

/**
 * These tests drive the real UI with the image preparation and the extraction request replaced by fakes
 * (jsdom has no canvas and there is no server). They prove the import FLOW, not that any model reads images
 * correctly: the "extracted" data is the hand-transcribed ground truth in `fixtures.ts`.
 */

let repo: FlakyRepository;
const READS: Record<string, ExtractedLineup> = {
  'bengaluru.png': BENGALURU_GROUND_TRUTH,
  'delhi.png': SC_DELHI_GROUND_TRUTH,
};

function image(name: string): PreparedImage {
  return { mediaType: 'image/png', data: 'AAAA', width: 10, height: 10, originalBytes: 3, uploadBytes: 3, name };
}

function makeDeps(overrides: Partial<ImportDeps> = {}): ImportDeps & { extract: ReturnType<typeof vi.fn> } {
  const extract = vi.fn(async (img: PreparedImage) => {
    const lineup = READS[img.name];
    if (!lineup) throw new Error('no fixture');
    return lineup;
  });
  return {
    prepare: async (file) => image(file.name),
    extract,
    status: async () => ({ configured: true, provider: 'gemini', model: 'gemini-3.8-flash' }),
    ...overrides,
  } as ImportDeps & { extract: ReturnType<typeof vi.fn> };
}

function setup(deps: ImportDeps) {
  const onCreated = vi.fn();
  const onCancel = vi.fn();
  const user = userEvent.setup();
  render(
    <WithRepository repository={repo}>
      <LineupImportView onCreated={onCreated} onCancel={onCancel} deps={deps} />
    </WithRepository>,
  );
  return { user, onCreated, onCancel };
}

const png = (name: string) => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' });
const homeInput = () => screen.getByLabelText('Home team lineup image') as HTMLInputElement;
const awayInput = () => screen.getByLabelText('Away team lineup image') as HTMLInputElement;
const review = (label: 'Home team' | 'Away team') => within(screen.getByRole('region', { name: `${label} review` }));

async function uploadBoth(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(homeInput(), png('bengaluru.png'));
  await user.upload(awayInput(), png('delhi.png'));
}

async function reachReview(user: ReturnType<typeof userEvent.setup>) {
  await uploadBoth(user);
  await waitFor(() => expect(screen.getByRole('button', { name: /Read lineups/ })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: /Read lineups/ }));
  await screen.findByRole('region', { name: 'Home team review' });
}

beforeEach(() => {
  repo = new FlakyRepository(new StoreMatchRepository(new MemoryStore(), true, () => new Date(Date.UTC(2026, 9, 10, 12))));
  let n = 0;
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => `blob:preview-${n++}`, revokeObjectURL: () => {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('provider status', () => {
  it('explains how to enable reading and offers manual entry when the provider is not configured', async () => {
    const deps = makeDeps({
      status: async () => ({ configured: false, provider: 'gemini', model: 'gemini-3.8-flash', reason: 'GEMINI_API_KEY is not set.' }),
    });
    const { user } = setup(deps);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Automatic image reading is not set up');
    expect(alert).toHaveTextContent('GEMINI_API_KEY');
    expect(screen.getByRole('button', { name: /Read lineups/ })).toBeDisabled();

    // The mock is never silently substituted: nothing is "read", the user enters teams by hand.
    await user.click(within(alert).getByRole('button', { name: 'Enter lineups manually' }));
    expect(deps.extract).not.toHaveBeenCalled();
    expect(await screen.findByRole('region', { name: 'Home team review' })).toBeInTheDocument();
    expect(review('Home team').getByText('entered manually')).toBeInTheDocument();
  });

  it('reports an unreachable server and still allows manual entry', async () => {
    const { user } = setup(makeDeps({ status: async () => null }));
    expect(await screen.findByText(/server could not be reached/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Enter lineups manually' }));
    expect(await screen.findByRole('region', { name: 'Away team review' })).toBeInTheDocument();
  });
});

describe('upload step', () => {
  it('shows previews, swaps home and away, and replaces an image', async () => {
    const { user } = setup(makeDeps());
    await uploadBoth(user);
    expect(screen.getByAltText('Preview of the home team lineup image')).toBeInTheDocument();
    expect(screen.getByText('bengaluru.png')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Swap home and away/ }));
    const home = screen.getByRole('region', { name: 'Home team starting lineup' });
    expect(within(home).getByText('delhi.png')).toBeInTheDocument();

    await user.click(within(home).getByRole('button', { name: 'Replace image' }));
    await user.upload(homeInput(), png('bengaluru.png'));
    await waitFor(() => expect(within(home).getByText('bengaluru.png')).toBeInTheDocument());
  });

  it('rejects a file that is not a usable image and lets the user choose another', async () => {
    const deps = makeDeps({
      prepare: async (file) => {
        if (file.name === 'notes.png') throw new ImageProblem('unsupported_type', '“notes.png” is not a PNG or JPEG image.');
        return image(file.name);
      },
    });
    const { user } = setup(deps);
    await user.upload(homeInput(), png('notes.png'));
    expect(await screen.findByText(/not a PNG or JPEG image/)).toBeInTheDocument();
    await user.upload(homeInput(), png('bengaluru.png'));
    await waitFor(() => expect(screen.queryByText(/not a PNG or JPEG image/)).not.toBeInTheDocument());
  });

  it('requires both images before reading', async () => {
    const { user } = setup(makeDeps());
    await screen.findByText(/Image reading is available/);
    expect(screen.getByRole('button', { name: /Read lineups/ })).toBeDisabled();
    await user.upload(homeInput(), png('bengaluru.png'));
    await waitFor(() => expect(screen.getByAltText('Preview of the home team lineup image')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Read lineups/ })).toBeDisabled();
  });
});

describe('reading and review', () => {
  it('presents both extracted teams for review without creating anything', async () => {
    const { user, onCreated } = setup(makeDeps());
    await reachReview(user);

    expect(review('Home team').getByLabelText('Team name')).toHaveValue('Bengaluru FC');
    expect(review('Home team').getByLabelText('Head coach')).toHaveValue('JOSE MUNOZ ZOYO');
    expect(review('Home team').getByLabelText('Formation')).toHaveValue('4-3-3');
    expect(review('Away team').getByLabelText('Formation')).toHaveValue('5-3-2');
    expect(review('Home team').getByText(/Starting XI/)).toHaveTextContent('11 of 11');
    expect(review('Home team').getByText(/Substitutes/)).toHaveTextContent('9');
    expect(review('Home team').getByLabelText('Name of GURPREET')).toBeInTheDocument();
    // Nothing is saved before explicit confirmation.
    expect(repo.saves).toBe(0);
    expect(onCreated).not.toHaveBeenCalled();
    // The confirmation control exists and is not yet ticked.
    expect(screen.getByRole('button', { name: 'Create match' })).toBeDisabled();
  });

  it('keeps going after a failed read: retry succeeds and the review opens', async () => {
    let first = true;
    const deps = makeDeps({
      extract: vi.fn(async (img: PreparedImage) => {
        if (img.name === 'delhi.png' && first) {
          first = false;
          throw new ExtractionClientError({ code: 'provider_unavailable', message: 'The reading service is unavailable.', retryable: true });
        }
        return READS[img.name];
      }),
    });
    const { user } = setup(deps);
    await uploadBoth(user);
    await waitFor(() => expect(screen.getByRole('button', { name: /Read lineups/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Read lineups/ }));

    const failed = await screen.findByText(/The reading service is unavailable/);
    expect(failed).toBeInTheDocument();
    // The home side was read; its result is not thrown away.
    expect(screen.getAllByText(/Lineup read/)).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getAllByText(/Lineup read/)).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: 'Review lineups' }));
    expect(await screen.findByRole('region', { name: 'Away team review' })).toBeInTheDocument();
  });

  it('lets the user enter one failed team manually and continue', async () => {
    const deps = makeDeps({
      extract: vi.fn(async (img: PreparedImage) => {
        if (img.name === 'delhi.png') throw new ExtractionClientError({ code: 'unreadable', message: 'No lineup could be found in this image.', retryable: false });
        return BENGALURU_GROUND_TRUTH;
      }),
    });
    const { user } = setup(deps);
    await uploadBoth(user);
    await waitFor(() => expect(screen.getByRole('button', { name: /Read lineups/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Read lineups/ }));
    await screen.findByText(/No lineup could be found/);
    await user.click(screen.getByRole('button', { name: 'Enter this team manually' }));
    await user.click(screen.getByRole('button', { name: 'Review lineups' }));
    expect(await screen.findByRole('region', { name: 'Away team review' })).toBeInTheDocument();
    expect(review('Away team').getByText('entered manually')).toBeInTheDocument();
    expect(review('Away team').getByText(/Starting XI/)).toHaveTextContent('0 of 11');
  });

  it('flags a missing formation instead of guessing it', async () => {
    const noFormation: ExtractedLineup = { ...BENGALURU_GROUND_TRUTH, formation: null };
    const { user } = setup(makeDeps({ extract: vi.fn(async (img: PreparedImage) => (img.name === 'bengaluru.png' ? noFormation : SC_DELHI_GROUND_TRUTH)) }));
    await reachReview(user);
    expect(review('Home team').getByText(/No formation text was found/)).toBeInTheDocument();
  });
});

describe('editing and blocking problems', () => {
  it('blocks creation on a duplicate shirt number until it is resolved', async () => {
    const { user } = setup(makeDeps());
    await reachReview(user);

    const number = review('Home team').getByLabelText('Shirt number of SANA');
    await user.clear(number);
    await user.type(number, '1'); // GURPREET already wears 1
    expect(review('Home team').getByLabelText('Home team issues')).toHaveTextContent('shirt number 1 is used by GURPREET and SANA');
    expect(screen.getByText(/must be fixed before the match can be created/)).toBeInTheDocument();
    expect(screen.getByLabelText(/I have checked both lineups/)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create match' })).toBeDisabled();

    await user.clear(number);
    await user.type(number, '4');
    await waitFor(() => expect(screen.queryByText(/must be fixed before the match can be created/)).not.toBeInTheDocument());
    expect(screen.getByLabelText(/I have checked both lineups/)).toBeEnabled();
  });

  it('moves a player between the XI and the substitutes and keeps them in the review', async () => {
    const { user } = setup(makeDeps());
    await reachReview(user);
    await user.click(review('Home team').getByRole('button', { name: 'To subs: SURESH' }));
    expect(review('Home team').getByText(/Starting XI/)).toHaveTextContent('10 of 11');
    expect(review('Home team').getByText(/Substitutes/)).toHaveTextContent('10');
    expect(review('Home team').getByLabelText('Name of SURESH')).toBeInTheDocument();
    // An incomplete XI is reported (never silently padded).
    expect(review('Home team').getByLabelText('Home team issues')).toHaveTextContent('only 10 of 11 starters');
  });

  it('tidies ALL-CAPS names on request only', async () => {
    const { user } = setup(makeDeps());
    await reachReview(user);
    expect(review('Home team').getByLabelText('Name of GURPREET')).toBeInTheDocument();
    await user.click(review('Home team').getAllByRole('button', { name: /Tidy capitalisation/ })[0]);
    expect(review('Home team').getByLabelText('Name of Gurpreet')).toBeInTheDocument();
    expect(review('Home team').getByLabelText('Name of Martínez')).toBeInTheDocument();
    expect(review('Home team').getByLabelText('Head coach')).toHaveValue('Jose Munoz Zoyo');
  });
});

describe('creating the match', () => {
  async function confirmAndCreate(user: ReturnType<typeof userEvent.setup>) {
    // Some warnings may be present (e.g. team names read from crests); acknowledging is the explicit confirmation.
    await user.click(screen.getByLabelText(/I have checked both lineups/));
    await user.click(screen.getByRole('button', { name: 'Create match' }));
  }

  it('saves a normal, editable match built through the existing model and opens it', async () => {
    const { user, onCreated } = setup(makeDeps());
    await reachReview(user);

    await user.type(screen.getByLabelText('Competition or tournament'), 'Indian Super League');
    await user.type(screen.getByLabelText('Venue or stadium'), 'Sree Kanteerava Stadium');
    await user.type(screen.getByLabelText('Match date'), '2026-08-10');
    await user.type(screen.getByLabelText('Referee'), 'A. Referee');
    await confirmAndCreate(user);

    expect(onCreated).toHaveBeenCalledTimes(1);
    const id = onCreated.mock.calls[0][0] as string;
    const loaded = repo.load(id);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const { match } = loaded;

    expect(match.competition).toBe('Indian Super League');
    expect(match.venue).toBe('Sree Kanteerava Stadium');
    expect(match.date).toBe('2026-08-10');
    expect(match.officials.referee).toBe('A. Referee');
    expect(match.officials.assistant1).toBe(''); // unavailable metadata stays blank
    expect(match.events).toEqual([]); // no events are extracted
    expect(match.home.name).toBe('Bengaluru FC');
    expect(match.away.name).toBe('Sporting Club Delhi');
    expect(match.home.formation).toEqual({ kind: 'preset', id: '4-3-3' });
    expect(match.away.formation).toEqual({ kind: 'preset', id: '5-3-2' });
    for (const team of [match.home, match.away]) {
      expect(team.slots).toHaveLength(11);
      expect(team.slots.every((s) => s.playerId !== null)).toBe(true);
    }
    expect(match.home.bench).toHaveLength(9);
    // The goalkeeper stands in the goalkeeper's slot; the away side is on the other end of the pitch.
    const homeGk = match.home.players.find((p) => p.id === match.home.slots[0].playerId);
    expect(homeGk?.name).toBe('GURPREET');
    expect(match.home.slots[0].x).toBeLessThan(0.5);
    expect(match.away.slots[0].x).toBeGreaterThan(0.5);
  });

  it('stays on the review and reports a failed save without navigating', async () => {
    repo.failWith = { kind: 'quota', message: 'Browser storage is full.' } as NonNullable<typeof repo.failWith>;
    const { user, onCreated } = setup(makeDeps());
    await reachReview(user);
    await confirmAndCreate(user);
    expect(await screen.findByText(/could not be saved/)).toHaveTextContent('Browser storage is full.');
    expect(onCreated).not.toHaveBeenCalled();
    // The review is intact, so the user can retry.
    expect(review('Home team').getByLabelText('Team name')).toHaveValue('Bengaluru FC');
  });

  it('warns when both teams have the same name', async () => {
    const { user } = setup(makeDeps({ extract: vi.fn(async () => BENGALURU_GROUND_TRUTH) }));
    await reachReview(user);
    expect(screen.getByText(/Both teams have the same name/)).toBeInTheDocument();
  });
});
