'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowLeftRight, ScanText } from 'lucide-react';
import { createId } from '@/domain/ids';
import {
  addPlayer,
  assignSlot,
  draftFromExtraction,
  emptyDraftTeam,
  moveToStarters,
  moveToSubstitutes,
  removePlayer,
  setFormation,
  tidyNames,
  updatePlayer,
  validateDraftTeam,
} from '@/domain/lineupImport/draft';
import { buildMatchFromDrafts, EMPTY_METADATA } from '@/domain/lineupImport/toMatch';
import type { DraftIssue, DraftTeam, MatchMetadata } from '@/domain/lineupImport/types';
import { ExtractionClientError, fetchProviderStatus, requestExtraction } from '@/lineup-extraction/client';
import { ImageProblem, prepareImage } from '@/lineup-extraction/imageFile';
import type { PreparedImage } from '@/lineup-extraction/imageFile';
import type { ExtractionFailure, ProviderStatus } from '@/lineup-extraction/schema';
import type { ExtractedLineup } from '@/domain/lineupImport/types';
import { useRepository } from '@/persistence/RepositoryContext';
import { Button } from '@/components/ui/Button';
import { ImageSlot } from './ImageSlot';
import type { ReadState } from './ImageSlot';
import { MetadataForm } from './MetadataForm';
import { TeamReview } from './TeamReview';
import type { TeamActions } from './TeamReview';

type Side = 'home' | 'away';

interface SideState {
  file: File | null;
  previewUrl: string | null;
  image: PreparedImage | null;
  preparing: boolean;
  fileError: string | null;
  read: ReadState;
  draft: DraftTeam | null;
  manual: boolean;
}

const EMPTY_SIDE: SideState = {
  file: null,
  previewUrl: null,
  image: null,
  preparing: false,
  fileError: null,
  read: { status: 'idle' },
  draft: null,
  manual: false,
};

const LABEL: Record<Side, string> = { home: 'Home team', away: 'Away team' };

/** Replaceable collaborators, so the flow can be tested without a browser canvas or a server. */
export interface ImportDeps {
  prepare: (file: File) => Promise<PreparedImage>;
  extract: (image: PreparedImage) => Promise<ExtractedLineup>;
  status: () => Promise<ProviderStatus | null>;
}

const defaultDeps: ImportDeps = {
  prepare: (file) => prepareImage(file),
  extract: (image) => requestExtraction(image),
  status: () => fetchProviderStatus(),
};

const failureOf = (error: unknown): ExtractionFailure =>
  error instanceof ExtractionClientError
    ? error.failure
    : { code: 'unexpected', message: 'Reading the image failed unexpectedly.', retryable: true };

export function LineupImportView({
  onCreated,
  onCancel,
  deps = defaultDeps,
}: {
  onCreated: (matchId: string) => void;
  onCancel: () => void;
  deps?: ImportDeps;
}) {
  const repository = useRepository();
  const [sides, setSides] = useState<Record<Side, SideState>>({ home: EMPTY_SIDE, away: EMPTY_SIDE });
  const [step, setStep] = useState<'upload' | 'review'>('upload');
  const [provider, setProvider] = useState<ProviderStatus | null | 'loading'>('loading');
  const [metadata, setMetadata] = useState<MatchMetadata>(EMPTY_METADATA);
  const [confirmed, setConfirmed] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const keyCounter = useRef(0);
  const makeKey = () => `d${++keyCounter.current}`;
  // Latest side states for async callbacks that must not close over stale data.
  const sidesRef = useRef(sides);
  useEffect(() => {
    sidesRef.current = sides;
  }, [sides]);

  useEffect(() => {
    let alive = true;
    deps.status().then((s) => alive && setProvider(s));
    return () => {
      alive = false;
    };
  }, [deps]);

  // Preview URLs are revoked when replaced or on leaving.
  useEffect(
    () => () => {
      for (const s of Object.values(sidesRef.current)) if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
    },
    [],
  );

  const patch = (side: Side, change: Partial<SideState>) => setSides((s) => ({ ...s, [side]: { ...s[side], ...change } }));
  const patchDraft = (side: Side, edit: (t: DraftTeam) => DraftTeam) =>
    setSides((s) => (s[side].draft ? { ...s, [side]: { ...s[side], draft: edit(s[side].draft as DraftTeam) } } : s));

  async function chooseFile(side: Side, file: File) {
    const old = sidesRef.current[side].previewUrl;
    if (old) URL.revokeObjectURL(old);
    patch(side, { ...EMPTY_SIDE, file, previewUrl: URL.createObjectURL(file), preparing: true });
    try {
      const image = await deps.prepare(file);
      patch(side, { image, preparing: false });
    } catch (error) {
      patch(side, {
        preparing: false,
        fileError: error instanceof ImageProblem ? error.message : `“${file.name}” could not be used.`,
      });
    }
  }

  function clearSide(side: Side) {
    const url = sidesRef.current[side].previewUrl;
    if (url) URL.revokeObjectURL(url);
    patch(side, EMPTY_SIDE);
  }

  /** Reads one side's image; returns whether it succeeded. */
  async function readSide(side: Side): Promise<boolean> {
    const image = sidesRef.current[side].image;
    if (!image) return false;
    patch(side, { read: { status: 'reading' }, manual: false });
    try {
      const lineup = await deps.extract(image);
      patch(side, { read: { status: 'ok' }, draft: draftFromExtraction(lineup, makeKey), manual: false });
      return true;
    } catch (error) {
      patch(side, { read: { status: 'failed', failure: failureOf(error) } });
      return false;
    }
  }

  async function readAll() {
    const results = await Promise.all((['home', 'away'] as const).map((side) => (sidesRef.current[side].draft && sidesRef.current[side].manual ? true : readSide(side))));
    if (results.every(Boolean)) setStep('review');
  }

  function enterManually(side: Side) {
    patch(side, { draft: emptyDraftTeam(), manual: true, read: { status: 'idle' } });
  }

  function swap() {
    setSides((s) => ({ home: s.away, away: s.home }));
  }

  const providerReady = provider !== 'loading' && provider?.configured === true;
  const readable = (['home', 'away'] as const).every((s) => sides[s].image !== null || sides[s].manual);
  const anyReading = (['home', 'away'] as const).some((s) => sides[s].read.status === 'reading' || sides[s].preparing);
  const bothDrafts = sides.home.draft !== null && sides.away.draft !== null;

  // ---- review -----------------------------------------------------------------
  const issues: Record<Side, DraftIssue[]> = {
    home: sides.home.draft ? validateDraftTeam(sides.home.draft, 'Home team') : [],
    away: sides.away.draft ? validateDraftTeam(sides.away.draft, 'Away team') : [],
  };
  const shared: DraftIssue[] = [];
  if (sides.home.draft && sides.away.draft && sides.home.draft.teamName.trim() !== '' && sides.home.draft.teamName.trim().toLowerCase() === sides.away.draft.teamName.trim().toLowerCase()) {
    shared.push({ severity: 'warning', code: 'same-team-name', message: 'Both teams have the same name. Did the same image get used twice?' });
  }
  const all = [...issues.home, ...issues.away, ...shared];
  const errorCount = all.filter((i) => i.severity === 'error').length;
  const warningCount = all.length - errorCount;

  function actionsFor(side: Side): TeamActions {
    return {
      patchTeam: (p) => patchDraft(side, (t) => ({ ...t, ...p })),
      setFormation: (id) => patchDraft(side, (t) => setFormation(t, id)),
      updatePlayer: (key, p) => patchDraft(side, (t) => updatePlayer(t, key, p)),
      assignSlot: (key, slot) => patchDraft(side, (t) => assignSlot(t, key, slot)),
      toSubstitutes: (key) => patchDraft(side, (t) => moveToSubstitutes(t, key)),
      toStarters: (key) => patchDraft(side, (t) => moveToStarters(t, key)),
      add: (role) => patchDraft(side, (t) => addPlayer(t, role, makeKey())),
      remove: (key) => patchDraft(side, (t) => removePlayer(t, key)),
      tidyNames: () => patchDraft(side, tidyNames),
      reread: sides[side].image ? () => void readSide(side) : undefined,
    };
  }

  function create() {
    setCreateError(null);
    const { home, away } = sides;
    if (!home.draft || !away.draft) return;
    try {
      const match = buildMatchFromDrafts(home.draft, away.draft, metadata, createId);
      const saved = repository.save(match);
      if (!saved.ok) {
        setCreateError(`The match could not be saved. ${saved.error.message}`);
        return;
      }
      onCreated(match.id);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'The match could not be created.');
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel} aria-label="Back to all matches">
            <ArrowLeft size={14} aria-hidden /> Matches
          </Button>
          <h1 className="text-lg font-semibold tracking-tight">Create match from lineup images</h1>
        </div>
        <ol className="flex gap-3 text-xs text-zinc-400" aria-label="Steps">
          <li aria-current={step === 'upload' ? 'step' : undefined} className={step === 'upload' ? 'font-semibold text-white' : ''}>
            1 · Images
          </li>
          <li aria-current={step === 'review' ? 'step' : undefined} className={step === 'review' ? 'font-semibold text-white' : ''}>
            2 · Review &amp; confirm
          </li>
        </ol>
      </header>

      {step === 'upload' ? (
        <>
          <ProviderNotice provider={provider} onManual={() => { enterManually('home'); enterManually('away'); setStep('review'); }} />

          <p className="rounded-md border border-zinc-800 bg-zinc-900/60 p-3 text-xs leading-relaxed text-zinc-300">
            <strong className="text-zinc-100">How your images are used:</strong> each image is sent from the DizPitch server to Google&apos;s Gemini API to be
            read, and uses your Gemini API quota or credit (a few thousand tokens per image; see Google&apos;s pricing). DizPitch does not keep the images, and they
            are not used as the pitch. With a free (unpaid) Gemini key, Google may use what you send to improve its products and people may review it; a paid key
            is not used that way. You can skip reading and enter lineups by hand instead.
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            {(['home', 'away'] as const).map((side) => (
              <ImageSlot
                key={side}
                label={LABEL[side]}
                fileName={sides[side].file?.name ?? null}
                previewUrl={sides[side].previewUrl}
                fileError={sides[side].fileError}
                preparing={sides[side].preparing}
                read={sides[side].read}
                manual={sides[side].manual}
                onFile={(f) => void chooseFile(side, f)}
                onClear={() => clearSide(side)}
                onRetryRead={() => void readSide(side)}
                onEnterManually={() => enterManually(side)}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={swap} disabled={anyReading}>
              <ArrowLeftRight size={16} aria-hidden /> Swap home and away
            </Button>
            <Button variant="primary" onClick={() => void readAll()} disabled={!providerReady || !readable || anyReading || (sides.home.manual && sides.away.manual)}>
              <ScanText size={16} aria-hidden /> Read lineups
            </Button>
            <Button onClick={() => setStep('review')} disabled={!bothDrafts || anyReading}>
              Review lineups
            </Button>
          </div>
          <p className="text-xs text-zinc-400">
            Check that the left tile is the <strong>home</strong> team. If the images are in the wrong tiles, use “Swap home and away”.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm text-zinc-300">
            Check everything below against the images. Highlighted items are uncertain or missing. Nothing is saved until you confirm at the bottom.
          </p>
          {(['home', 'away'] as const).map((side) =>
            sides[side].draft ? (
              <TeamReview
                key={side}
                side={side}
                label={LABEL[side]}
                team={sides[side].draft as DraftTeam}
                issues={issues[side]}
                sourceName={sides[side].manual ? null : sides[side].file?.name ?? null}
                sourceUrl={sides[side].previewUrl}
                actions={actionsFor(side)}
              />
            ) : null,
          )}
          <MetadataForm value={metadata} onChange={setMetadata} />

          <section aria-label="Confirm lineups" className="flex flex-col gap-3 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
            <h2 className="text-sm font-semibold">Confirm</h2>
            {errorCount > 0 ? (
              <p role="alert" className="text-sm text-red-200">
                {errorCount} problem{errorCount === 1 ? '' : 's'} must be fixed before the match can be created.
              </p>
            ) : null}
            {shared.map((i) => (
              <p key={i.code} className="text-xs text-amber-200">
                {i.message}
              </p>
            ))}
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-emerald-500"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={errorCount > 0}
              />
              <span>
                I have checked both lineups
                {warningCount > 0 ? ` and the ${warningCount} highlighted item${warningCount === 1 ? '' : 's'}` : ''}, and they are correct.
              </span>
            </label>
            {createError ? (
              <p role="alert" className="text-sm text-red-200">
                {createError}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={create} disabled={errorCount > 0 || !confirmed}>
                Create match
              </Button>
              <Button onClick={() => setStep('upload')}>Back to images</Button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function ProviderNotice({ provider, onManual }: { provider: ProviderStatus | null | 'loading'; onManual: () => void }) {
  if (provider === 'loading') return <p className="text-xs text-zinc-400" role="status">Checking whether image reading is available…</p>;
  if (provider === null) {
    return (
      <div role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
        <p>The DizPitch server could not be reached, so images cannot be read automatically.</p>
        <p className="mt-1 text-xs">Image reading needs the server to be running (<code>npm run dev</code> or <code>npm start</code>). You can still enter both lineups by hand.</p>
        <Button size="sm" className="mt-2" onClick={onManual}>
          Enter lineups manually
        </Button>
      </div>
    );
  }
  if (!provider.configured) {
    return (
      <div role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
        <p className="font-semibold">Automatic image reading is not set up.</p>
        <p className="mt-1 text-xs">{provider.reason}</p>
        <ol className="mt-2 list-inside list-decimal text-xs">
          <li>
            Create a Gemini API key in Google AI Studio (aistudio.google.com/apikey) and put it in a file named <code>.env.local</code> in the
            project folder: <code>GEMINI_API_KEY=your-key</code>
          </li>
          <li>
            Restart the DizPitch server (the key is read on the server only; it is never sent to the browser).
          </li>
        </ol>
        <p className="mt-2 text-xs">Until then you can enter both lineups by hand in the same review screen.</p>
        <Button size="sm" className="mt-2" onClick={onManual}>
          Enter lineups manually
        </Button>
      </div>
    );
  }
  return (
    <p className="text-xs text-emerald-300" role="status">
      Image reading is available (model: {provider.model}).
    </p>
  );
}
