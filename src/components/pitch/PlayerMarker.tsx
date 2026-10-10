'use client';

import type { KeyboardEvent, PointerEvent } from 'react';
import { positionName } from '@/domain/positions';
import type { Player, PositionCode, TeamSide, Point } from '@/domain/types';
import { compactName } from './labels';
import { MARKER_RADIUS, PITCH_THEME as T } from './pitchTheme';

export interface MarkerHandlers {
  onPointerDown: (e: PointerEvent<SVGGElement>) => void;
  onPointerMove: (e: PointerEvent<SVGGElement>) => void;
  onPointerUp: (e: PointerEvent<SVGGElement>) => void;
  onPointerCancel: (e: PointerEvent<SVGGElement>) => void;
  onKeyDown: (e: KeyboardEvent<SVGGElement>) => void;
}

interface PlayerMarkerProps extends MarkerHandlers {
  side: TeamSide;
  teamName: string;
  /** Position in SVG view units (metres). */
  view: Point;
  position: PositionCode;
  player: Player | null;
  selected: boolean;
  dragging: boolean;
}

const LABEL_STYLE = {
  paintOrder: 'stroke',
  stroke: T.labelHalo,
  strokeWidth: 0.5,
  strokeLinejoin: 'round',
} as const;

export function PlayerMarker({
  side,
  teamName,
  view,
  position,
  player,
  selected,
  dragging,
  ...handlers
}: PlayerMarkerProps) {
  const colours = T[side];
  const label = player
    ? `${teamName}: #${player.shirtNumber} ${player.name}, ${positionName(position)}`
    : `${teamName}: empty ${positionName(position)} position`;

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      data-side={side}
      data-position={position}
      transform={`translate(${view.x} ${view.y})`}
      className="pitch-marker cursor-grab outline-none"
      style={{ touchAction: 'none', cursor: dragging ? 'grabbing' : undefined }}
      {...handlers}
    >
      <title>{label}</title>
      <circle
        className="pitch-marker-ring"
        r={MARKER_RADIUS + 0.9}
        fill="none"
        stroke={T.selection}
        strokeWidth={0.45}
        opacity={selected ? 1 : 0}
      />
      {player ? (
        <>
          <circle r={MARKER_RADIUS} fill={colours.fill} stroke={colours.stroke} strokeWidth={0.3} />
          <text
            y={0.8}
            textAnchor="middle"
            fontSize={2.2}
            fontWeight={700}
            fill={colours.text}
            style={{ pointerEvents: 'none' }}
          >
            {player.shirtNumber}
          </text>
          <text
            y={MARKER_RADIUS + 2}
            textAnchor="middle"
            fontSize={1.7}
            fontWeight={600}
            fill={T.labelText}
            style={{ ...LABEL_STYLE, pointerEvents: 'none' }}
          >
            {compactName(player.name)}
          </text>
          <text
            y={-MARKER_RADIUS - 0.8}
            textAnchor="middle"
            fontSize={1.35}
            fontWeight={600}
            fill={T.labelText}
            style={{ ...LABEL_STYLE, pointerEvents: 'none' }}
          >
            {position}
          </text>
        </>
      ) : (
        <>
          <circle
            r={MARKER_RADIUS}
            fill={colours.fill}
            fillOpacity={0.18}
            stroke={colours.fill}
            strokeWidth={0.3}
            strokeDasharray="0.8 0.6"
          />
          <text
            y={0.5}
            textAnchor="middle"
            fontSize={1.35}
            fontWeight={600}
            fill={T.labelText}
            style={{ ...LABEL_STYLE, pointerEvents: 'none' }}
          >
            {position}
          </text>
        </>
      )}
    </g>
  );
}
