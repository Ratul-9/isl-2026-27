'use client';

import { useRouter } from 'next/navigation';
import { AppProviders } from '@/components/AppProviders';
import { LineupImportView } from '@/components/lineupImport/LineupImportView';

function Import() {
  const router = useRouter();
  return <LineupImportView onCreated={(id) => router.push(`/match/${encodeURIComponent(id)}`)} onCancel={() => router.push('/')} />;
}

/** `/import`: create a match from two lineup images. */
export function ImportRoute() {
  return (
    <AppProviders>
      <Import />
    </AppProviders>
  );
}
