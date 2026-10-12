'use client';

import { useEffect, useImperativeHandle, useRef } from 'react';
import type { KeyboardEvent, Ref } from 'react';
import { nudge, toView, viewBoxFor } from '@/domain/geometry';
import type { Direction, Orientation } from '@/domain/geometry';
import { teamDisplayName } from '@/domain/match';
import type { Id, LineupSlot, Player, TeamSide } from '@/domain/types';
import { useMatch, useMatchActions, useMatchAnalysis } from '@/store/MatchContext';
import type { BoardSelection, Tool } from './boardTypes';
import { DrawingDefs, DrawingLayer, EndpointHandles } from './DrawingLayer';
import { PitchMarkings } from './PitchMarkings';
import { JerseyDefs } from './Jersey';
import { PlayerMarker } from './PlayerMarker';
import { usePlayerKits } from './usePlayerKits';
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
  /** The board's <svg>, for image export. */
  getSvg(): SVGSVGElement | null;
}

interface TacticalBoardProps {
  orientation: Orientation;
  snap: boolean;
  tool: Tool;
  selection: BoardSelection;
  onSelect: (selection: BoardSelection) => void;
  /** Fill the parent box (fullscreen) instead of limiting height to the page. The pitch keeps its aspect ratio. */
  fill?: boolean;
  ref?: Ref<TacticalBoardHandle>;
}

export function TacticalBoard({ orientation, snap, tool, selection, onSelect, fill = false, ref }: TacticalBoardProps) {
  const match = useMatch();
  const { moveSlot } = useMatchActions();
  const analysis = useMatchAnalysis();
  const playerKits = usePlayerKits();
  const svgRef = useRef<SVGSVGElement>(null);
  const board = useBoardInteraction({ svgRef, orientation, snap, tool, selection, onSelect });
  const vb = viewBoxFor(orientation);
  const selectedDrawingId = selection?.type === 'drawing' ? selection.id : null;

  // Touch: browsers ignore `touch-action` on SVG child elements (only the root <svg> counts), so a
  // finger on a player would start a page pan and cancel the drag. A NATIVE, non-passive touchstart
  // listener (React's touch handlers are passive) prevents the pan only when the touch begins on
  // something draggable, so swiping over open grass still scrolls the page.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || tool !== 'select') return;
    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as Element | null;
      if (target?.closest('[data-slot-id], [data-handle], [data-drawing-id]')) e.preventDefault();
    };
    svg.addEventListener('touchstart', onTouchStart, { passive: false });
    return () => svg.removeEventListener('touchstart', onTouchStart);
  }, [tool]);

  useImperativeHandle(ref, () => ({
    cancelGesture: () => {
      const active = board.interaction !== null;
      board.cancel();
      return active;
    },
    getSvg: () => svgRef.current,
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
    // Occupants come from the derived (active) lineup; geometry is the same slot.
    const occupant = new Map(analysis.lineups[side].slots.map((s) => [s.id, s.playerId]));
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
          player={players.get(occupant.get(slot.id) ?? '') ?? null}
          selected={selection?.type === 'slot' && selection.slotId === slot.id}
          dragging={live !== null}
          draggable={tool === 'select'}
          kit={playerKits.jerseys ? playerKits.kits[side] : null}
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
      className={
        fill
          ? 'block h-full w-full select-none'
          : 'block h-auto max-h-[max(24rem,calc(100vh-19rem))] w-full select-none'
      }
      style={{
        fontFamily: 'var(--font-sans)',
        // Drawing tools own every touch on the pitch; in select mode the grass still scrolls the page.
        touchAction: tool === 'select' ? 'auto' : 'none',
        cursor: tool === 'select' ? 'default' : tool === 'eraser' ? 'cell' : 'crosshair',
      }}
      {...board.handlers}
    >
      <DrawingDefs />
      {playerKits.jerseys ? <JerseyDefs kits={playerKits.inUse} /> : null}
      <PitchMarkings orientation={orientation} />
      {/* Arrows sit under the markers so players stay easy to grab; handles go on top. */}
      <DrawingLayer
        drawings={board.drawings}
        orientation={orientation}
        selectedId={selectedDrawingId}
        interactive={tool === 'select'}
        draft={board.draft}
      />
      <g role="group" aria-label="Home team">{markersFor('home')}</g>
      <g role="group" aria-label="Away team">{markersFor('away')}</g>
      {tool === 'select' ? (
        <EndpointHandles drawing={board.drawings.find((d) => d.id === selectedDrawingId)} orientation={orientation} />
      ) : null}
    </svg>
  );
}
