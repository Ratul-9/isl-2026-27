'use client';

import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import type { Orientation } from '@/domain/geometry';
import { clientToPitch, viewBoxFor } from '@/domain/geometry';
import { canonicalToReplay, clampReplayPoint, replayToCanonical, replayToView } from '@/domain/replay/coords';
import { pathProgress, resolvePathEnd, samplePositions } from '@/domain/replay/interpolate';
import type { Drawing, Id, ReplayPoint, ReplaySourceKind, TacticalReplay } from '@/domain/types';
import { DrawingDefs, DrawingLayer } from '@/components/pitch/DrawingLayer';
import { JerseyDefs } from '@/components/pitch/Jersey';
import { usePlayerKits } from '@/components/pitch/usePlayerKits';
import { PitchMarkings } from '@/components/pitch/PitchMarkings';
import { PITCH_THEME as T } from '@/components/pitch/pitchTheme';
import { actorDescription, ReplayMarker } from './ReplayMarker';

const KEY_STEP = 1;
const KEY_STEP_LARGE = 5;
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Which kind of position the actor has at time `t`: the nearest keyframe that sets it decides. */
function sourceAt(replay: TacticalReplay, actorId: Id, t: number): ReplaySourceKind {
  let best: { d: number; source: ReplaySourceKind } | null = null;
  for (const k of replay.keyframes) {
    const p = k.positions[actorId];
    if (!p) continue;
    const d = Math.abs(k.t - t);
    if (best === null || d < best.d) best = { d, source: p.source };
  }
  return best?.source ?? 'ai';
}

export interface ReplayPitchEditing {
  selectedActorId: Id | null;
  onSelect: (actorId: Id | null) => void;
  /** Called once per gesture, on release, with the final position. */
  onMove: (actorId: Id, point: ReplayPoint) => void;
}

interface ReplayPitchProps {
  replay: TacticalReplay;
  time: number;
  orientation: Orientation;
  teamNames: { home: string; away: string };
  editing?: ReplayPitchEditing;
  /** SVG drawn under the arrows and players (e.g. highlighted spaces). Must not take pointer events. */
  underlay?: ReactNode;
  /** Short text drawn inside a marker's circle (a role), by actor id. Jerseys never show it. */
  badges?: Readonly<Record<Id, string>>;
  /** Draw the label under each player (default). Off when badges and a key identify the players. */
  labels?: boolean;
}

/**
 * The replay on the existing pitch artwork and arrow styles. Everything shown
 * is a pure function of (replay, time); dragging only exists in the editor and
 * commits once on release.
 */
export function ReplayPitch({ replay, time, orientation, teamNames, editing, underlay, badges, labels = true }: ReplayPitchProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const playerKits = usePlayerKits();
  const [drag, setDrag] = useState<{ actorId: Id; point: ReplayPoint } | null>(null);
  const vb = viewBoxFor(orientation);
  const positions = samplePositions(replay, time);

  // Arrows appear when they start and draw out until they finish; a live ball/player drag is shown at once.
  const drawings: Drawing[] = replay.paths.flatMap((path) => {
    const progress = pathProgress(path, time);
    if (progress <= 0) return [];
    const from = replayToCanonical(resolvePathEnd(replay, path, 'from'));
    const target = replayToCanonical(resolvePathEnd(replay, path, 'to'));
    const to = { x: from.x + (target.x - from.x) * progress, y: from.y + (target.y - from.y) * progress };
    const base: Drawing = { id: path.id, kind: path.kind, from, to };
    if (path.note) base.note = path.note;
    if (path.fromActorId) base.fromPlayerId = path.fromActorId;
    if (progress >= 1 && path.toActorId) base.toPlayerId = path.toActorId;
    return [base];
  });

  function pointFromEvent(e: PointerEvent<SVGSVGElement>): ReplayPoint | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const canonical = clientToPitch({ x: e.clientX, y: e.clientY }, { left: r.left, top: r.top, width: r.width, height: r.height }, orientation);
    return canonical ? canonicalToReplay(canonical) : null;
  }

  function onPointerDown(e: PointerEvent<SVGSVGElement>) {
    if (!editing) return;
    const target = (e.target as Element).closest('[data-actor-id]');
    const actorId = target?.getAttribute('data-actor-id') ?? null;
    if (!actorId) return editing.onSelect(null);
    e.preventDefault();
    (e.currentTarget as SVGSVGElement).setPointerCapture?.(e.pointerId);
    editing.onSelect(actorId);
    const point = pointFromEvent(e);
    if (point) setDrag({ actorId, point });
  }

  function onPointerMove(e: PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    const point = pointFromEvent(e);
    if (point) setDrag({ actorId: drag.actorId, point });
  }

  function onPointerUp(e: PointerEvent<SVGSVGElement>) {
    if (!drag || !editing) return;
    const point = pointFromEvent(e) ?? drag.point;
    editing.onMove(drag.actorId, point);
    setDrag(null);
  }

  function onMarkerKeyDown(actorId: Id, e: KeyboardEvent<SVGGElement>) {
    if (!editing) return;
    const move = ARROWS[e.key];
    if (move) {
      e.preventDefault();
      const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
      const at = positions[actorId] ?? { x: 50, y: 50 };
      // Arrow keys move as seen on screen, so portrait behaves like landscape.
      // Portrait view: screen right = canonical +y, screen up = canonical +x (the home goal is at the bottom).
      const [dx, dy] = orientation === 'landscape' ? move : [-move[1], move[0]];
      editing.onSelect(actorId);
      editing.onMove(actorId, clampReplayPoint({ x: at.x + dx * step, y: at.y + dy * step }));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      editing.onSelect(actorId);
    }
  }

  const ordered = [...replay.actors].sort((a, b) => Number(a.kind === 'ball') - Number(b.kind === 'ball'));
  const caption = `Tactical replay, ${orientation}`;

  return (
    <svg
      ref={svgRef}
      viewBox={`${vb.x} ${vb.y} ${vb.width} ${vb.height}`}
      role="group"
      aria-label={caption}
      data-replay-time={time.toFixed(3)}
      className="block h-auto max-h-[max(24rem,calc(100vh-24rem))] w-full select-none"
      style={{ fontFamily: 'var(--font-sans)', touchAction: editing ? 'none' : 'auto' }}
      onPointerDown={editing ? onPointerDown : undefined}
      onPointerMove={editing ? onPointerMove : undefined}
      onPointerUp={editing ? onPointerUp : undefined}
      onPointerCancel={editing ? () => setDrag(null) : undefined}
    >
      <DrawingDefs />
      {playerKits.jerseys ? <JerseyDefs kits={playerKits.inUse} /> : null}
      <PitchMarkings orientation={orientation} />
      {underlay ? (
        <g data-layer="underlay" style={{ pointerEvents: 'none' }}>
          {underlay}
        </g>
      ) : null}
      <DrawingLayer drawings={drawings} orientation={orientation} selectedId={null} interactive={false} draft={null} />
      {replay.annotations
        .filter((a) => a.point && a.t <= time && time < a.t + 2.5)
        .map((a) => {
          const v = replayToView(a.point as ReplayPoint, orientation);
          return (
            <text key={a.id} x={v.x} y={v.y - 3} textAnchor="middle" fontSize={2} fontWeight={700} fill={T.pass} style={{ paintOrder: 'stroke', stroke: T.labelHalo, strokeWidth: 0.5 }}>
              {a.label}
            </text>
          );
        })}
      <g role="group" aria-label="Players and ball">
        {ordered.map((actor) => {
          const base = positions[actor.id];
          if (!base) return null;
          const live = drag?.actorId === actor.id ? drag.point : base;
          const source = drag?.actorId === actor.id ? 'user' : sourceAt(replay, actor.id, time);
          return (
            <ReplayMarker
              key={actor.id}
              actor={actor}
              view={replayToView(live, orientation)}
              source={source}
              description={actorDescription(actor, source, teamNames)}
              editable={!!editing}
              selected={editing?.selectedActorId === actor.id}
              dragging={drag?.actorId === actor.id}
              kit={playerKits.jerseys && actor.kind !== 'ball' && actor.side ? playerKits.kits[actor.side] : null}
              badge={badges?.[actor.id]}
              showLabel={labels}
              onKeyDown={(e) => onMarkerKeyDown(actor.id, e)}
            />
          );
        })}
      </g>
    </svg>
  );
}
