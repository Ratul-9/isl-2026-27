import type { Orientation } from '@/domain/geometry';
import { replayToView } from '@/domain/replay/coords';
import { labelPositions, markingAt, spacesAt } from '@/domain/scenario/build';
import type { ScenarioBuild } from '@/domain/scenario/build';
import type { SpaceHighlight, SpaceKind } from '@/domain/scenario/spaces';
import { PITCH_THEME as T } from '@/components/pitch/pitchTheme';

/** Concrete colours (not CSS variables) like the rest of the pitch, so the board's PNG rules would hold too. */
const SPACE_STYLE: Record<SpaceKind, { fill: string; stroke: string; dash?: string; name: string }> = {
  open: { fill: '#34d399', stroke: '#6ee7b7', name: 'Open space' },
  lane: { fill: '#38bdf8', stroke: '#7dd3fc', dash: '1.2 0.8', name: 'Passing lane' },
  cover: { fill: '#f59e0b', stroke: '#fbbf24', dash: '0.8 0.8', name: 'Defensive cover' },
  exposed: { fill: '#f97316', stroke: '#fb923c', dash: '2 1.2', name: 'Space left behind' },
  target: { fill: '#ffffff', stroke: '#ffffff', dash: '0.6 0.6', name: 'Target zone' },
  overload: { fill: '#c084fc', stroke: '#d8b4fe', name: 'Overloaded zone' },
};

const MARKING_STROKE = '#fca5a5';
const HALO = { paintOrder: 'stroke', stroke: T.labelHalo, strokeWidth: 0.45, strokeLinejoin: 'round' } as const;
/** Drawn back to front so the more important shapes are never buried. */
const ORDER: SpaceKind[] = ['exposed', 'cover', 'overload', 'open', 'lane', 'target'];

function Shape({ highlight, orientation, labelAt }: { highlight: SpaceHighlight; orientation: Orientation; labelAt: { x: number; y: number } }) {
  const style = SPACE_STYLE[highlight.kind];
  const contested = highlight.status === 'contested';
  const points = highlight.points
    .map((p) => {
      const v = replayToView(p, orientation);
      return `${v.x.toFixed(2)},${v.y.toFixed(2)}`;
    })
    .join(' ');
  const anchor = replayToView(labelAt, orientation);
  return (
    <g data-space-id={highlight.id} data-kind={highlight.kind} data-status={highlight.status}>
      <title>{highlight.detail ? `${highlight.label}: ${highlight.detail}` : highlight.label}</title>
      <polygon
        points={points}
        fill={style.fill}
        fillOpacity={contested ? 0.1 : ['exposed', 'cover', 'overload'].includes(highlight.kind) ? 0.14 : 0.24}
        stroke={style.stroke}
        strokeWidth={0.3}
        strokeOpacity={contested ? 0.7 : 0.9}
        strokeDasharray={contested ? '1 0.8' : style.dash}
      />
      <text x={anchor.x} y={anchor.y + 0.5} textAnchor="middle" fontSize={1.45} fontWeight={700} fill={T.labelText} style={HALO}>
        {highlight.short}
      </text>
    </g>
  );
}

/**
 * Spaces and marking lines for the scene at `time`. Pure function of
 * (build, time): the same geometry the tests exercise, nothing animated here.
 */
export function ScenarioUnderlay({ build, time, orientation }: { build: ScenarioBuild; time: number; orientation: Orientation }) {
  const spaces = spacesAt(build, time).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const marks = markingAt(build, time);
  // Most informative first, so they get the clearest spots.
  const priority = [...spaces].sort((a, b) => Number(a.kind === 'cover' || a.kind === 'exposed') - Number(b.kind === 'cover' || b.kind === 'exposed'));
  const labelAt = labelPositions(build, time, priority);
  return (
    <g data-testid="scenario-underlay">
      {spaces.map((h) => (
        <Shape key={h.id} highlight={h} orientation={orientation} labelAt={labelAt[h.id]} />
      ))}
      {marks.map((m) => {
        const a = replayToView(m.from, orientation);
        const b = replayToView(m.to, orientation);
        return (
          <line
            key={m.id}
            data-marking-id={m.id}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={MARKING_STROKE}
            strokeWidth={0.25}
            strokeDasharray="0.4 0.6"
            strokeLinecap="round"
            opacity={0.85}
          />
        );
      })}
    </g>
  );
}

/** What each colour means. Dashed and faint outlines are contested. */
export function ScenarioLegend() {
  const items: { kind: SpaceKind; label: string; hint: string }[] = [
    { kind: 'overload', label: 'Overloaded zone', hint: 'attackers v defenders in it' },
    { kind: 'open', label: 'Open space', hint: 'room with no defender in it' },
    { kind: 'lane', label: 'Passing lane', hint: 'corridor to the receiver' },
    { kind: 'cover', label: 'Defensive cover', hint: 'who protects against a counter' },
    { kind: 'exposed', label: 'Space left behind', hint: 'open if the ball is lost' },
  ];
  return (
    <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-zinc-300">
      {items.map((i) => (
        <li key={i.kind} className="flex items-center gap-1.5">
          <svg width="18" height="12" aria-hidden>
            <rect
              x="1"
              y="1"
              width="16"
              height="10"
              rx="2"
              fill={SPACE_STYLE[i.kind].fill}
              fillOpacity={0.35}
              stroke={SPACE_STYLE[i.kind].stroke}
              strokeDasharray={SPACE_STYLE[i.kind].dash ? '3 2' : undefined}
            />
          </svg>
          <span className="font-medium">{i.label}</span>
          <span className="hidden text-zinc-400 sm:inline">· {i.hint}</span>
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <svg width="18" height="12" aria-hidden>
          <line x1="1" y1="6" x2="17" y2="6" stroke={MARKING_STROKE} strokeWidth="1.5" strokeDasharray="2 3" strokeLinecap="round" />
        </svg>
        <span className="font-medium">Marking</span>
        <span className="hidden text-zinc-400 sm:inline">· who is picking up whom</span>
      </li>
      <li className="text-zinc-400">Faint dashed outline = contested: a defender is close enough to challenge it.</li>
    </ul>
  );
}

/** What the geometry says right now, in words (the pitch only carries short labels). */
export function SpacesNow({ build, time }: { build: ScenarioBuild; time: number }) {
  const spaces = spacesAt(build, time);
  return (
    <section aria-label="Spaces right now" className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm">
      <h3 className="text-sm font-semibold">Spaces right now</h3>
      {spaces.length === 0 ? (
        <p className="text-xs text-zinc-400">No highlighted space at this moment.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {spaces.map((h) => (
            <li key={h.id} className="flex items-start gap-2 text-xs">
              <svg width="14" height="14" aria-hidden className="mt-0.5 shrink-0">
                <rect
                  x="1"
                  y="1"
                  width="12"
                  height="12"
                  rx="2"
                  fill={SPACE_STYLE[h.kind].fill}
                  fillOpacity={h.status === 'contested' ? 0.2 : 0.45}
                  stroke={SPACE_STYLE[h.kind].stroke}
                  strokeDasharray={h.status === 'contested' || SPACE_STYLE[h.kind].dash ? '3 2' : undefined}
                />
              </svg>
              <span>
                <span className="font-medium text-zinc-100">{h.label}</span>
                {h.detail ? <span className="text-zinc-300"> · {h.detail}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Which badge is which player (the markers carry only the badge). */
export function ScenarioKey({
  build,
  names,
}: {
  build: ScenarioBuild;
  names: { attack: string; defence: string };
}) {
  const { scenario } = build;
  const group = (team: 'attack' | 'defence') =>
    scenario.roles
      .filter((r) => r.team === team)
      .map((r) => {
        const actor = build.replay.actors.find((a) => a.id === r.id);
        return { id: r.id, badge: build.badges[r.id], label: actor?.label ?? r.id };
      });
  return (
    <div aria-label="Players" role="group" className="grid gap-1.5 text-xs text-zinc-300 sm:grid-cols-2">
      {(['attack', 'defence'] as const).map((team) => (
        <p key={team}>
          <span className="font-semibold text-zinc-100">
            {team === 'attack' ? 'Team A' : 'Team B'} · {names[team]}:
          </span>{' '}
          {group(team).map((p, i) => (
            <span key={p.id}>
              {i > 0 ? ' · ' : ''}
              {p.label.startsWith(`${p.badge} `) ? (
                <span className="font-semibold">{p.label}</span>
              ) : (
                <>
                  <span className="font-semibold">{p.badge}</span> {p.label}
                </>
              )}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}
