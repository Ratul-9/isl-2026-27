import { memo } from 'react';
import { luminance } from '@/domain/presets/kits';
import type { ResolvedKit } from '@/domain/presets/kits';

/**
 * A simplified football shirt seen from behind, drawn in pitch metres around (0, 0): about 5.7 m wide and 5 m
 * tall, so it fits the same 2.6 m marker radius the circles use (hit testing, arrow trimming and the selection
 * ring are unchanged). Plain SVG shapes and text: sharp at any size and exported to PNG like the rest of the board.
 */

/** Back of a short-sleeved shirt: collar line, shoulders, sleeves, torso. */
const BODY =
  'M -0.95 -2.45 L -1.9 -2.15 L -2.85 -0.85 L -2.25 -0.05 L -1.75 -0.7 L -1.75 2.6 L 1.75 2.6 L 1.75 -0.7 L 2.25 -0.05 L 2.85 -0.85 L 1.9 -2.15 L 0.95 -2.45 Q 0 -2.05 -0.95 -2.45 Z';
const NECK = 'M -0.95 -2.45 Q 0 -2.05 0.95 -2.45';
const CLIP_ID = 'dp-jersey-clip';
const SHADE_ID = 'dp-jersey-shade';
const gradientId = (key: string) => `dp-jersey-grad-${key}`;

/** Definitions shared by every jersey in one <svg>: the body clip, the soft shading and each theme's gradient. */
export function JerseyDefs({ kits }: { kits: readonly ResolvedKit[] }) {
  const gradients = kits.filter((k, i) => k.theme.pattern === 'gradient' && k.theme.gradient && kits.findIndex((o) => o.key === k.key) === i);
  return (
    <defs>
      <clipPath id={CLIP_ID}>
        <path d={BODY} />
      </clipPath>
      <linearGradient id={SHADE_ID} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffffff" stopOpacity={0.2} />
        <stop offset="0.45" stopColor="#ffffff" stopOpacity={0} />
        <stop offset="1" stopColor="#000000" stopOpacity={0.2} />
      </linearGradient>
      {gradients.map((k) => (
        <linearGradient key={k.key} id={gradientId(k.key)} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={k.theme.gradient!.from} />
          <stop offset="1" stopColor={k.theme.gradient!.to} />
        </linearGradient>
      ))}
    </defs>
  );
}

interface JerseyShapeProps {
  kit: ResolvedKit;
  /** Printed on the back; null draws a plain shirt (no number is ever invented). */
  number: number | null;
  /** Drawn with a dashed outline: the position is an estimate (replays), not a placed player. */
  estimated?: boolean;
}

export const JerseyShape = memo(function JerseyShape({ kit, number, estimated = false }: JerseyShapeProps) {
  const t = kit.theme;
  const accent = t.accent ?? t.secondary;
  const collar = t.collar ?? t.secondary;
  const body = t.pattern === 'gradient' && t.gradient ? `url(#${gradientId(kit.key)})` : t.primary;
  const halo = luminance(t.numberColour) > 0.45 ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.6)';

  return (
    <g data-kit={kit.key} data-pattern={t.pattern}>
      <path d={BODY} fill={body} />
      <g clipPath={`url(#${CLIP_ID})`}>
        {t.pattern === 'halves' ? <rect x={0} y={-3} width={3.2} height={6} fill={t.secondary} /> : null}
        {t.pattern === 'stripes' ? (
          <>
            <rect x={-1.05} y={-3} width={0.7} height={6} fill={t.secondary} />
            <rect x={0.35} y={-3} width={0.7} height={6} fill={t.secondary} />
          </>
        ) : null}
        {t.pattern === 'panel' ? <rect x={-3.2} y={-1.25} width={6.4} height={1.05} fill={t.secondary} /> : null}
        {t.pattern === 'piping' ? (
          <g stroke={accent} strokeWidth={0.2} fill="none">
            <path d="M -1.63 -2.05 V 2.6 M 1.63 -2.05 V 2.6" />
            <path d="M -1.75 2.3 H 1.75" />
          </g>
        ) : null}
        {t.sleeves ? (
          <>
            <rect x={-3.2} y={-3} width={1.45} height={3.2} fill={t.sleeves} />
            <rect x={1.75} y={-3} width={1.45} height={3.2} fill={t.sleeves} />
          </>
        ) : null}
        <rect x={-3.2} y={-3} width={6.4} height={6} fill={`url(#${SHADE_ID})`} />
      </g>
      <path d={NECK} fill="none" stroke={collar} strokeWidth={0.5} strokeLinecap="round" />
      <path d={BODY} fill="none" stroke={t.outline} strokeWidth={0.28} strokeLinejoin="round" />
      {estimated ? <path d={BODY} fill="none" stroke="#ffffff" strokeOpacity={0.85} strokeWidth={0.22} strokeLinejoin="round" strokeDasharray="0.7 0.5" /> : null}
      {number !== null ? (
        <text
          y={number >= 10 ? 1.05 : 1.15}
          textAnchor="middle"
          fontSize={number >= 10 ? 2.4 : 3}
          fontWeight={800}
          fill={t.numberColour}
          stroke={halo}
          strokeWidth={0.3}
          strokeLinejoin="round"
          style={{ paintOrder: 'stroke', pointerEvents: 'none', fontVariantNumeric: 'tabular-nums' }}
        >
          {number}
        </text>
      ) : null}
    </g>
  );
});
