'use client';

import { useState } from 'react';
import { Clock3, Pause, Play, Wrench } from 'lucide-react';
import { clockReadout, isRunning } from '@/domain/clock';
import { teamDisplayName } from '@/domain/match';
import { isPlayingPeriod, PERIOD_SHORT_LABELS } from '@/domain/time';
import { useMatch, useMatchActions, useMatchAnalysis } from '@/store/MatchContext';
import { Button } from '@/components/ui/Button';
import { ConfirmBar } from '@/components/ui/ConfirmBar';
import { cn } from '@/lib/cn';
import { periodSteps } from './clockActions';
import { ClockCorrection } from './ClockCorrection';
import { useNow } from './useNow';
import type { Period } from '@/domain/types';

/**
 * Scoreboard + clock controls. Mounted in the workspace shell (not inside a
 * view) so it is the same component instance on every tab: the clock keeps
 * showing the right time when the user changes sections.
 */
export function Scoreboard() {
  const match = useMatch();
  const actions = useMatchActions();
  const { score } = useMatchAnalysis();
  const now = useNow();
  const [correcting, setCorrecting] = useState(false);
  const [confirming, setConfirming] = useState<Period | null>(null);

  const readout = clockReadout(match.clock, now, match.durationMinutes);
  const running = isRunning(match.clock);
  const steps = periodSteps(match.clock);
  const live = isPlayingPeriod(match.clock.period);
  const homeName = teamDisplayName(match.home, 'home');
  const awayName = teamDisplayName(match.away, 'away');

  return (
    <section aria-label="Scoreboard" className="border-b border-zinc-800 bg-zinc-900/80 px-4 py-2">
      <div className="mx-auto flex w-full max-w-[110rem] flex-wrap items-center gap-x-6 gap-y-2">
        <div
          className="flex min-w-0 basis-full items-center justify-center gap-3 lg:flex-1 lg:basis-0 lg:justify-start"
          role="group"
          aria-label={`Score: ${homeName} ${score.home}, ${awayName} ${score.away}`}
        >
          <span className="min-w-0 flex-1 truncate text-right text-sm font-semibold lg:max-w-48 lg:flex-none">{homeName}</span>
          <span className="shrink-0 whitespace-nowrap rounded-md bg-zinc-950 px-3 py-1 text-2xl font-bold tabular-nums" data-testid="score">
            <span aria-hidden>{score.home}</span>
            <span aria-hidden className="px-1.5 text-zinc-400">–</span>
            <span aria-hidden>{score.away}</span>
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold lg:max-w-48 lg:flex-none">{awayName}</span>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={cn(
              'rounded px-2 py-0.5 text-xs font-semibold',
              live ? 'bg-emerald-600/20 text-emerald-300' : 'bg-zinc-800 text-zinc-300',
            )}
            title={readout.label}
          >
            {PERIOD_SHORT_LABELS[match.clock.period]} · {readout.label}
          </span>
          <span role="timer" aria-label={`Match clock ${readout.main}${readout.added ? ` ${readout.added}` : ''}`} className="flex items-baseline gap-1.5 font-mono">
            <span className="text-2xl font-semibold tabular-nums">{readout.main}</span>
            {readout.added ? <span className="text-sm text-amber-300 tabular-nums">{readout.added}</span> : null}
            {running ? <span aria-hidden className="ml-1 h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> : null}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {live ? (
            running ? (
              <Button size="sm" onClick={actions.pauseClock}>
                <Pause size={14} aria-hidden /> Pause
              </Button>
            ) : (
              <Button size="sm" variant="primary" onClick={actions.startClock}>
                <Play size={14} aria-hidden /> Resume
              </Button>
            )
          ) : null}
          {steps.map((step) => (
            <Button
              key={step.to}
              size="sm"
              variant={step.primary ? 'primary' : 'secondary'}
              onClick={() => (step.to === 'fullTime' || step.to === 'halfTime' ? setConfirming(step.to) : actions.advancePeriod(step.to))}
            >
              {step.primary && !live ? <Clock3 size={14} aria-hidden /> : null}
              {step.label}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setCorrecting((c) => !c)} aria-expanded={correcting}>
            <Wrench size={14} aria-hidden /> <span className="hidden sm:inline">Correct clock</span>
            <span className="sr-only sm:hidden">Correct clock</span>
          </Button>
        </div>
      </div>

      {confirming ? (
        <div className="mx-auto mt-2 w-full max-w-[110rem]">
          <ConfirmBar
            message={confirming === 'halfTime' ? 'End the first half now?' : 'End the match now?'}
            confirmLabel={confirming === 'halfTime' ? 'Half time' : 'Full time'}
            onConfirm={() => {
              actions.advancePeriod(confirming);
              setConfirming(null);
            }}
            onCancel={() => setConfirming(null)}
          />
        </div>
      ) : null}

      {correcting ? (
        <div className="mx-auto mt-2 w-full max-w-[110rem]">
          <ClockCorrection
            clock={match.clock}
            durationMinutes={match.durationMinutes}
            now={now}
            onApply={actions.correctClock}
            onClose={() => setCorrecting(false)}
          />
        </div>
      ) : null}
    </section>
  );
}
