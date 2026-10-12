'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppProviders } from '@/components/AppProviders';
import { useRepository } from '@/persistence/RepositoryContext';
import { MatchWorkspace } from '@/components/MatchWorkspace';
import { Button } from '@/components/ui/Button';
import { ReloadOnReveal } from '@/components/ui/ReloadOnReveal';

function MatchById({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // Keyed by id so opening another match starts fresh (new history, new state).
  // ReloadOnReveal: a hidden workspace must not come back with a stale copy of the match.
  return (
    <ReloadOnReveal>
      <MatchLoader key={id} id={decodeURIComponent(id)} />
    </ReloadOnReveal>
  );
}

/**
 * `/match/[id]`: loads one match from the library and opens the workspace.
 * The client-only gate sits below the page segment so the page renders during prerender.
 */
export function MatchRoute({ params }: { params: Promise<{ id: string }> }) {
  return (
    <AppProviders>
      <MatchById params={params} />
    </AppProviders>
  );
}

export function MatchLoader({ id, onBack }: { id: string; onBack?: () => void }) {
  const repository = useRepository();
  const router = useRouter();
  const [result] = useState(() => repository.load(id));
  const [dismissed, setDismissed] = useState(false);
  const back = onBack ?? (() => router.push('/'));

  if (!result.ok) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-16">
        <h1 className="text-lg font-semibold">
          {result.reason === 'missing' ? 'Match not found' : 'This match could not be opened'}
        </h1>
        <ul className="list-inside list-disc text-sm text-zinc-300">
          {result.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
        <p className="text-sm text-zinc-400">
          {result.reason === 'missing'
            ? 'It may have been deleted, or it was saved in a different browser.'
            : 'Its saved data is damaged or from a newer version of DizPitch. You can remove it from the library.'}
        </p>
        <div>
          <Button variant="primary" onClick={back}>
            Back to all matches
          </Button>
        </div>
      </main>
    );
  }

  return (
    <>
      {result.warnings.length > 0 && !dismissed ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-100">
          <span>This match opened with issues: {result.warnings.join(' ')}</span>
          <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
            Dismiss
          </Button>
        </div>
      ) : null}
      <MatchWorkspace initialMatch={result.match} onBack={back} />
    </>
  );
}
