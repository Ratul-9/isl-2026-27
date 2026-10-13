import { Flag } from 'lucide-react';
import type { ResolvedStage } from '@/domain/scenario/build';
import type { OptionId, OutcomeId, TacticScenario } from '@/domain/scenario/types';
import { cn } from '@/lib/cn';

/** The stage the playhead is in, with a jump to the start of each. */
export function StageStrip({
  stages,
  currentId,
  onSeek,
}: {
  stages: readonly ResolvedStage[];
  currentId: string;
  onSeek: (t: number) => void;
}) {
  return (
    <ol aria-label="Stages" className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
      {stages.map((s) => {
        const current = s.id === currentId;
        return (
          <li key={s.id}>
            <button
              type="button"
              aria-current={current ? 'step' : undefined}
              disabled={!s.available}
              onClick={() => onSeek(s.start)}
              className={cn(
                'flex h-full w-full flex-col gap-0.5 rounded-md border px-2 py-2 text-left text-xs disabled:cursor-not-allowed disabled:opacity-50',
                current ? 'border-emerald-500 bg-emerald-950/60 text-white' : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-600',
              )}
            >
              <span className="font-semibold text-zinc-400">{s.label}</span>
              {/* Phones: five short chips keep the pitch near the top; the title is still announced and shown in the notes. */}
              <span className="sr-only sm:not-sr-only sm:font-medium sm:leading-snug">{s.title}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function StageNotes({ stage }: { stage: ResolvedStage }) {
  return (
    <section aria-label="Coaching notes" className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm">
      <h3 className="text-sm font-semibold">{stage.title}</h3>
      <p className="text-xs text-zinc-400">{stage.summary}</p>
      <ul className="list-inside list-disc space-y-1.5 text-zinc-200">
        {stage.coaching.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
      {stage.outcomeNote ? (
        <p className="rounded-md border border-sky-500/40 bg-sky-500/10 p-2 text-xs text-sky-100">{stage.outcomeNote}</p>
      ) : null}
    </section>
  );
}

export function OutcomePicker({
  scenario,
  value,
  onChange,
}: {
  scenario: TacticScenario;
  value: OutcomeId;
  onChange: (outcome: OutcomeId) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">{scenario.outcomeHeading}</legend>
      <div role="group" aria-label={scenario.outcomeHeading} className="grid grid-cols-2 gap-1 rounded-md bg-zinc-950 p-1">
        {Object.keys(scenario.outcomes).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={value === id}
            onClick={() => onChange(id)}
            className={cn(
              'rounded px-2 py-1.5 text-left text-xs font-medium',
              value === id ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-100',
            )}
          >
            {scenario.outcomes[id].tab}
          </button>
        ))}
      </div>
      <p className="text-xs text-zinc-300">{scenario.outcomes[value].summary}</p>
    </fieldset>
  );
}

export function OptionPicker({
  scenario,
  value,
  ready,
  onChoose,
  onClear,
  onJumpToDecision,
}: {
  scenario: TacticScenario;
  value: OptionId | null;
  /** Whether the playhead has reached the decision point. */
  ready: boolean;
  onChoose: (option: OptionId) => void;
  onClear: () => void;
  onJumpToDecision: () => void;
}) {
  const chosen = value ? scenario.options[value] : null;
  return (
    <section aria-label="Final options" className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <h3 className="text-sm font-semibold">{scenario.decisionPrompt}</h3>
      {ready ? (
        <p className="text-xs text-zinc-300">Choose one. Each starts from the same moment and none of them runs the others.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-300">
          <span>The options unlock at the decision point.</span>
          <button
            type="button"
            onClick={onJumpToDecision}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 font-medium hover:bg-zinc-800"
          >
            <Flag size={12} aria-hidden /> Go to the decision point
          </button>
        </div>
      )}
      <div role="group" aria-label="Final options" className="grid gap-1.5">
        {Object.keys(scenario.options).map((id) => (
          <button
            key={id}
            type="button"
            disabled={!ready}
            aria-pressed={value === id}
            onClick={() => onChoose(id)}
            className={cn(
              'rounded-md border px-3 py-2 text-left text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50',
              value === id ? 'border-emerald-500 bg-emerald-950/60 text-white' : 'border-zinc-700 bg-zinc-900 text-zinc-100 hover:border-zinc-500',
            )}
          >
            {scenario.options[id].title}
          </button>
        ))}
      </div>
      {chosen ? (
        <div className="flex flex-col gap-1.5 text-xs text-zinc-200" data-testid="option-detail">
          <p>{chosen.summary}</p>
          <p>
            <span className="font-semibold">Fits when:</span> {chosen.fitsWhen}
          </p>
          <p>
            <span className="font-semibold">Risk:</span> {chosen.risk}
          </p>
          <button
            type="button"
            onClick={onClear}
            className="self-start rounded-md border border-zinc-700 px-2 py-1 font-medium hover:bg-zinc-800"
          >
            Back to the decision point
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function CounterNotes({ scenario }: { scenario: TacticScenario }) {
  return (
    <details className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm">
      <summary className="cursor-pointer text-sm font-semibold">How defenders can neutralise it</summary>
      <ul className="mt-2 list-inside list-disc space-y-1.5 text-zinc-200">
        {scenario.counters.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
    </details>
  );
}
