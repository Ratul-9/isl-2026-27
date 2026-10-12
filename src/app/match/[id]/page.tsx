import { Suspense } from 'react';
import { MatchRoute } from '@/components/routes/MatchRoute';

// Route params are runtime data under Cache Components, so they are read inside <Suspense>.
export default function MatchPage({ params }: PageProps<'/match/[id]'>) {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-zinc-400">Loading match…</p>}>
      <MatchRoute params={params} />
    </Suspense>
  );
}
