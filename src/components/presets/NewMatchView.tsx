'use client';

import { useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { createId } from '@/domain/ids';
import { createMatch } from '@/domain/match';
import { buildMatchFromPresets, PresetSelectionError } from '@/domain/presets/toMatch';
import type { TeamSide } from '@/domain/types';
import { useRepository } from '@/persistence/RepositoryContext';
import { Button } from '@/components/ui/Button';
import { TeamLogo } from '@/components/ui/Avatars';
import { SelectField } from '@/components/ui/fields';
import { cn } from '@/lib/cn';
import { formatDay } from '@/lib/formatDay';
import { TeamCard } from './TeamCard';
import { defaultPresetDeps, entryKey, usePresetCatalog } from './usePresetCatalog';
import type { CatalogFailure, PresetDeps } from './usePresetCatalog';

type Mode = 'presets' | 'custom';

const IMPORT_COMMAND = 'npm run presets -- fetch --profiles --apply';

/**
 * `/new`: the two ways to start a match. Custom teams is exactly the existing blank-match flow;
 * ISL presets fills both teams from a snapshot of the chosen presets. Either way the result is an
 * ordinary saved match that opens in the normal workspace.
 */
export function NewMatchView({
  onCreated,
  onCancel,
  deps = defaultPresetDeps,
  now = () => new Date(),
}: {
  onCreated: (matchId: string) => void;
  onCancel: () => void;
  deps?: PresetDeps;
  now?: () => Date;
}) {
  const repository = useRepository();
  const [mode, setMode] = useState<Mode>('presets');
  const { catalog, season, selectedKey, select, retry } = usePresetCatalog(deps);
  const [homeId, setHomeId] = useState<string | null>(null);
  const [awayId, setAwayId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const teams = season.status === 'ready' ? season.value.teams : [];
  const home = teams.find((t) => t.id === homeId) ?? null;
  const away = teams.find((t) => t.id === awayId) ?? null;

  function choose(teamId: string, side: TeamSide) {
    setError(null);
    // The same team can't be both sides (the card disables the other button too).
    if (side === 'home') {
      if (awayId !== teamId) setHomeId(homeId === teamId ? null : teamId);
    } else if (homeId !== teamId) {
      setAwayId(awayId === teamId ? null : teamId);
    }
  }

  function save(match: ReturnType<typeof createMatch>) {
    const saved = repository.save(match);
    if (!saved.ok) setError(`The match could not be saved. ${saved.error.message}`);
    else onCreated(match.id);
  }

  function createFromPresets() {
    if (season.status !== 'ready' || !home || !away) return;
    try {
      save(buildMatchFromPresets(season.value, home, away, now().toISOString(), createId));
    } catch (e) {
      setError(e instanceof PresetSelectionError ? e.message : 'The match could not be created from these teams.');
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Create match</h1>
          <p className="text-xs text-zinc-400">Choose where the two teams come from. You pick the lineups next, exactly as usual.</p>
        </div>
        <Button variant="ghost" onClick={onCancel}>
          <ArrowLeft size={16} aria-hidden /> Back to matches
        </Button>
      </header>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">Team source</legend>
        {(
          [
            ['presets', 'ISL presets', 'Pick two Indian Super League clubs. Coach and squad are filled in for you.'],
            ['custom', 'Custom teams', 'Start with empty teams and enter names and players yourself.'],
          ] as const
        ).map(([value, label, hint]) => (
          <label
            key={value}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border p-4 has-[:focus-visible]:outline',
              mode === value ? 'border-emerald-600 bg-emerald-950/30' : 'border-zinc-800 bg-zinc-900/60',
            )}
          >
            <input type="radio" name="team-source" value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-1" />
            <span>
              <span className="block text-sm font-medium text-zinc-100">{label}</span>
              <span className="block text-xs text-zinc-400">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {error ? (
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-100">
          {error}
        </p>
      ) : null}

      {mode === 'custom' ? (
        <section aria-label="Custom teams" className="flex flex-col items-start gap-3 rounded-lg border border-zinc-800 p-4">
          <p className="text-sm text-zinc-300">Creates an empty match. Name the teams and add players in Setup.</p>
          <Button variant="primary" onClick={() => save(createMatch())}>
            Create match with custom teams
          </Button>
        </section>
      ) : (
        <section aria-label="ISL presets" className="flex flex-col gap-4">
          {catalog.status === 'loading' ? <p role="status" className="text-sm text-zinc-400">Loading team presets…</p> : null}

          {catalog.status === 'unavailable' ? <Unavailable failure={catalog} onRetry={retry} /> : null}

          {catalog.status === 'ready' ? (
            <>
              {catalog.manifest.seasons.length > 1 ? (
                <SelectField label="Season" value={selectedKey ?? ''} onChange={(e) => { setHomeId(null); setAwayId(null); select(e.target.value); }} wrapperClassName="max-w-xs">
                  {catalog.manifest.seasons.map((e) => (
                    <option key={entryKey(e)} value={entryKey(e)}>
                      {e.league.name} {e.season}
                    </option>
                  ))}
                </SelectField>
              ) : null}

              {season.status === 'loading' ? <p role="status" className="text-sm text-zinc-400">Loading teams…</p> : null}
              {season.status === 'error' ? <Unavailable failure={season} onRetry={retry} /> : null}

              {season.status === 'ready' && season.value.teams.length === 0 ? (
                <p className="rounded-md border border-dashed border-zinc-700 p-4 text-sm text-zinc-300">
                  This season file contains no teams. Re-run the import (<code className="text-xs">{IMPORT_COMMAND}</code>).
                </p>
              ) : null}

              {season.status === 'ready' && season.value.teams.length > 0 ? (
                <>
                  <p className="text-xs text-zinc-400">
                    {season.value.league.name} {season.value.season} · {season.value.teams.length} teams · data read{' '}
                    {formatDay(season.value.generatedAt)} from the official league site. Choose a home and an away team.
                  </p>
                  <ul aria-label="Teams" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {season.value.teams.map((team) => (
                      <li key={team.id}>
                        <TeamCard
                          team={team}
                          season={season.value.season}
                          chosenAs={team.id === homeId ? 'home' : team.id === awayId ? 'away' : null}
                          onChoose={(side) => choose(team.id, side)}
                        />
                      </li>
                    ))}
                  </ul>

                  <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-700 bg-zinc-900 p-3">
                    <div role="status" className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                      <Chosen label="Home" name={home?.displayName ?? null} logo={home?.logoUrl ?? null} abbreviation={home?.abbreviation ?? null} />
                      <Chosen label="Away" name={away?.displayName ?? null} logo={away?.logoUrl ?? null} abbreviation={away?.abbreviation ?? null} />
                    </div>
                    <Button variant="primary" disabled={!home || !away} onClick={createFromPresets}>
                      Create match
                    </Button>
                  </div>
                </>
              ) : null}
            </>
          ) : null}
        </section>
      )}
    </main>
  );
}

function Chosen({ label, name, logo, abbreviation }: { label: string; name: string | null; logo: string | null; abbreviation: string | null }) {
  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-zinc-400">{label}</span>
      {name ? (
        <>
          <TeamLogo url={logo} name={name} abbreviation={abbreviation} size="sm" />
          <span className="font-medium text-zinc-100">{name}</span>
        </>
      ) : (
        <span className="text-zinc-400">not chosen</span>
      )}
    </span>
  );
}

function Unavailable({ failure, onRetry }: { failure: CatalogFailure; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
      <p className="font-medium">{failure.kind === 'not-imported' ? 'No team presets have been imported yet.' : failure.message}</p>
      {failure.kind === 'not-imported' ? (
        <>
          <p>
            The ISL squads are not bundled with DizPitch; they are read from the league&rsquo;s website by an import command. From the project
            folder run:
          </p>
          <pre className="overflow-x-auto rounded bg-zinc-950 p-2 text-xs text-zinc-100">{IMPORT_COMMAND}</pre>
          <p>
            then reload this page. Without internet access you can supply the squads yourself as a CSV or JSON file; see{' '}
            <code className="text-xs">docs/TEAM_PRESETS.md</code>. Custom teams work without any of this.
          </p>
        </>
      ) : null}
      {failure.details && failure.details.length > 0 ? (
        <ul className="list-inside list-disc text-xs">
          {failure.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      ) : null}
      <div>
        <Button size="sm" onClick={onRetry}>
          <RefreshCw size={14} aria-hidden /> Check again
        </Button>
      </div>
    </div>
  );
}
