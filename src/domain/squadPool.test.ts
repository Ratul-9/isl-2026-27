import { describe, expect, it } from 'vitest';
import { analyzeEvents, eventsReferencingPlayer } from './events';
import { at, goal, withEvents } from './eventFixtures';
import { createMatch } from './match';
import { presetPlayer, presetSeason, presetTeam } from './presets/fixtures';
import { buildMatchFromPresets } from './presets/toMatch';
import { getPool, promoteFromPool, returnToPool, updatePoolPlayer, validateSquadIntegrity } from './squad';
import type { PlayerDraft } from './squad';
import type { Match, Team } from './types';
import { matchReducer } from '../store/matchReducer';

let n = 0;
const newId = (prefix: string) => `${prefix}_p${++n}`;

function presetMatch(): Match {
  const season = presetSeason([presetTeam('a', { size: 30 }), presetTeam('b', { size: 28 })]);
  return buildMatchFromPresets(season, season.teams[0], season.teams[1], '2026-10-12T09:00:00.000Z', newId);
}

const promoteN = (team: Team, count: number, role: 'starter' | 'substitute'): Team => {
  let t = team;
  for (let i = 0; i < count; i++) {
    const next = promoteFromPool(t, getPool(t)[0].id, role);
    if (!next.ok) throw new Error(JSON.stringify(next.errors));
    t = next.team;
  }
  return t;
};

describe('squad pool', () => {
  it('moves a pool player into the XI (a free slot) or onto the bench, and out of the pool', () => {
    const team = presetMatch().home;
    const first = getPool(team)[0];
    const asStarter = promoteFromPool(team, first.id, 'starter');
    expect(asStarter.ok).toBe(true);
    if (!asStarter.ok) return;
    expect(asStarter.team.players.map((p) => p.id)).toEqual([first.id]);
    expect(asStarter.team.slots.filter((s) => s.playerId === first.id)).toHaveLength(1);
    expect(getPool(asStarter.team).map((p) => p.id)).not.toContain(first.id);
    expect(validateSquadIntegrity(asStarter.team)).toEqual([]);

    const second = getPool(team)[1];
    const asSub = promoteFromPool(team, second.id, 'substitute');
    expect(asSub.ok && asSub.team.bench).toEqual([second.id]);
  });

  it('keeps the player (id, origin, edits) when it moves', () => {
    const team = presetMatch().home;
    const edited = updatePoolPlayer(team, getPool(team)[0].id, { name: 'Corrected Name', shirtNumber: 2, preferredPosition: 'LB', notes: 'n', role: 'starter' });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const moved = promoteFromPool(edited.team, getPool(team)[0].id, 'starter');
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.team.players[0]).toMatchObject({ name: 'Corrected Name', shirtNumber: 2, preferredPosition: 'LB', origin: { presetId: expect.any(String) } });
  });

  it('refuses a 12th starter, a 12th substitute and a 23rd player, changing nothing', () => {
    let team = presetMatch().home;
    team = promoteN(team, 11, 'starter');
    const refusedStarter = promoteFromPool(team, getPool(team)[0].id, 'starter');
    expect(refusedStarter).toMatchObject({ ok: false, errors: { role: expect.stringContaining('11') } });

    team = promoteN(team, 11, 'substitute');
    expect(team.players).toHaveLength(22);
    const refusedSub = promoteFromPool(team, getPool(team)[0].id, 'substitute');
    expect(refusedSub.ok).toBe(false);
    expect(validateSquadIntegrity(team)).toEqual([]);
    expect(getPool(team).length).toBe(30 - 22);
  });

  it('refuses a player whose number a squad member already wears, and says which', () => {
    let team = presetMatch().home;
    const pool = getPool(team);
    // Give two pool players the same number: the pool tolerates it, the squad does not.
    const dup = updatePoolPlayer(team, pool[1].id, { name: pool[1].name, shirtNumber: pool[0].shirtNumber, preferredPosition: 'CB', notes: '', role: 'starter' });
    expect(dup.ok).toBe(true);
    if (!dup.ok) return;
    team = dup.team;
    const first = promoteFromPool(team, pool[0].id, 'starter');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = promoteFromPool(first.team, pool[1].id, 'starter');
    expect(second).toMatchObject({ ok: false, errors: { shirtNumber: expect.stringContaining(`#${pool[0].shirtNumber}`) } });
    expect(first.team.players).toHaveLength(1);
  });

  it('returns a player to the pool, freeing the slot', () => {
    const team = promoteN(presetMatch().home, 3, 'starter');
    const gone = team.players[0];
    const back = returnToPool(team, gone.id);
    expect(back.players.map((p) => p.id)).not.toContain(gone.id);
    expect(back.slots.some((s) => s.playerId === gone.id)).toBe(false);
    expect(getPool(back).map((p) => p.id)).toContain(gone.id);
    expect(validateSquadIntegrity(back)).toEqual([]);
  });

  it('validates pool edits like squad edits (name, number range, position)', () => {
    const team = presetMatch().home;
    const id = getPool(team)[0].id;
    const bad: PlayerDraft = { name: '  ', shirtNumber: 150, preferredPosition: 'ST', notes: '', role: 'starter' };
    const result = updatePoolPlayer(team, id, bad);
    expect(result).toMatchObject({ ok: false, errors: { name: expect.any(String), shirtNumber: expect.any(String) } });
    expect(updatePoolPlayer(team, 'nobody', { ...bad, name: 'x', shirtNumber: 5 }).ok).toBe(false);
  });

  it('reports a player that is both in the squad and in the pool', () => {
    const team = promoteN(presetMatch().home, 1, 'starter');
    const broken: Team = { ...team, pool: [...getPool(team), team.players[0]] };
    expect(validateSquadIntegrity(broken).map((i) => i.code)).toContain('duplicate-player-id');
  });
});

describe('squad pool through the reducer', () => {
  it('does not touch the original match object and keeps the other team as is', () => {
    const m = presetMatch();
    const id = getPool(m.home)[0].id;
    const next = matchReducer(m, { type: 'pool/promote', side: 'home', playerId: id, role: 'starter' });
    expect(next).not.toBe(m);
    expect(next.away).toBe(m.away);
    expect(m.home.players).toHaveLength(0);
    expect(next.home.players).toHaveLength(1);
  });

  it('returns the same state object for a refused promotion', () => {
    const m = presetMatch();
    expect(matchReducer(m, { type: 'pool/promote', side: 'home', playerId: 'nobody', role: 'starter' })).toBe(m);
  });

  it('will not return a player to the pool while a match event names them', () => {
    let m = presetMatch();
    const scorer = getPool(m.home)[0];
    m = matchReducer(m, { type: 'pool/promote', side: 'home', playerId: scorer.id, role: 'starter' });
    m = withEvents(m, goal(m, 'home', at(10), { scorer: scorer.id }));
    expect(eventsReferencingPlayer(m.events, scorer.id)).toHaveLength(1);
    expect(matchReducer(m, { type: 'pool/return', side: 'home', playerId: scorer.id })).toBe(m);
    expect(analyzeEvents(m).score).toEqual({ home: 1, away: 0 });
  });

  it('pool players never appear in the derived lineup', () => {
    const m = presetMatch();
    const lineups = analyzeEvents(m).lineups;
    expect(lineups.home.slots.every((s) => s.playerId === null)).toBe(true);
  });

  it('keeps preset provenance when a squad player is edited', () => {
    let m = presetMatch();
    const p = getPool(m.home)[0];
    m = matchReducer(m, { type: 'pool/promote', side: 'home', playerId: p.id, role: 'starter' });
    m = matchReducer(m, {
      type: 'player/update',
      side: 'home',
      playerId: p.id,
      draft: { name: 'Better Name', shirtNumber: p.shirtNumber, preferredPosition: p.preferredPosition, notes: '', role: 'starter' },
    });
    expect(m.home.players[0].name).toBe('Better Name');
    expect(m.home.players[0].origin?.imported.name).toBe(p.name);
  });
});

describe('custom teams are unaffected', () => {
  it('a manual match has no pool or preset and keeps the 22-player limit', () => {
    const m = createMatch();
    expect(m.home.pool).toBeUndefined();
    expect(m.home.preset).toBeUndefined();
    expect(getPool(m.home)).toEqual([]);
    // Adding a player the old way still works and creates no origin.
    const added = matchReducer(m, {
      type: 'player/add',
      side: 'home',
      playerId: 'p1',
      draft: { name: 'Walk-on', shirtNumber: 7, preferredPosition: 'CM', notes: '', role: 'starter' },
    });
    expect(added.home.players[0].origin).toBeUndefined();
    expect(added.home.pool).toBeUndefined();
  });

  it('presetPlayer fixtures are valid preset players', () => {
    expect(presetPlayer({ id: 'isl-player-1', name: 'X' }).verification).toBe('official');
  });
});
