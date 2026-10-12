'use client';

import { useState } from 'react';
import type { SetupScope } from '@/domain/match';
import { MatchProvider } from '@/store/MatchContext';
import { AutosaveProvider } from './persistence/AutosaveProvider';
import type { Match } from '@/domain/types';
import { BoardView } from './board/BoardView';
import { AppHeader } from './layout/AppHeader';
import type { WorkspaceView } from './layout/AppHeader';
import { SetupNav } from './layout/SetupNav';
import { EventsView } from './match/EventsView';
import { Scoreboard } from './match/Scoreboard';
import { ReplaysView } from './replay/ReplaysView';
import type { EventFormKind } from './match/eventFormModel';
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

function WorkspaceBody({ initialView, onBack }: { initialView: WorkspaceView; onBack?: () => void }) {
  const [view, setView] = useState<WorkspaceView>(initialView);
  // Set when another view asks the Events view to open a form straight away.
  const [requestedForm, setRequestedForm] = useState<EventFormKind | undefined>();

  const changeView = (next: WorkspaceView) => {
    setRequestedForm(undefined);
    setView(next);
  };

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header and scoreboard are shared by every view, so the clock never remounts.
          They stay pinned from tablet width up; on phones they scroll away to leave room. */}
      <div className="z-20 bg-zinc-950 md:sticky md:top-0">
        <AppHeader view={view} onViewChange={changeView} onBack={onBack} />
        <Scoreboard />
      </div>
      {view === 'board' ? (
        <BoardView
          onOpenSetup={() => changeView('setup')}
          onRecordSubstitution={() => {
            setRequestedForm('substitution');
            setView('events');
          }}
        />
      ) : null}
      {view === 'events' ? <EventsView initialKind={requestedForm} /> : null}
      {view === 'replays' ? <ReplaysView /> : null}
      {view === 'setup' ? <SetupView /> : null}
    </div>
  );
}

export function MatchWorkspace({
  initialMatch,
  initialView = 'board',
  onBack,
}: {
  initialMatch?: Match;
  initialView?: WorkspaceView;
  /** Shows a "Matches" button that returns to the library. */
  onBack?: () => void;
}) {
  return (
    <MatchProvider
      initialMatch={initialMatch}
      fallback={<p className="p-6 text-sm text-zinc-400">Loading match…</p>}
    >
      <AutosaveProvider>
        <WorkspaceBody initialView={initialView} onBack={onBack} />
      </AutosaveProvider>
    </MatchProvider>
  );
}
