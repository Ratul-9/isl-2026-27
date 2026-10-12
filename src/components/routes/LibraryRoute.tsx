'use client';

import { useRouter } from 'next/navigation';
import { AppProviders } from '@/components/AppProviders';
import { LibraryView } from '@/components/library/LibraryView';
import { ReloadOnReveal } from '@/components/ui/ReloadOnReveal';

function Library() {
  const router = useRouter();
  // Re-read storage whenever the library is shown again (see ReloadOnReveal).
  return (
    <ReloadOnReveal>
      <LibraryView
        onOpen={(id) => router.push(`/match/${encodeURIComponent(id)}`)}
        onImportImages={() => router.push('/import')}
        onCreateFromPresets={() => router.push('/new')}
      />
    </ReloadOnReveal>
  );
}

/**
 * `/`: the match library. The client-only gate (storage, random ids) lives here,
 * below the page segment, so the page itself still renders during prerender.
 */
export function LibraryRoute() {
  return (
    <AppProviders>
      <Library />
    </AppProviders>
  );
}
