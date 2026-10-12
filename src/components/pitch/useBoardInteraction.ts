'use client';

import { useCallback, useState } from 'react';
import type { PointerEvent, RefObject } from 'react';
import {
  appendFreehandPoint,
  hitTestDrawings,
  isArrowKind,
  MIN_ARROW_METRES,
  translateDrawing,
} from '@/domain/drawings';
import type { ArrowKind } from '@/domain/drawings';
import { clampPoint, clientToPitch, distanceMetres, snapPoint } from '@/domain/geometry';
import type { Orientation } from '@/domain/geometry';
import { findPlayerAt } from '@/domain/layout';
import type { Drawing, Id, Point, TeamSide } from '@/domain/types';
import { useMatch, useMatchActions, useMatchAnalysis } from '@/store/MatchContext';
import type { BoardSelection, Tool } from './boardTypes';
import { MARKER_RADIUS } from './pitchTheme';

/** Movement below this (metres) is a click, not a drag. */
const DRAG_THRESHOLD_METRES = 0.3;
/** Arrows start/end on a player when the pointer is this close to them. */
const PLAYER_SNAP_METRES = MARKER_RADIUS + 0.6;
const ERASER_TOLERANCE_METRES = 1.5;

type End = 'from' | 'to';

/** The gesture in progress. Nothing reaches the store until it completes. */
export type Interaction =
  | { kind: 'slotDrag'; pointerId: number; side: TeamSide; slotId: Id; offset: Point; start: Point; current: Point; moved: boolean }
  | { kind: 'draw'; pointerId: number; tool: ArrowKind; from: Point; fromPlayerId?: Id; to: Point; toPlayerId?: Id }
  | { kind: 'freehand'; pointerId: number; points: Point[] }
  | { kind: 'endpoint'; pointerId: number; drawingId: Id; end: End; point: Point; playerId?: Id; moved: boolean }
  | { kind: 'drawingDrag'; pointerId: number; drawingId: Id; start: Point; delta: Point; moved: boolean }
  | { kind: 'erase'; pointerId: number; ids: Id[] };

interface Options {
  svgRef: RefObject<SVGSVGElement | null>;
  orientation: Orientation;
  snap: boolean;
  tool: Tool;
  selection: BoardSelection;
  onSelect: (selection: BoardSelection) => void;
}

/**
 * Pointer routing for the board. One handler set on the <svg>, with pointer
 * capture, keeps player dragging and arrow drawing unambiguous:
 * - select tool: DOM target decides (endpoint handle → edit end, arrow → move
 *   arrow, marker → drag player, grass → deselect);
 * - drawing tools: targets are ignored; pressing on a player starts an arrow
 *   FROM that player and never moves them;
 * - eraser: removes drawings under the pointer while pressed.
 * Each gesture commits exactly one store action on pointer-up (one undo step).
 */
export function useBoardInteraction({ svgRef, orientation, snap, tool, selection, onSelect }: Options) {
  const match = useMatch();
  const actions = useMatchActions();
  const analysis = useMatchAnalysis();
  const [ix, setIx] = useState<Interaction | null>(null);

  const toPitch = (e: PointerEvent): Point | null => {
    const svg = svgRef.current;
    return svg ? clientToPitch({ x: e.clientX, y: e.clientY }, svg.getBoundingClientRect(), orientation) : null;
  };
  const free = (p: Point) => (snap ? snapPoint(p) : p);
  /** A point snapped onto a nearby player, else the free (optionally grid-snapped) point. */
  const anchor = (p: Point): { point: Point; playerId?: Id } => {
    // Arrows attach to who is on the pitch now, not to the starting XI.
    const live = {
      home: { ...match.home, slots: analysis.lineups.home.slots },
      away: { ...match.away, slots: analysis.lineups.away.slots },
    };
    const hit = findPlayerAt(live, p, PLAYER_SNAP_METRES);
    return hit ? { point: hit.point, playerId: hit.playerId } : { point: free(p) };
  };
  const eraseAt = (p: Point, ids: Id[]) => {
    const remaining = match.drawings.filter((d) => !ids.includes(d.id));
    const hit = hitTestDrawings(remaining, p, ERASER_TOLERANCE_METRES);
    return hit ? [...ids, hit.id] : ids;
  };

  function onPointerDown(e: PointerEvent<SVGSVGElement>) {
    if (ix || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const p = toPitch(e);
    if (!p) return;
    const target = e.target as Element;
    const capture = () => e.currentTarget.setPointerCapture?.(e.pointerId);
    const pointerId = e.pointerId;

    if (tool === 'select') {
      const handle = target.closest('[data-handle]');
      if (handle && selection?.type === 'drawing') {
        const end = handle.getAttribute('data-handle') as End;
        const d = match.drawings.find((x) => x.id === selection.id);
        if (!d) return;
        capture();
        setIx({ kind: 'endpoint', pointerId, drawingId: d.id, end, point: d[end], playerId: d[`${end}PlayerId`], moved: false });
        return;
      }
      const drawingId = target.closest('[data-drawing-id]')?.getAttribute('data-drawing-id');
      const slotEl = target.closest('[data-slot-id]');
      // Markers sit above arrows, so a marker hit wins.
      if (slotEl) {
        const side = slotEl.getAttribute('data-side') as TeamSide;
        const slotId = slotEl.getAttribute('data-slot-id') as Id;
        const slot = match[side].slots.find((s) => s.id === slotId);
        if (!slot) return;
        onSelect({ type: 'slot', side, slotId });
        capture();
        const start = { x: slot.x, y: slot.y };
        setIx({ kind: 'slotDrag', pointerId, side, slotId, offset: { x: p.x - slot.x, y: p.y - slot.y }, start, current: start, moved: false });
        return;
      }
      if (drawingId) {
        onSelect({ type: 'drawing', id: drawingId });
        capture();
        setIx({ kind: 'drawingDrag', pointerId, drawingId, start: p, delta: { x: 0, y: 0 }, moved: false });
        return;
      }
      onSelect(null);
      return;
    }

    capture();
    if (tool === 'eraser') {
      setIx({ kind: 'erase', pointerId, ids: eraseAt(p, []) });
    } else if (tool === 'freehand') {
      setIx({ kind: 'freehand', pointerId, points: [p] });
    } else if (isArrowKind(tool)) {
      const a = anchor(p);
      setIx({ kind: 'draw', pointerId, tool, from: a.point, fromPlayerId: a.playerId, to: a.point });
    }
  }

  function onPointerMove(e: PointerEvent<SVGSVGElement>) {
    if (!ix || e.pointerId !== ix.pointerId) return;
    const p = toPitch(e);
    if (!p) return;
    switch (ix.kind) {
      case 'slotDrag': {
        const current = free(clampPoint({ x: p.x - ix.offset.x, y: p.y - ix.offset.y }));
        setIx({ ...ix, current, moved: ix.moved || distanceMetres(ix.start, current) > DRAG_THRESHOLD_METRES });
        break;
      }
      case 'draw': {
        const a = anchor(p);
        // Ending on the starting player would make a zero-length arrow; keep the free point instead.
        const onSelf = a.playerId && a.playerId === ix.fromPlayerId;
        setIx({ ...ix, to: onSelf ? free(p) : a.point, toPlayerId: onSelf ? undefined : a.playerId });
        break;
      }
      case 'freehand':
        setIx({ ...ix, points: appendFreehandPoint(ix.points, p) });
        break;
      case 'endpoint': {
        const a = anchor(p);
        setIx({ ...ix, point: a.point, playerId: a.playerId, moved: true });
        break;
      }
      case 'drawingDrag': {
        const delta = { x: p.x - ix.start.x, y: p.y - ix.start.y };
        const moved = ix.moved || distanceMetres(ix.start, p) > DRAG_THRESHOLD_METRES;
        setIx({ ...ix, delta, moved });
        break;
      }
      case 'erase': {
        const ids = eraseAt(p, ix.ids);
        if (ids.length !== ix.ids.length) setIx({ ...ix, ids });
        break;
      }
    }
  }

  function onPointerUp(e: PointerEvent<SVGSVGElement>) {
    if (!ix || e.pointerId !== ix.pointerId) return;
    switch (ix.kind) {
      case 'slotDrag':
        if (ix.moved) actions.moveSlot(ix.side, ix.slotId, ix.current);
        break;
      case 'draw':
        if (distanceMetres(ix.from, ix.to) >= MIN_ARROW_METRES) {
          actions.addDrawing({ kind: ix.tool, from: ix.from, to: ix.to, fromPlayerId: ix.fromPlayerId, toPlayerId: ix.toPlayerId });
        }
        break;
      case 'freehand':
        if (ix.points.length >= 2) {
          actions.addDrawing({ kind: 'freehand', from: ix.points[0], to: ix.points[ix.points.length - 1], points: ix.points });
        }
        break;
      case 'endpoint':
        if (ix.moved) {
          actions.updateDrawing(ix.drawingId, { [ix.end]: ix.point, [`${ix.end}PlayerId`]: ix.playerId });
        }
        break;
      case 'drawingDrag':
        if (ix.moved) actions.moveDrawing(ix.drawingId, ix.delta);
        break;
      case 'erase':
        actions.deleteDrawings(ix.ids);
        if (selection?.type === 'drawing' && ix.ids.includes(selection.id)) onSelect(null);
        break;
    }
    setIx(null);
  }

  const cancel = useCallback(() => setIx(null), []);

  /** Drawings as they should look right now, including an uncommitted edit. */
  const drawings: Drawing[] = match.drawings.flatMap((d) => {
    if (ix?.kind === 'erase' && ix.ids.includes(d.id)) return [];
    if (ix?.kind === 'endpoint' && ix.drawingId === d.id) {
      const next: Drawing = { ...d, [ix.end]: ix.point };
      if (ix.playerId) next[`${ix.end}PlayerId`] = ix.playerId;
      else delete next[`${ix.end}PlayerId`];
      return [next];
    }
    if (ix?.kind === 'drawingDrag' && ix.moved && ix.drawingId === d.id) return [translateDrawing(d, ix.delta)];
    return [d];
  });

  let draft: Drawing | null = null;
  if (ix?.kind === 'draw') {
    draft = { id: 'draft', kind: ix.tool, from: ix.from, to: ix.to, fromPlayerId: ix.fromPlayerId, toPlayerId: ix.toPlayerId };
  } else if (ix?.kind === 'freehand' && ix.points.length >= 2) {
    draft = { id: 'draft', kind: 'freehand', from: ix.points[0], to: ix.points[ix.points.length - 1], points: ix.points };
  }

  /** Live position of a slot being dragged, if any. */
  const slotPosition = (slotId: Id): Point | null => (ix?.kind === 'slotDrag' && ix.slotId === slotId ? ix.current : null);

  return {
    interaction: ix,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: cancel },
    cancel,
    drawings,
    draft,
    slotPosition,
  };
}
