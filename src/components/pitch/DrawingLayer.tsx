import { DRAWING_LABELS, isArrowKind } from '@/domain/drawings';
import { toView } from '@/domain/geometry';
import type { Orientation } from '@/domain/geometry';
import type { Drawing, DrawingKind } from '@/domain/types';
import { drawingGeometry } from './drawingPath';
import { DRAWING_STYLE } from './drawingStyle';
import { PITCH_THEME as T } from './pitchTheme';

const KINDS = Object.keys(DRAWING_STYLE) as DrawingKind[];
const HIT_WIDTH = 2.4;
const HANDLE_RADIUS = 1.1;

/** Arrowhead markers, one per drawing kind. Rendered once inside <defs>. */
export function DrawingDefs() {
  return (
    <defs>
      {KINDS.filter((k) => DRAWING_STYLE[k].arrowhead).map((kind) => (
        <marker
          key={kind}
          id={`arrowhead-${kind}`}
          viewBox="0 0 10 10"
          refX={8}
          refY={5}
          markerWidth={4}
          markerHeight={4}
          orient="auto-start-reverse"
          markerUnits="strokeWidth"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={DRAWING_STYLE[kind].colour} />
        </marker>
      ))}
    </defs>
  );
}

const HALO = { paintOrder: 'stroke', stroke: T.labelHalo, strokeWidth: 0.5, strokeLinejoin: 'round' } as const;

interface ShapeProps {
  drawing: Drawing;
  orientation: Orientation;
  selected?: boolean;
  /** Whether the shape receives pointer events (select tool only). */
  interactive?: boolean;
  draft?: boolean;
}

/** One drawing: visible stroke, LD badge for lofted passes, note, and a wide hit area. */
export function DrawingShape({ drawing, orientation, selected = false, interactive = false, draft = false }: ShapeProps) {
  const style = DRAWING_STYLE[drawing.kind];
  const { path, label } = drawingGeometry(drawing, orientation);
  const lofted = drawing.kind === 'lofted';
  const noteY = lofted ? label.y + 2.9 : label.y - 1.4;

  return (
    <g
      data-drawing-id={draft ? undefined : drawing.id}
      data-kind={drawing.kind}
      data-draft={draft || undefined}
      opacity={draft ? 0.75 : 1}
      style={{ pointerEvents: interactive && !draft ? 'auto' : 'none', cursor: interactive ? 'move' : undefined }}
    >
      <title>{`${DRAWING_LABELS[drawing.kind]}${drawing.note ? `: ${drawing.note}` : ''}`}</title>
      {selected ? (
        <path d={path} fill="none" stroke={T.selection} strokeWidth={style.width + 0.9} strokeLinecap="round" opacity={0.55} />
      ) : null}
      <path
        d={path}
        fill="none"
        stroke={style.colour}
        strokeWidth={style.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={style.dash}
        markerEnd={style.arrowhead ? `url(#arrowhead-${drawing.kind})` : undefined}
      />
      {/* Invisible wide stroke: makes thin arrows easy to tap/click. */}
      <path d={path} fill="none" stroke="transparent" strokeWidth={HIT_WIDTH} style={{ pointerEvents: 'stroke' }} />
      {lofted ? (
        <g transform={`translate(${label.x} ${label.y})`} style={{ pointerEvents: 'none' }}>
          <rect x={-1.9} y={-1.15} width={3.8} height={2.3} rx={0.6} fill={T.badge} stroke={T.pass} strokeWidth={0.18} />
          <text y={0.62} textAnchor="middle" fontSize={1.6} fontWeight={800} fill={T.pass} letterSpacing={0.05}>
            LD
          </text>
        </g>
      ) : null}
      {drawing.note ? (
        <text
          x={label.x}
          y={noteY}
          textAnchor="middle"
          fontSize={1.5}
          fontWeight={600}
          fill={T.labelText}
          style={{ ...HALO, pointerEvents: 'none' }}
        >
          {drawing.note.length > 28 ? `${drawing.note.slice(0, 27)}…` : drawing.note}
        </text>
      ) : null}
    </g>
  );
}

/** All drawings, plus an optional in-progress draft. */
export function DrawingLayer({
  drawings,
  orientation,
  selectedId,
  interactive,
  draft,
}: {
  drawings: readonly Drawing[];
  orientation: Orientation;
  selectedId: string | null;
  interactive: boolean;
  draft: Drawing | null;
}) {
  return (
    <g aria-label={`${drawings.length} tactical drawing${drawings.length === 1 ? '' : 's'}`}>
      {drawings.map((d) => (
        <DrawingShape
          key={d.id}
          drawing={d}
          orientation={orientation}
          selected={d.id === selectedId}
          interactive={interactive}
        />
      ))}
      {draft ? <DrawingShape drawing={draft} orientation={orientation} draft /> : null}
    </g>
  );
}

/** Draggable endpoint handles for the selected arrow (select tool). Rendered above markers. */
export function EndpointHandles({ drawing, orientation }: { drawing: Drawing | undefined; orientation: Orientation }) {
  if (!drawing || !isArrowKind(drawing.kind)) return null;
  return (
    <g>
      {(['from', 'to'] as const).map((end) => {
        const v = toView(drawing[end], orientation);
        return (
          <g key={end} data-handle={end} transform={`translate(${v.x} ${v.y})`} style={{ cursor: 'grab', touchAction: 'none' }}>
            <title>{end === 'from' ? 'Drag to move the start' : 'Drag to move the end'}</title>
            <circle r={HANDLE_RADIUS * 2} fill="transparent" />
            <circle r={HANDLE_RADIUS} fill="#ffffff" stroke={T.selection} strokeWidth={0.4} />
          </g>
        );
      })}
    </g>
  );
}
