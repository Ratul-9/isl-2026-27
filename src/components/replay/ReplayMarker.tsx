import type { KeyboardEvent } from 'react';
import type { Point, ReplayActor, ReplaySourceKind } from '@/domain/types';
import type { ResolvedKit } from '@/domain/presets/kits';
import { JerseyShape } from '@/components/pitch/Jersey';
import { compactName } from '@/components/pitch/labels';
import { MARKER_RADIUS, PITCH_THEME as T } from '@/components/pitch/pitchTheme';

const NEUTRAL = { fill: '#52525b', text: '#ffffff', stroke: '#27272a' };
const LABEL_STYLE = { paintOrder: 'stroke', stroke: T.labelHalo, strokeWidth: 0.5, strokeLinejoin: 'round' } as const;

/** Text announced for a marker: what it is, and that its place is an estimate unless the user set it. */
export function actorDescription(actor: ReplayActor, source: ReplaySourceKind, teamNames: { home: string; away: string }): string {
  const estimate = source === 'ai' ? ', estimated position' : '';
  if (actor.kind === 'ball') return `Ball${estimate}`;
  const team = actor.side ? teamNames[actor.side] : 'Team unknown';
  const who = [actor.shirtNumber !== null ? `#${actor.shirtNumber}` : null, actor.name || actor.label].filter(Boolean).join(' ');
  return `${team}: ${who}${estimate}`;
}

interface ReplayMarkerProps {
  actor: ReplayActor;
  /** SVG view units (metres). */
  view: Point;
  /** `ai` positions are drawn dashed: an estimate. `user` positions are solid. */
  source: ReplaySourceKind;
  description: string;
  editable: boolean;
  selected: boolean;
  dragging: boolean;
  onKeyDown?: (e: KeyboardEvent<SVGGElement>) => void;
  /** Jersey display: this side's kit, and the number printed on it (null = none; never the tracker/label id). */
  kit?: ResolvedKit | null;
  /** Text drawn inside the circle instead of a shirt number (a role such as "LB"); never on a jersey. */
  badge?: string;
  /** The name/label under the marker. Off where a key explains the badges instead (the accessible name keeps it). */
  showLabel?: boolean;
}

/** A player or the ball in the replay. Same visual language as board markers; positions are estimates, not tracking. */
export function ReplayMarker({ actor, view, source, description, editable, selected, dragging, onKeyDown, kit = null, badge, showLabel = true }: ReplayMarkerProps) {
  const transform = `translate(${view.x} ${view.y})`;
  const interactive = editable
    ? { role: 'button' as const, tabIndex: 0, 'aria-pressed': selected, onKeyDown }
    : { role: 'img' as const };

  if (actor.kind === 'ball') {
    return (
      <g
        {...interactive}
        aria-label={description}
        data-actor-id={actor.id}
        transform={transform}
        className="outline-none"
        style={{ touchAction: 'none', cursor: editable ? (dragging ? 'grabbing' : 'grab') : undefined }}
      >
        <title>{description}</title>
        <circle r={1.9} fill="transparent" />
        {selected ? <circle r={2.4} fill="none" stroke={T.selection} strokeWidth={0.4} /> : null}
        <circle r={1.1} fill="#ffffff" stroke="#111827" strokeWidth={0.3} strokeDasharray={source === 'ai' ? '0.5 0.35' : undefined} />
      </g>
    );
  }

  const colours = actor.side ? T[actor.side] : NEUTRAL;
  const shown = actor.name ? compactName(actor.name) : actor.label;
  return (
    <g
      {...interactive}
      aria-label={description}
      data-actor-id={actor.id}
      data-side={actor.side ?? 'unknown'}
      transform={transform}
      className="outline-none"
      style={{ touchAction: 'none', cursor: editable ? (dragging ? 'grabbing' : 'grab') : undefined }}
    >
      <title>{description}</title>
      {selected ? <circle r={MARKER_RADIUS + 0.9} fill="none" stroke={T.selection} strokeWidth={0.45} /> : null}
      {kit ? (
        <>
          <circle r={MARKER_RADIUS} fill="transparent" />
          <JerseyShape kit={kit} number={actor.shirtNumber} estimated={source === 'ai'} />
        </>
      ) : (
        <>
          <circle
            r={MARKER_RADIUS}
            fill={colours.fill}
            stroke={colours.stroke}
            strokeWidth={source === 'ai' ? 0.45 : 0.3}
            strokeDasharray={source === 'ai' ? '0.9 0.6' : undefined}
          />
          {actor.shirtNumber !== null || badge ? (
            <text y={0.9} textAnchor="middle" fontSize={badge && badge.length > 1 ? 2.1 : 2.5} fontWeight={700} fill={colours.text} style={{ pointerEvents: 'none' }}>
              {actor.shirtNumber ?? badge}
            </text>
          ) : null}
        </>
      )}
      {showLabel ? (
        <text
          y={MARKER_RADIUS + 2.3}
          textAnchor="middle"
          fontSize={1.8}
          fontWeight={600}
          fill={T.labelText}
          style={{ ...LABEL_STYLE, pointerEvents: 'none' }}
        >
          {shown.length > 14 ? `${shown.slice(0, 13)}…` : shown}
        </text>
      ) : null}
    </g>
  );
}
