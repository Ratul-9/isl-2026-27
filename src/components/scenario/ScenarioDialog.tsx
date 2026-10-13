'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { teamDisplayName } from '@/domain/match';
import { buildScenario, stageAt, visibleReplayAt } from '@/domain/scenario/build';
import type { Flank, OptionId, OutcomeId, TacticScenario } from '@/domain/scenario/types';
import type { TeamSide } from '@/domain/types';
import { useMatch } from '@/store/MatchContext';
import { Button } from '@/components/ui/Button';
import { ReplayPlayer } from '@/components/replay/ReplayPlayer';
import { useReplayClock } from '@/components/replay/useReplayClock';
import { cn } from '@/lib/cn';
import { CounterNotes, OptionPicker, OutcomePicker, StageNotes, StageStrip } from './ScenarioPanels';
import { ScenarioKey, ScenarioLegend, ScenarioUnderlay, SpacesNow } from './ScenarioUnderlay';

interface ScenarioDialogProps {
  scenario: TacticScenario;
  /** The side that plays Team A (attacks). */
  side: TeamSide;
  onClose: () => void;
}

/**
 * The animated scenario for a pattern, on the replay engine: the definition
 * is compiled to a replay (`buildScenario`), played by `ReplayPlayer` and the
 * existing clock, with highlights computed from positions at the current time.
 * It never writes to the match, and replaying calls no model.
 */
export function ScenarioDialog({ scenario, side, onClose }: ScenarioDialogProps) {
  const match = useMatch();
  const [outcome, setOutcome] = useState<OutcomeId>(scenario.defaultOutcome);
  const [option, setOption] = useState<OptionId | null>(null);
  const [flank, setFlank] = useState<Flank>('left');
  const closeRef = useRef<HTMLButtonElement>(null);

  const build = useMemo(
    () => buildScenario(scenario, { outcome, option }, { side, flank }),
    [scenario, outcome, option, side, flank],
  );
  const playback = useReplayClock(build.duration, build.stepMarks);
  const stage = stageAt(build, playback.time);
  const replay = visibleReplayAt(build, playback.time);
  const atDecision = playback.time >= build.decisionT - 1e-6;

  const teamNames = {
    home: teamDisplayName(match.home, 'home'),
    away: teamDisplayName(match.away, 'away'),
  };
  const attacking = teamNames[side];
  const defending = teamNames[side === 'home' ? 'away' : 'home'];

  // Keep the page behind from scrolling, and give focus back to whatever opened the dialog.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // The board's own shortcuts live on window; nothing typed in here should reach them.
    e.stopPropagation();
    if (e.key === 'Escape') onClose();
  }

  function chooseOutcome(next: OutcomeId) {
    if (next === outcome) return;
    setOutcome(next);
    setOption(null);
    playback.reset();
  }

  function chooseOption(next: OptionId) {
    setOption(next);
    // The branch is longer than the timeline rendered right now, so hand the clock its new length.
    playback.playFrom(build.decisionT, scenario.options[next].end);
  }

  function clearOption() {
    setOption(null);
    playback.seek(build.decisionT);
  }

  const dialog = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${scenario.title}: animated scenario`}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[100] overflow-y-auto bg-zinc-950 text-zinc-100"
    >
      <div className="mx-auto flex w-full max-w-[110rem] flex-col gap-3 px-4 py-4">
        <header className="flex flex-wrap items-center gap-2">
          <div className="mr-auto min-w-0">
            <h2 className="text-base font-semibold">
              {scenario.title} <span className="font-normal text-zinc-400">· animated scenario</span>
            </h2>
            <p className="text-xs text-zinc-300">
              Team A <span className="font-medium">{attacking}</span> attacks · Team B <span className="font-medium">{defending}</span>{' '}
              defends
            </p>
          </div>
          <div role="group" aria-label="Flank" className="flex gap-1 rounded-md bg-zinc-900 p-1">
            {(['left', 'right'] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={flank === f}
                onClick={() => setFlank(f)}
                className={cn(
                  'rounded px-3 py-1.5 text-xs font-medium capitalize',
                  flank === f ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-100',
                )}
              >
                {f} flank
              </button>
            ))}
          </div>
          <Button ref={closeRef} size="sm" onClick={onClose} aria-label="Close animated scenario">
            <X size={14} aria-hidden /> Close
          </Button>
        </header>

        <StageStrip stages={build.stages} currentId={stage.id} onSeek={(t) => playback.seek(t)} />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="flex min-w-0 flex-col gap-3">
            <ReplayPlayer
              replay={replay}
              playback={playback}
              teamNames={teamNames}
              badges={build.badges}
              labels={false}
              stepUnit="stage"
              underlay={(orientation) => <ScenarioUnderlay build={build} time={playback.time} orientation={orientation} />}
            />
            <ScenarioKey build={build} names={{ attack: attacking, defence: defending }} />
            <ScenarioLegend />
            <p className="text-xs text-zinc-400">{scenario.caveat}</p>
          </div>

          <aside aria-label="Scenario details" className="flex min-w-0 flex-col gap-3">
            <StageNotes stage={stage} />
            <SpacesNow build={build} time={playback.time} />
            <OutcomePicker scenario={scenario} value={outcome} onChange={chooseOutcome} />
            <OptionPicker
              scenario={scenario}
              value={option}
              ready={atDecision}
              onChoose={chooseOption}
              onClear={clearOption}
              onJumpToDecision={() => playback.seek(build.decisionT)}
            />
            <CounterNotes scenario={scenario} />
          </aside>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
