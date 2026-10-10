'use client';

import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { clampPoint, clientToPitch, distanceMetres, nudge, snapPoint, toView, viewBoxFor } from '@/domain/geometry';
import type { Direction, Orientation } from '@/domain/geometry';
import { teamDisplayName } from '@/domain/match';
import type { Id, LineupSlot, Player, Point, TeamSide } from '@/domain/types';
import { useMatch, useMatchActions } from '@/store/MatchContext';
import { DrawingDefs, DrawingLayer } from './DrawingLayer';
import { PitchMarkings } from './PitchMarkings';
import { PlayerMarker } from './PlayerMarker';

export interface SlotRef {
  side: TeamSide;
  slotId: Id;
}

interface DragState extends SlotRef {
  pointerId: number;
  /** Pointer position minus slot position at grab time, so the marker doesn't jump. */
  offset: Point;
  start: Point;
  current: Point;
  moved: boolean;
}

/** Movement below this (metres) is treated as a click, not a drag. */
const DRAG_THRESHOLD_METRES = 0.3;
const KEY_STEP_METRES = 1;
const KEY_STEP_LARGE_METRES = 5;

const ARROW_KEYS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

interface TacticalBoardProps {
  orientation: Orientation;
  snap: boolean;
  selected: SlotRef | null;
  onSelect: (slot: SlotRef | null) => void;
}

export function TacticalBoard({ orientation, snap, selected, onSelect }: TacticalBoardProps) {
  const match = useMatch();
  const { moveSlot } = useMatchActions();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const vb = viewBoxFor(orientation);

  function pointerToPitch(e: PointerEvent): Point | null {
    const svg = svgRef.current;
    if (!svg) return null;
    return clientToPitch({ x: e.clientX, y: e.clientY }, svg.getBoundingClientRect(), orientation);
  }

  function handlersFor(side: TeamSide, slot: LineupSlot) {
    const ref = { side, slotId: slot.id };
    const isThisDrag = (e: PointerEvent) => drag?.slotId === slot.id && drag.pointerId === e.pointerId;

    return {
      onPointerDown: (e: PointerEvent<SVGGElement>) => {
        if (e.button !== 0 || drag) return;
        const p = pointerToPitch(e);
        onSelect(ref);
        if (!p) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        const start = { x: slot.x, y: slot.y };
        setDrag({ ...ref, pointerId: e.pointerId, offset: { x: p.x - slot.x, y: p.y - slot.y }, start, current: start, moved: false });
      },
      onPointerMove: (e: PointerEvent<SVGGElement>) => {
        if (!drag || !isThisDrag(e)) return;
        const p = pointerToPitch(e);
        if (!p) return;
        const raw = clampPoint({ x: p.x - drag.offset.x, y: p.y - drag.offset.y });
        const current = snap ? snapPoint(raw) : raw;
        const moved = drag.moved || distanceMetres(drag.start, current) > DRAG_THRESHOLD_METRES;
        setDrag({ ...drag, current, moved });
      },
      onPointerUp: (e: PointerEvent<SVGGElement>) => {
        if (!drag || !isThisDrag(e)) return;
        if (drag.moved) moveSlot(side, slot.id, drag.current);
        setDrag(null);
      },
      onPointerCancel: (e: PointerEvent<SVGGElement>) => {
        if (drag && isThisDrag(e)) setDrag(null);
      },
      onKeyDown: (e: KeyboardEvent<SVGGElement>) => {
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
        } else if (e.key === 'Escape') {
          onSelect(null);
        }
      },
    };
  }

  function markersFor(side: TeamSide) {
    const team = side === 'home' ? match.home : match.away;
    const players = new Map<Id, Player>(team.players.map((p) => [p.id, p]));
    const name = teamDisplayName(team, side);
    return team.slots.map((slot) => {
      const isDragging = drag?.slotId === slot.id;
      const point = isDragging ? drag.current : slot;
      return (
        <PlayerMarker
          key={slot.id}
          side={side}
          teamName={name}
          view={toView(point, orientation)}
          position={slot.position}
          player={slot.playerId ? (players.get(slot.playerId) ?? null) : null}
          selected={selected?.slotId === slot.id}
          dragging={isDragging}
          {...handlersFor(side, slot)}
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
      className="block h-auto max-h-[calc(100vh-9rem)] w-full select-none"
      style={{ fontFamily: 'var(--font-sans)' }}
      onPointerDown={(e) => {
        // Clicking empty grass clears the selection.
        if (e.target === e.currentTarget || (e.target as Element).closest('[aria-hidden]')) onSelect(null);
      }}
    >
      <DrawingDefs />
      <PitchMarkings orientation={orientation} />
      <g aria-label="Home team">{markersFor('home')}</g>
      <g aria-label="Away team">{markersFor('away')}</g>
      <DrawingLayer drawings={match.drawings} orientation={orientation} />
    </svg>
  );
}
