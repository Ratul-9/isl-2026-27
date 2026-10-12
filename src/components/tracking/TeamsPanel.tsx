import { ArrowLeftRight } from 'lucide-react';
import { setClusterSide } from '@/domain/tracking/edit';
import type { TeamClusterId, TeamSide, TrackingData } from '@/domain/types';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/fields';

/** The two shirt-colour groups found in the video, and which team each one is. Only the user decides. */
export function TeamsPanel({ tracking, teamNames, onChange }: { tracking: TrackingData; teamNames: { home: string; away: string }; onChange: (t: TrackingData) => void }) {
  const counts = (id: TeamClusterId) => tracking.tracks.filter((t) => t.team === id).length;
  const unknown = tracking.tracks.filter((t) => (t.objectType === 'player' || t.objectType === 'goalkeeper') && (t.team === 'unknown' || t.team === null)).length;
  const { sideOf } = tracking.teams;

  return (
    <section aria-label="Teams" className="flex flex-col gap-3">
      <p className="text-xs text-zinc-400">
        Players were grouped by shirt colour across all frames. Say which group is which team; until you do, markers show the shirt colour and the team is
        unknown.
      </p>
      {tracking.teams.clusters.length === 0 ? <p className="text-sm text-zinc-300">Too few players were tracked to group them by colour.</p> : null}
      {tracking.teams.clusters.map((c) => (
        <div key={c.id} className="flex items-end gap-3">
          <span aria-hidden className="mb-2 h-6 w-6 shrink-0 rounded-full border border-zinc-600" style={{ backgroundColor: c.colorHex }} />
          <SelectField
            label={`Colour group ${c.id} (${counts(c.id)} tracks)`}
            value={sideOf[c.id] ?? ''}
            onChange={(e) => onChange(setClusterSide(tracking, c.id, (e.target.value || null) as TeamSide | null))}
            wrapperClassName="flex-1"
          >
            <option value="">Not decided (unknown)</option>
            <option value="home">{teamNames.home} (home)</option>
            <option value="away">{teamNames.away} (away)</option>
          </SelectField>
        </div>
      ))}
      {tracking.teams.clusters.length === 2 && sideOf.A && sideOf.B ? (
        <Button size="sm" className="self-start" onClick={() => onChange(setClusterSide(tracking, 'A', sideOf.B))}>
          <ArrowLeftRight size={14} aria-hidden /> Swap teams
        </Button>
      ) : null}
      {unknown > 0 ? <p className="text-xs text-zinc-400">{unknown} player track(s) could not be grouped confidently; set their team in the Tracks tab.</p> : null}
    </section>
  );
}
