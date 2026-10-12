import { at, card, goal, squadMatch, sub } from '@/domain/eventFixtures';
import { sampleReplay } from '@/domain/replay/fixtures';
import type { Match } from '@/domain/types';

/**
 * A "full" match for persistence tests: squads, a saved arrangement in use,
 * several drawings (one freehand, one pattern-generated), every event kind,
 * and a clock that is RUNNING in the second half.
 */
export const KICKOFF_EPOCH = Date.UTC(2026, 9, 10, 19, 30);

export function richMatch(): Match {
  const base = squadMatch();
  const layout = {
    id: 'layout-1',
    name: 'Pressing 4-4-2',
    baseFormation: '4-4-2' as const,
    slots: base.home.slots.map((s, i) => ({ position: s.position, x: 0.1 + i * 0.03, y: 0.2 + i * 0.05 })),
  };
  const events = [
    { id: 'k', type: 'periodMarker' as const, marker: 'kickoff' as const, period: 'firstHalf' as const, matchTimeMs: 0 },
    goal(base, 'home', at(12), { scorer: 'home-p9', assist: 'home-p8', id: 'g1', type: 'penalty' }),
    goal(base, 'home', at(30), { scorer: 'away-p3', type: 'ownGoal', id: 'og' }),
    card(base, 'away', at(40), 'away-p4', 'yellow', 'y'),
    { id: 'ht', type: 'periodMarker' as const, marker: 'halfTime' as const, period: 'firstHalf' as const, matchTimeMs: 46 * 60_000 },
    { id: 'n', type: 'note' as const, text: 'Team talk', period: 'halfTime' as const, matchTimeMs: 45 * 60_000, teamId: base.home.id },
    sub(base, 'home', at(60), 'home-p9', 'home-s0', 's1'),
    card(base, 'home', at(70), 'home-p5', 'red', 'r'),
  ];
  return {
    ...base,
    name: 'Cup tie',
    competition: 'League Cup',
    date: '2026-10-10',
    kickoffTime: '19:30',
    venue: 'Fatorda',
    notes: 'Heavy rain',
    status: 'inProgress',
    officials: { referee: 'A. Ref', assistant1: 'B. One', assistant2: 'C. Two', fourthOfficial: 'D. Four' },
    home: { ...base.home, coach: 'H. Coach', formation: { kind: 'saved', id: 'layout-1' } },
    away: { ...base.away, coach: 'A. Coach' },
    savedLayouts: [layout],
    drawings: [
      { id: 'd1', kind: 'pass', from: { x: 0.3, y: 0.4 }, to: { x: 0.5, y: 0.45 }, fromPlayerId: 'home-p5', note: 'Switch' },
      { id: 'd2', kind: 'lofted', from: { x: 0.2, y: 0.1 }, to: { x: 0.7, y: 0.8 } },
      {
        id: 'd3',
        kind: 'freehand',
        from: { x: 0.6, y: 0.6 },
        to: { x: 0.7, y: 0.65 },
        points: [{ x: 0.6, y: 0.6 }, { x: 0.65, y: 0.7 }, { x: 0.7, y: 0.65 }],
      },
      { id: 'd4', kind: 'movement', from: { x: 0.4, y: 0.3 }, to: { x: 0.6, y: 0.2 }, source: { patternId: 'overlap', teamId: base.home.id } },
    ],
    events,
    // One AI-derived replay, with an actor linked to a home squad player.
    replays: [linkedReplay()],
    // Second half, running since kick-off + 10 minutes of elapsed play.
    clock: { period: 'secondHalf', elapsedMs: 10 * 60_000, runningSinceEpochMs: KICKOFF_EPOCH + 3_600_000, endedPeriod: 'firstHalf' },
  };
}

function linkedReplay() {
  const r = sampleReplay({ id: 'rpl-1' });
  return { ...r, actors: r.actors.map((a, i) => (i === 0 ? { ...a, playerId: 'home-p9' } : a)) };
}
