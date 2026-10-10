import { markingsTransform, PITCH_LENGTH as L, PITCH_WIDTH as W, viewBoxFor } from '@/domain/geometry';
import type { Orientation } from '@/domain/geometry';
import { PITCH_THEME as T } from './pitchTheme';

// Law 1 dimensions in metres.
const PENALTY_DEPTH = 16.5;
const PENALTY_WIDTH = 40.32;
const GOAL_AREA_DEPTH = 5.5;
const GOAL_AREA_WIDTH = 18.32;
const PENALTY_SPOT = 11;
const CIRCLE_RADIUS = 9.15;
const GOAL_WIDTH = 7.32;
const GOAL_DEPTH = 2;
const STRIPES = 12;
const LINE = 0.22;

/** Static pitch artwork, drawn in landscape metres and rotated for portrait. */
export function PitchMarkings({ orientation }: { orientation: Orientation }) {
  const vb = viewBoxFor(orientation);
  const arcDy = Math.sqrt(CIRCLE_RADIUS ** 2 - (PENALTY_DEPTH - PENALTY_SPOT) ** 2);
  const cy = W / 2;

  return (
    <g aria-hidden>
      <rect x={vb.x} y={vb.y} width={vb.width} height={vb.height} fill={T.surround} />
      <g transform={markingsTransform(orientation)}>
        <rect x={0} y={0} width={L} height={W} fill={T.grass} />
        {Array.from({ length: STRIPES }, (_, i) =>
          i % 2 === 0 ? null : (
            <rect key={i} x={(L / STRIPES) * i} y={0} width={L / STRIPES} height={W} fill={T.grassStripe} />
          ),
        )}
        <g fill="none" stroke={T.line} strokeWidth={LINE}>
          <rect x={0} y={0} width={L} height={W} />
          <line x1={L / 2} y1={0} x2={L / 2} y2={W} />
          <circle cx={L / 2} cy={cy} r={CIRCLE_RADIUS} />
          {/* Left end */}
          <rect x={0} y={cy - PENALTY_WIDTH / 2} width={PENALTY_DEPTH} height={PENALTY_WIDTH} />
          <rect x={0} y={cy - GOAL_AREA_WIDTH / 2} width={GOAL_AREA_DEPTH} height={GOAL_AREA_WIDTH} />
          <path d={`M ${PENALTY_DEPTH} ${cy - arcDy} A ${CIRCLE_RADIUS} ${CIRCLE_RADIUS} 0 0 1 ${PENALTY_DEPTH} ${cy + arcDy}`} />
          <rect x={-GOAL_DEPTH} y={cy - GOAL_WIDTH / 2} width={GOAL_DEPTH} height={GOAL_WIDTH} />
          {/* Right end */}
          <rect x={L - PENALTY_DEPTH} y={cy - PENALTY_WIDTH / 2} width={PENALTY_DEPTH} height={PENALTY_WIDTH} />
          <rect x={L - GOAL_AREA_DEPTH} y={cy - GOAL_AREA_WIDTH / 2} width={GOAL_AREA_DEPTH} height={GOAL_AREA_WIDTH} />
          <path
            d={`M ${L - PENALTY_DEPTH} ${cy - arcDy} A ${CIRCLE_RADIUS} ${CIRCLE_RADIUS} 0 0 0 ${L - PENALTY_DEPTH} ${cy + arcDy}`}
          />
          <rect x={L} y={cy - GOAL_WIDTH / 2} width={GOAL_DEPTH} height={GOAL_WIDTH} />
          {/* Corner arcs */}
          <path d={`M 0 1 A 1 1 0 0 0 1 0`} />
          <path d={`M ${L - 1} 0 A 1 1 0 0 0 ${L} 1`} />
          <path d={`M ${L} ${W - 1} A 1 1 0 0 0 ${L - 1} ${W}`} />
          <path d={`M 1 ${W} A 1 1 0 0 0 0 ${W - 1}`} />
        </g>
        <g fill={T.line}>
          <circle cx={L / 2} cy={cy} r={0.35} />
          <circle cx={PENALTY_SPOT} cy={cy} r={0.3} />
          <circle cx={L - PENALTY_SPOT} cy={cy} r={0.3} />
        </g>
      </g>
    </g>
  );
}
