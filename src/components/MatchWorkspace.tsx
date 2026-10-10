'use client';

import { useState } from 'react';
import type { SetupScope } from '@/domain/match';
import { MatchProvider } from '@/store/MatchContext';
import type { Match } from '@/domain/types';
import { BoardView } from './board/BoardView';
import { AppHeader } from './layout/AppHeader';
import type { WorkspaceView } from './layout/AppHeader';
import { SetupNav } from './layout/SetupNav';
import { MatchDetailsForm } from './setup/MatchDetailsForm';
import { OfficialsForm } from './setup/OfficialsForm';
import { SetupChecklist } from './setup/SetupChecklist';
import { TeamSetup } from './setup/TeamSetup';

function SetupView() {
  const [section, setSection] = useState<SetupScope>('match');
  return (
    <div className="mx-auto grid w-full max-w-7xl flex-1 gap-6 px-4 py-6 lg:grid-cols-[14rem_minmax(0,1fr)_18rem]">
      <SetupNav active={section} onSelect={setSection} />
      <main className="min-w-0">
        {section === 'match' ? <MatchDetailsForm /> : null}
        {section === 'officials' ? <OfficialsForm /> : null}
        {section === 'home' ? <TeamSetup side="home" /> : null}
        {section === 'away' ? <TeamSetup side="away" /> : null}
      </main>
      <div className="lg:sticky lg:top-6 lg:self-start">
        <SetupChecklist />
      </div>
    </div>
  );
}

function WorkspaceBody({ initialView }: { initialView: WorkspaceView }) {
  const [view, setView] = useState<WorkspaceView>(initialView);
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader view={view} onViewChange={setView} />
      {view === 'board' ? <BoardView onOpenSetup={() => setView('setup')} /> : <SetupView />}
    </div>
  );
}

export function MatchWorkspace({
  initialMatch,
  initialView = 'board',
}: {
  initialMatch?: Match;
  initialView?: WorkspaceView;
}) {
  return (
    <MatchProvider
      initialMatch={initialMatch}
      fallback={<p className="p-6 text-sm text-zinc-400">Loading match…</p>}
    >
      <WorkspaceBody initialView={initialView} />
    </MatchProvider>
  );
}
