'use client';

import { clubKits, kitsClash } from '@/domain/presets/kits';
import type { ResolvedKit } from '@/domain/presets/kits';
import { getTeam, teamDisplayName } from '@/domain/match';
import type { TeamSide } from '@/domain/types';
import { useMatch, useMatchActions } from '@/store/MatchContext';
import { SelectField } from '@/components/ui/fields';
import { usePlayerKits } from '@/components/pitch/usePlayerKits';

const VERIFICATION_TEXT = {
  documented: 'Club colours taken from a cited source.',
  partial: 'Main colour documented; some colours are approximations.',
  unverified: 'Colours not verified: a stand-in design.',
} as const;

function KitChoice({ label, kit, hasAway, onChange }: { label: string; kit: ResolvedKit; hasAway: boolean; onChange: (kit: 'home' | 'away') => void }) {
  return (
    <div className="flex flex-col gap-1">
      <SelectField label={`${label} kit`} value={kit.variant} onChange={(e) => onChange(e.target.value as 'home' | 'away')}>
        <option value="home">Home kit</option>
        <option value="away">{hasAway ? 'Away kit' : 'Away kit (generic stand-in)'}</option>
      </SelectField>
      <p className="text-[11px] leading-snug text-zinc-400">
        {kit.isFallback ? 'No documented away kit: a plain stand-in built from the club colour. ' : ''}
        {VERIFICATION_TEXT[kit.verification]}
      </p>
    </div>
  );
}

/** Which kit each preset team wears in jersey display, with what is and is not verified about it. */
export function KitPanel() {
  const match = useMatch();
  const actions = useMatchActions();
  const { jerseys, kits } = usePlayerKits();
  if (!jerseys) return null;
  const sides = (['home', 'away'] as const).filter((side) => kits[side] !== null);
  const hasCustomSide = sides.length < 2;

  return (
    <section aria-label="Kits" className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <h3 className="text-sm font-semibold">Kits</h3>
      {sides.map((side: TeamSide) => {
        const team = getTeam(match, side);
        return (
          <KitChoice
            key={side}
            label={teamDisplayName(team, side)}
            kit={kits[side]!}
            hasAway={!!clubKits(team.preset?.presetId)?.away}
            onChange={(kit) => actions.setTeamKit(side, kit)}
          />
        );
      })}
      {kitsClash(kits.home, kits.away) ? <p className="text-xs text-amber-200">The two shirts are similar in colour. Pick the away kit for one side.</p> : null}
      <p className="text-xs text-zinc-400">
        Jerseys are simplified designs inspired by each club&apos;s colours, not official shirts.
        {hasCustomSide ? ' A team without a kit theme keeps circles.' : ''}
      </p>
    </section>
  );
}
