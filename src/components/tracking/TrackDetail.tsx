import { useState } from 'react';
import { Crosshair, Eye, EyeOff, Merge, Undo2, X } from 'lucide-react';
import { assignPlayer, clearEdit, mergeTracks, rejectObservation, updateTrack } from '@/domain/tracking/edit';
import { observationIndex } from '@/domain/tracking/overlay';
import { trackSide } from '@/domain/tracking/sample';
import type { Player, TeamSide, TrackingData, TrackingTrack } from '@/domain/types';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/fields';
import { trackKindLabel, trackLabel } from './trackStyle';
import type { TrackNames } from './trackStyle';

export interface TrackDetailProps {
  tracking: TrackingData;
  track: TrackingTrack;
  frame: number;
  names: TrackNames;
  squads: { home: Player[]; away: Player[] };
  placing: boolean;
  onPlacing: (on: boolean) => void;
  onChange: (t: TrackingData) => void;
  now: () => string;
}

/** One track: team, squad player, hide, merge, and corrections at the current frame. */
export function TrackDetail({ tracking, track, frame, names, squads, placing, onPlacing, onChange, now }: TrackDetailProps) {
  const [mergeWith, setMergeWith] = useState('');
  const [mergeError, setMergeError] = useState<string | null>(null);
  const side = trackSide(tracking, track);
  const person = track.objectType !== 'ball';
  const squad = side ? squads[side] : [];
  const index = observationIndex(track, frame);
  const edit = track.edits[String(frame)];
  const candidates = tracking.tracks.filter((t) => t.id !== track.id && (t.objectType === 'ball') === !person);
  const label = trackLabel(tracking, track, names);

  const observed = index >= 0 ? (track.obs.source[index] === 'interpolated' ? 'interpolated (ball gap bridged by the service)' : 'detected') : null;
  const status = edit?.kind === 'rejected' ? 'marked incorrect by you' : edit?.kind === 'position' ? 'placed by you' : observed ? observed : 'not observed';

  return (
    <div aria-label={`Selected: ${label.description}`} role="group" className="flex flex-col gap-3 rounded-md border border-zinc-700 bg-zinc-900 p-3">
      <div>
        <h3 className="text-sm font-semibold">{label.description}</h3>
        <p className="text-xs text-zinc-400">
          {trackKindLabel(track)} · seen in {track.obs.frame.length} frames
          {track.mergedFrom.length > 0 ? ` · joined from tracks ${track.mergedFrom.map((n) => `#${n}`).join(', ')}` : ''}
        </p>
      </div>
      {person && track.objectType !== 'referee' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <SelectField label="Team" value={track.side ?? ''} onChange={(e) => onChange(updateTrack(tracking, track.id, { side: (e.target.value || null) as TeamSide | null }))}>
            <option value="">From shirt colour ({track.team && track.team !== 'unknown' && tracking.teams.sideOf[track.team] ? names.teams[tracking.teams.sideOf[track.team]!] : 'unknown'})</option>
            <option value="home">{names.teams.home}</option>
            <option value="away">{names.teams.away}</option>
          </SelectField>
          <SelectField
            label="Squad player"
            value={track.playerId ?? ''}
            disabled={!side}
            hint={side ? undefined : 'Set the team first.'}
            onChange={(e) => onChange(assignPlayer(tracking, track.id, e.target.value || null))}
          >
            <option value="">Not linked</option>
            {[...squad].sort((a, b) => a.shirtNumber - b.shirtNumber).map((p) => (
              <option key={p.id} value={p.id}>
                {p.shirtNumber} {p.name}
              </option>
            ))}
          </SelectField>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-zinc-800 pt-2">
        <p className="text-xs text-zinc-300">
          At frame {frame + 1}: <strong>{status}</strong>
        </p>
        <div className="flex flex-wrap gap-2">
          {index >= 0 && edit?.kind !== 'rejected' ? (
            <Button size="sm" onClick={() => onChange(rejectObservation(tracking, track.id, frame, now()))} title="The box is on the wrong person or object at this frame">
              <X size={14} aria-hidden /> Mark incorrect here
            </Button>
          ) : null}
          <Button size="sm" variant={placing ? 'primary' : 'secondary'} aria-pressed={placing} onClick={() => onPlacing(!placing)} title="Then click the pitch, or drag the marker">
            <Crosshair size={14} aria-hidden /> {placing ? 'Click the pitch to place…' : index >= 0 ? 'Move on pitch here' : 'Add missing position here'}
          </Button>
          {edit ? (
            <Button size="sm" variant="ghost" onClick={() => onChange(clearEdit(tracking, track.id, frame))}>
              <Undo2 size={14} aria-hidden /> Undo correction here
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => onChange(updateTrack(tracking, track.id, { hidden: !track.hidden }))}>
            {track.hidden ? <Eye size={14} aria-hidden /> : <EyeOff size={14} aria-hidden />} {track.hidden ? 'Show track' : 'Hide track'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 border-t border-zinc-800 pt-2">
        <SelectField label="Same player as (join fragments)" value={mergeWith} onChange={(e) => setMergeWith(e.target.value)} wrapperClassName="min-w-0 flex-1">
          <option value="">Choose a track…</option>
          {candidates.map((t) => (
            <option key={t.id} value={t.id}>
              {trackLabel(tracking, t, names).description}
            </option>
          ))}
        </SelectField>
        <Button
          size="sm"
          disabled={!mergeWith}
          onClick={() => {
            const r = mergeTracks(tracking, track.id, mergeWith);
            setMergeError(r.error);
            if (!r.error) {
              setMergeWith('');
              onChange(r.tracking);
            }
          }}
        >
          <Merge size={14} aria-hidden /> Join
        </Button>
        {mergeError ? (
          <p role="alert" className="w-full text-xs text-red-300">
            {mergeError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
