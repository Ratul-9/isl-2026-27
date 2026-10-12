'use client';

import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { Orientation } from '@/domain/geometry';
import { clientToPitch, viewBoxFor } from '@/domain/geometry';
import { canonicalToReplay, replayToView } from '@/domain/replay/coords';
import type { SampledTrack } from '@/domain/tracking/sample';
import type { ReplayPoint, TrackingData } from '@/domain/types';
import { isNumberUnknown } from '@/domain/presets/snapshot';
import { JerseyDefs, JerseyShape } from '@/components/pitch/Jersey';
import { PitchMarkings } from '@/components/pitch/PitchMarkings';
import { usePlayerKits } from '@/components/pitch/usePlayerKits';
import { PITCH_THEME as T } from '@/components/pitch/pitchTheme';
import { trackColours, trackLabel } from './trackStyle';
import type { TrackNames } from './trackStyle';

export interface TrackingPitchEditing {
  /** Clicking the grass places the selected track there (at the current frame). */
  placing: boolean;
  onSelect: (trackId: string | null) => void;
  /** One call per gesture, on release. */
  onPlace: (trackId: string, point: ReplayPoint) => void;
}

interface TrackingPitchProps {
  tracking: TrackingData;
  sample: SampledTrack[];
  trail: ReplayPoint[][];
  orientation: Orientation;
  names: TrackNames;
  showIds: boolean;
  selectedTrackId: string | null;
  /** Pitch landmarks (metres) to point out, e.g. while calibrating. */
  landmarks?: { id: string; pitchM: [number, number] }[];
  editing?: TrackingPitchEditing;
}

const R = 2.1;

/** Tracked players and ball on the pitch at one moment. A pure render of (tracking data, time); drags commit once. */
export function TrackingPitch({ tracking, sample, trail, orientation, names, showIds, selectedTrackId, landmarks = [], editing }: TrackingPitchProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const playerKits = usePlayerKits();
  const [drag, setDrag] = useState<{ trackId: string; point: ReplayPoint; moved: boolean } | null>(null);
  const vb = viewBoxFor(orientation);

  function pointFrom(e: PointerEvent<SVGSVGElement>): ReplayPoint | null {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return null;
    const c = clientToPitch({ x: e.clientX, y: e.clientY }, { left: r.left, top: r.top, width: r.width, height: r.height }, orientation);
    return c ? canonicalToReplay(c) : null;
  }

  function onPointerDown(e: PointerEvent<SVGSVGElement>) {
    if (!editing) return;
    const trackId = (e.target as Element).closest('[data-track-id]')?.getAttribute('data-track-id') ?? null;
    const point = pointFrom(e);
    if (!trackId) {
      if (editing.placing && selectedTrackId && point) editing.onPlace(selectedTrackId, point);
      else editing.onSelect(null);
      return;
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    editing.onSelect(trackId);
    if (point) setDrag({ trackId, point, moved: false });
  }

  function onPointerMove(e: PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    const point = pointFrom(e);
    if (point) setDrag({ ...drag, point, moved: true });
  }

  function onPointerUp(e: PointerEvent<SVGSVGElement>) {
    if (!drag || !editing) return;
    if (drag.moved) editing.onPlace(drag.trackId, pointFrom(e) ?? drag.point);
    setDrag(null);
  }

  const ordered = [...sample].sort((a, b) => Number(a.track.objectType === 'ball') - Number(b.track.objectType === 'ball'));

  return (
    <svg
      ref={svgRef}
      viewBox={`${vb.x} ${vb.y} ${vb.width} ${vb.height}`}
      role="group"
      aria-label={`Tracked positions on the pitch, ${orientation}`}
      className="block h-auto w-full select-none"
      style={{ fontFamily: 'var(--font-sans)', touchAction: editing ? 'none' : 'auto', cursor: editing?.placing ? 'crosshair' : undefined }}
      onPointerDown={editing ? onPointerDown : undefined}
      onPointerMove={editing ? onPointerMove : undefined}
      onPointerUp={editing ? onPointerUp : undefined}
      onPointerCancel={editing ? () => setDrag(null) : undefined}
    >
      {playerKits.jerseys ? <JerseyDefs kits={playerKits.inUse} /> : null}
      <PitchMarkings orientation={orientation} />
      {trail.map((segment, i) => (
        <polyline
          key={i}
          points={segment.map((p) => replayToView(p, orientation)).map((v) => `${v.x},${v.y}`).join(' ')}
          fill="none"
          stroke={T.pass}
          strokeOpacity={0.75}
          strokeWidth={0.45}
          strokeLinecap="round"
          strokeLinejoin="round"
          data-testid="ball-trail"
        />
      ))}
      {landmarks.map((l) => {
        const v = replayToView({ x: (l.pitchM[0] / 105) * 100, y: (l.pitchM[1] / 68) * 100 }, orientation);
        return <path key={l.id} d={`M${v.x - 1.4} ${v.y}h2.8M${v.x} ${v.y - 1.4}v2.8`} stroke={T.freehand} strokeWidth={0.5} data-testid="landmark-mark" />;
      })}
      <g role="group" aria-label="Tracked players and ball">
        {ordered.map((s) => {
          const live = drag?.trackId === s.track.id ? drag.point : s.point;
          const v = replayToView(live, orientation);
          const selected = selectedTrackId === s.track.id;
          const label = trackLabel(tracking, s.track, names);
          const how = s.kind === 'manual' ? 'placed by you' : s.inferred ? 'interpolated, estimated' : 'detected';
          const common = {
            'data-track-id': s.track.id,
            transform: `translate(${v.x} ${v.y})`,
            role: editing ? ('button' as const) : ('img' as const),
            tabIndex: editing ? 0 : undefined,
            'aria-label': `${label.description}, ${how}`,
            'aria-pressed': editing ? selected : undefined,
            onKeyDown: editing
              ? (e: KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    editing.onSelect(s.track.id);
                  }
                }
              : undefined,
            className: 'outline-none',
            style: { cursor: editing ? 'grab' : undefined, touchAction: 'none' as const },
          };
          const dash = s.inferred && s.kind !== 'manual' ? '0.7 0.5' : undefined;
          if (s.track.objectType === 'ball') {
            return (
              <g key={s.track.id} {...common}>
                <title>{`${label.description}, ${how}`}</title>
                <circle r={1.8} fill="transparent" />
                {selected ? <circle r={2.2} fill="none" stroke={T.selection} strokeWidth={0.4} /> : null}
                <circle r={0.95} fill="#ffffff" stroke="#111827" strokeWidth={0.3} strokeDasharray={dash ? '0.4 0.3' : undefined} />
              </g>
            );
          }
          const colours = trackColours(tracking, s.track);
          const kit = playerKits.jerseys && colours.side ? playerKits.kits[colours.side] : null;
          const linked = s.track.playerId ? names.players.get(s.track.playerId) : undefined;
          const printedNumber = linked && !isNumberUnknown(linked) ? linked.shirtNumber : null;
          return (
            <g key={s.track.id} {...common} data-side={colours.side ?? 'unknown'}>
              <title>{`${label.description}, ${how}`}</title>
              {selected ? <circle r={R + 0.8} fill="none" stroke={T.selection} strokeWidth={0.45} /> : null}
              {s.kind === 'manual' ? <circle r={R + 0.45} fill="none" stroke={T.freehand} strokeWidth={0.3} /> : null}
              {kit ? (
                <>
                  <circle r={R} fill="transparent" />
                  {/* Jersey numbers are squad numbers only: a tracker id is never printed on a shirt. */}
                  <g transform="scale(0.8)">
                    <JerseyShape kit={kit} number={printedNumber} estimated={dash !== undefined} />
                  </g>
                </>
              ) : (
                <>
                  <circle r={R} fill={colours.fill} stroke={colours.stroke} strokeWidth={dash ? 0.45 : 0.3} strokeDasharray={dash} />
                  {label.inside && (showIds || s.track.playerId) ? (
                    <text y={0.75} textAnchor="middle" fontSize={label.inside.length > 2 ? 1.5 : 2} fontWeight={700} fill={colours.text} style={{ pointerEvents: 'none' }}>
                      {label.inside}
                    </text>
                  ) : null}
                </>
              )}
              {label.below && (showIds || s.track.playerId) ? (
                <text
                  y={R + 2}
                  textAnchor="middle"
                  fontSize={1.6}
                  fontWeight={600}
                  fill={T.labelText}
                  style={{ paintOrder: 'stroke', stroke: T.labelHalo, strokeWidth: 0.45, pointerEvents: 'none' }}
                >
                  {label.below}
                </text>
              ) : null}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
