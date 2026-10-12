import { getFormation } from '@/domain/formations';
import { toView, viewBoxFor } from '@/domain/geometry';
import type { DraftTeam } from '@/domain/lineupImport/types';
import { PitchMarkings } from '@/components/pitch/PitchMarkings';
import { MARKER_RADIUS, PITCH_THEME } from '@/components/pitch/pitchTheme';

/**
 * A small non-interactive picture of the formation with the assigned players,
 * built from DizPitch's own pitch markings (never the uploaded image).
 */
export function FormationPreview({ team, side }: { team: DraftTeam; side: 'home' | 'away' }) {
  const vb = viewBoxFor('landscape');
  const template = getFormation(team.formation).slots;
  const colours = PITCH_THEME[side];
  return (
    <svg
      viewBox={`${vb.x} ${vb.y} ${vb.width} ${vb.height}`}
      role="img"
      aria-label={`${team.formation} formation preview with ${team.starters.filter((p) => p.slot !== null).length} players placed`}
      className="w-full max-w-md rounded-md"
    >
      <PitchMarkings orientation="landscape" />
      {template.map((slot, index) => {
        const player = team.starters.find((p) => p.slot === index);
        const at = toView({ x: slot.x, y: slot.y }, 'landscape');
        return (
          <g key={index} transform={`translate(${at.x} ${at.y})`}>
            <circle
              r={MARKER_RADIUS}
              fill={player ? colours.fill : 'none'}
              stroke={colours.fill}
              strokeWidth={0.4}
              strokeDasharray={player ? undefined : '0.8 0.6'}
            />
            <text y={0.9} textAnchor="middle" fontSize={2.3} fontWeight={700} fill={player ? colours.text : PITCH_THEME.labelText}>
              {player?.shirtNumber ?? slot.position}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
