import { useMemo } from 'react';
import { chooseKits } from '@/domain/presets/kits';
import type { KitChoices, ResolvedKit } from '@/domain/presets/kits';
import { useMatch } from '@/store/MatchContext';

export interface PlayerKits {
  /** Jerseys are drawn only when the match asks for them AND at least one side has a kit theme. */
  jerseys: boolean;
  /** Whether the jersey option can be offered at all for this match. */
  available: boolean;
  /** The kit per side; a side without a theme (custom team) is null and keeps its circles. */
  kits: KitChoices;
  /** Every distinct kit in use (for the shared SVG definitions). */
  inUse: ResolvedKit[];
}

/** Which players are drawn as jerseys, and in which kit. Derived from the match; never stored per marker. */
export function usePlayerKits(): PlayerKits {
  const match = useMatch();
  const homeId = match.home.preset?.presetId;
  const awayId = match.away.preset?.presetId;
  const homeKit = match.home.kit;
  const awayKit = match.away.kit;
  const kits = useMemo(
    () => chooseKits({ presetId: homeId, kit: homeKit }, { presetId: awayId, kit: awayKit }),
    [homeId, awayId, homeKit, awayKit],
  );
  const available = kits.home !== null || kits.away !== null;
  const jerseys = available && match.playerDisplay === 'jerseys';
  const inUse = useMemo(() => [kits.home, kits.away].filter((k): k is ResolvedKit => k !== null), [kits]);
  return { jerseys, available, kits, inUse };
}
