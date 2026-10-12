'use client';

import { useRouter } from 'next/navigation';
import { AppProviders } from '@/components/AppProviders';
import { NewMatchView } from '@/components/presets/NewMatchView';

function NewMatch() {
  const router = useRouter();
  return <NewMatchView onCreated={(id) => router.push(`/match/${encodeURIComponent(id)}`)} onCancel={() => router.push('/')} />;
}

/** `/new`: choose ISL presets or custom teams, then open the new match. */
export function NewMatchRoute() {
  return (
    <AppProviders>
      <NewMatch />
    </AppProviders>
  );
}
