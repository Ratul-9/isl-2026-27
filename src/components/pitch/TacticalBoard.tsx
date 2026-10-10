'use client';

import { useImperativeHandle, useRef } from 'react';
import type { KeyboardEvent, Ref } from 'react';
import { nudge, toView, viewBoxFor } from '@/domain/geometry';
import type { Direction, Orientation } from '@/domain/geometry';
import { teamDisplayName } from '@/domain/match';
import type { Id, LineupSlot, Player, TeamSide } from '@/domain/types';
import { useMatch, useMatchActions } from '@/store/MatchContext';
import type { BoardSelection, Tool } from './boardTypes';
import { DrawingDefs, DrawingLayer, EndpointHandles } from './DrawingLayer';
import { PitchMarkings } from './PitchMarkings';
import { PlayerMarker } from './PlayerMarker';
import { useBoardInteraction } from './useBoardInteraction';

const KEY_STEP_METRES = 1;
const KEY_STEP_LARGE_METRES = 5;
const ARROW_KEYS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

export interface TacticalBoardHandle {
  /** Abandons the gesture in progress (e.g. on Escape). Returns true if one was active. */
  cancelGesture(): boolean;
}

interface TacticalBoardProps {
  orientation: Orientation;
  snap: boolean;
  tool: Tool;
  selection: BoardSelection;
  onSelect: (selection: BoardSelection) => void;
  ref?: Ref<TacticalBoardHandle>;
}

export function TacticalBoard({ orientation, snap, tool, selection, onSelect, ref }: TacticalBoardProps) {
  const match = useMatch();
  const { moveSlot } = useMatchActions();
  const svgRef = useRef<SVGSVGElement>(null);
  const board = useBoardInteraction({ svgRef, orientation, snap, tool, selection, onSelect });
  const vb = viewBoxFor(orientation);
  const selectedDrawingId = selection?.type === 'drawing' ? selection.id : null;

  useImperativeHandle(ref, () => ({
    cancelGesture: () => {
      const active = board.interaction !== null;
      board.cancel();
      return active;
    },
  }));

  function onMarkerKeyDown(side: TeamSide, slot: LineupSlot, e: KeyboardEvent<SVGGElement>) {
    const ref = { type: 'slot' as const, side, slotId: slot.id };
    const direction = ARROW_KEYS[e.key];
    if (direction) {
      e.preventDefault();
      const step = e.shiftKey ? KEY_STEP_LARGE_METRES : KEY_STEP_METRES;
      // Not snapped: a 1 m step would round straight back onto the 2.5 m grid.
      moveSlot(side, slot.id, nudge({ x: slot.x, y: slot.y }, direction, step, orientation));
      onSelect(ref);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(ref);
    }
  }

  function markersFor(side: TeamSide) {
    const team = match[side];
    const players = new Map<Id, Player>(team.players.map((p) => [p.id, p]));
    const name = teamDisplayName(team, side);
    return team.slots.map((slot) => {
      const live = board.slotPosition(slot.id);
      return (
        <PlayerMarker
          key={slot.id}
          slotId={slot.id}
          side={side}
          teamName={name}
          view={toView(live ?? slot, orientation)}
          position={slot.position}
          player={slot.playerId ? (players.get(slot.playerId) ?? null) : null}
          selected={selection?.type === 'slot' && selection.slotId === slot.id}
          dragging={live !== null}
          draggable={tool === 'select'}
          onKeyDown={(e) => onMarkerKeyDown(side, slot, e)}
        />
      );
    });
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`${vb.x} ${vb.y} ${vb.width} ${vb.height}`}
      role="group"
      aria-label={`Tactical board, ${orientation}`}
      data-tool={tool}
      className="block h-auto max-h-[calc(100vh-11rem)] w-full select-none"
      style={{
        fontFamily: 'var(--font-sans)',
        // Drawing tools own every touch on the pitch; in select mode the grass still scrolls the page.
        touchAction: tool === 'select' ? 'auto' : 'none',
        cursor: tool === 'select' ? 'default' : tool === 'eraser' ? 'cell' : 'crosshair',
      }}
      {...board.handlers}
    >
      <DrawingDefs />
      <PitchMarkings orientation={orientation} />
      {/* Arrows sit under the markers so players stay easy to grab; handles go on top. */}
      <DrawingLayer
        drawings={board.drawings}
        orientation={orientation}
        selectedId={selectedDrawingId}
        interactive={tool === 'select'}
        draft={board.draft}
      />
      <g aria-label="Home team">{markersFor('home')}</g>
      <g aria-label="Away team">{markersFor('away')}</g>
      {tool === 'select' ? (
        <EndpointHandles drawing={board.drawings.find((d) => d.id === selectedDrawingId)} orientation={orientation} />
      ) : null}
    </svg>
  );
}
