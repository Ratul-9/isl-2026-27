import { shortenSegment, toView } from '@/domain/geometry';
import type { Orientation } from '@/domain/geometry';
import type { Drawing } from '@/domain/types';
import { MARKER_RADIUS, PITCH_THEME as T } from './pitchTheme';

const STYLE = {
  pass: { colour: T.pass, dash: undefined, label: 'Pass' },
  movement: { colour: T.movement, dash: '1.2 0.8', label: 'Movement' },
} as const;

/** Arrowhead markers, one per drawing colour. Rendered once inside <defs>. */
export function DrawingDefs() {
  return (
    <defs>
      {(Object.keys(STYLE) as (keyof typeof STYLE)[]).map((kind) => (
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
          <path d="M 0 0 L 10 5 L 0 10 z" fill={STYLE[kind].colour} />
        </marker>
      ))}
    </defs>
  );
}

/** Read-only rendering of tactical arrows (editing tools arrive in Phase 3). */
export function DrawingLayer({ drawings, orientation }: { drawings: readonly Drawing[]; orientation: Orientation }) {
  if (drawings.length === 0) return null;
  return (
    <g aria-label={`${drawings.length} tactical arrow${drawings.length === 1 ? '' : 's'}`} style={{ pointerEvents: 'none' }}>
      {drawings.map((d) => {
        const style = STYLE[d.kind];
        const [from, to] = shortenSegment(
          toView(d.from, orientation),
          toView(d.to, orientation),
          d.fromPlayerId ? MARKER_RADIUS + 0.3 : 0,
          d.toPlayerId ? MARKER_RADIUS + 0.6 : 0,
        );
        return (
          <line
            key={d.id}
            data-kind={d.kind}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={style.colour}
            strokeWidth={0.45}
            strokeLinecap="round"
            strokeDasharray={style.dash}
            markerEnd={`url(#arrowhead-${d.kind})`}
          >
            <title>{style.label} arrow</title>
          </line>
        );
      })}
    </g>
  );
}
