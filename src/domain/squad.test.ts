import { describe, expect, it } from 'vitest';
import {
  addPlayer,
  defaultRoleForNewPlayer,
  emptyPlayerDraft,
  getPlayerRole,
  getSquadCounts,
  getStarters,
  getSubstitutes,
  MAX_PLAYERS,
  MAX_STARTERS,
  MAX_SUBSTITUTES,
  removePlayer,
  setSlotPosition,
  setLineupRole,
  updatePlayer,
  validatePlayerDraft,
  validateRoleChange,
  validateSquadIntegrity,
} from './squad';
import type { PlayerDraft } from './squad';
import { emptyTeam } from './testing';
import type { Team } from './types';

let counter = 0;
function nextId() {
  counter += 1;
  return `plr${counter}`;
}

const filled = (team: Team) => team.slots.filter((s) => s.playerId !== null);

function draft(overrides: Partial<PlayerDraft> = {}): PlayerDraft {
  return {
    name: 'A Player',
    shirtNumber: 7,
    preferredPosition: 'ST',
    notes: '',
    role: 'starter',
    ...overrides,
  };
}

function add(team: Team, overrides: Partial<PlayerDraft> = {}): Team {
  const result = addPlayer(team, draft(overrides), nextId());
  if (!result.ok) throw new Error(`add failed: ${JSON.stringify(result.errors)}`);
  return result.team;
}

/** Fill a team with `starters` starters (#1..) and `subs` substitutes (#starters+1..). */
function squad(starters: number, subs: number): Team {
  let team = emptyTeam();
  for (let i = 1; i <= starters; i++) team = add(team, { name: `S${i}`, shirtNumber: i, role: 'starter' });
  for (let i = 1; i <= subs; i++) {
    team = add(team, { name: `B${i}`, shirtNumber: starters + i, role: 'substitute' });
  }
  return team;
}

describe('addPlayer', () => {
  it('puts a starter into the best-fitting empty slot', () => {
    const team = add(emptyTeam(), { preferredPosition: 'GK', shirtNumber: 1 });
    expect(team.players).toHaveLength(1);
    expect(team.slots).toHaveLength(11);
    expect(filled(team)).toEqual([expect.objectContaining({ playerId: team.players[0].id, position: 'GK' })]);
    expect(team.bench).toEqual([]);
  });

  it('prefers exact position, then family, and keeps outfielders out of the GK slot', () => {
    let team = add(emptyTeam(), { name: 'Nine', shirtNumber: 9, preferredPosition: 'ST' });
    expect(filled(team)[0].position).toBe('ST');
    team = add(team, { name: 'CF', shirtNumber: 10, preferredPosition: 'CF' });
    // ST slot taken; CF falls back to another attacker, not the goalkeeper slot.
    const cfSlot = team.slots.find((s) => s.playerId === team.players[1].id);
    expect(cfSlot?.position).not.toBe('GK');
    expect(['LW', 'RW']).toContain(cfSlot?.position);
  });

  it('registers a substitute on the bench without filling a slot', () => {
    const team = add(emptyTeam(), { role: 'substitute' });
    expect(filled(team)).toHaveLength(0);
    expect(team.bench).toEqual([team.players[0].id]);
  });

  it('trims name and notes', () => {
    const team = add(emptyTeam(), { name: '  Ada Lovelace  ', notes: ' left foot ' });
    expect(team.players[0]).toMatchObject({ name: 'Ada Lovelace', notes: 'left foot' });
  });

  it('returns errors and does not mutate on invalid input', () => {
    const team = emptyTeam();
    const result = addPlayer(team, draft({ name: '   ' }), nextId());
    expect(result.ok).toBe(false);
    expect(team.players).toHaveLength(0);
  });
});

describe('validatePlayerDraft', () => {
  it('requires a name', () => {
    expect(validatePlayerDraft(emptyTeam(), draft({ name: '' })).name).toBeTruthy();
  });

  it('requires a whole shirt number between 1 and 99', () => {
    const team = emptyTeam();
    expect(validatePlayerDraft(team, draft({ shirtNumber: null })).shirtNumber).toBeTruthy();
    expect(validatePlayerDraft(team, draft({ shirtNumber: 0 })).shirtNumber).toBeTruthy();
    expect(validatePlayerDraft(team, draft({ shirtNumber: 100 })).shirtNumber).toBeTruthy();
    expect(validatePlayerDraft(team, draft({ shirtNumber: 7.5 })).shirtNumber).toBeTruthy();
    expect(validatePlayerDraft(team, draft({ shirtNumber: 99 })).shirtNumber).toBeUndefined();
    expect(validatePlayerDraft(team, draft({ shirtNumber: 1 })).shirtNumber).toBeUndefined();
  });

  it('rejects a duplicate shirt number within the same team', () => {
    const team = add(emptyTeam(), { name: 'Existing', shirtNumber: 9 });
    const errors = validatePlayerDraft(team, draft({ shirtNumber: 9 }));
    expect(errors.shirtNumber).toMatch(/already worn by Existing/);
  });

  it('allows the same shirt number in different teams', () => {
    const home = add(emptyTeam('home'), { shirtNumber: 10 });
    const away = emptyTeam('away');
    expect(home.players[0].shirtNumber).toBe(10);
    expect(validatePlayerDraft(away, draft({ shirtNumber: 10 })).shirtNumber).toBeUndefined();
  });

  it('lets a player keep their own shirt number when editing', () => {
    const team = add(emptyTeam(), { shirtNumber: 9 });
    const id = team.players[0].id;
    expect(validatePlayerDraft(team, draft({ shirtNumber: 9 }), id)).toEqual({});
  });

  it('rejects a 23rd player', () => {
    const team = squad(11, 11);
    expect(team.players).toHaveLength(MAX_PLAYERS);
    const errors = validatePlayerDraft(team, draft({ shirtNumber: 50, role: 'substitute' }));
    expect(errors.form).toMatch(/at most 22/);
  });

  it('rejects a 12th starter and a 12th substitute', () => {
    const fullXI = squad(MAX_STARTERS, 0);
    expect(validatePlayerDraft(fullXI, draft({ shirtNumber: 50, role: 'starter' })).role).toBeTruthy();
    expect(validatePlayerDraft(fullXI, draft({ shirtNumber: 50, role: 'substitute' })).role).toBeUndefined();

    const fullBench = squad(0, MAX_SUBSTITUTES);
    expect(validatePlayerDraft(fullBench, draft({ shirtNumber: 50, role: 'substitute' })).role).toBeTruthy();
  });
});

describe('defaultRoleForNewPlayer', () => {
  it('is starter until the XI is full, then substitute', () => {
    expect(defaultRoleForNewPlayer(emptyTeam())).toBe('starter');
    expect(defaultRoleForNewPlayer(squad(10, 0))).toBe('starter');
    expect(defaultRoleForNewPlayer(squad(11, 0))).toBe('substitute');
    expect(emptyPlayerDraft(squad(11, 0)).role).toBe('substitute');
  });
});

describe('updatePlayer', () => {
  it('keeps the player id while changing name and number', () => {
    const team = add(emptyTeam(), { name: 'Old', shirtNumber: 4 });
    const id = team.players[0].id;
    const result = updatePlayer(team, id, draft({ name: 'New', shirtNumber: 44 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.team.players[0]).toMatchObject({ id, name: 'New', shirtNumber: 44 });
    expect(getPlayerRole(result.team, id)).toBe('starter');
  });

  it('preserves a manual lineup-position override when the role is unchanged', () => {
    let team = add(emptyTeam(), { preferredPosition: 'CM' });
    const id = team.players[0].id;
    const slotId = filled(team)[0].id;
    team = setSlotPosition(team, slotId, 'CAM');
    const result = updatePlayer(team, id, draft({ preferredPosition: 'CM', name: 'Renamed' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.team.slots.find((s) => s.id === slotId)).toMatchObject({ playerId: id, position: 'CAM' });
  });

  it('moves a starter to the bench when the role changes', () => {
    const team = add(emptyTeam(), {});
    const id = team.players[0].id;
    const result = updatePlayer(team, id, draft({ role: 'substitute' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(filled(result.team)).toHaveLength(0);
    expect(result.team.slots).toHaveLength(11);
    expect(result.team.bench).toEqual([id]);
  });

  it('rejects a clash with another player but not with itself', () => {
    let team = add(emptyTeam(), { name: 'One', shirtNumber: 1 });
    team = add(team, { name: 'Two', shirtNumber: 2 });
    const two = team.players[1].id;
    expect(updatePlayer(team, two, draft({ name: 'Two', shirtNumber: 1 })).ok).toBe(false);
    expect(updatePlayer(team, two, draft({ name: 'Two', shirtNumber: 2 })).ok).toBe(true);
  });
});

describe('lineup roles', () => {
  it('prevents a player appearing in more than one slot or in both lists', () => {
    let team = squad(3, 2);
    const starterId = filled(team)[0].playerId as string;
    const benchId = team.bench[0];
    // Repeated role changes must never duplicate.
    for (let i = 0; i < 3; i++) {
      const toBench = setLineupRole(team, starterId, 'substitute');
      if (toBench.ok) team = toBench.team;
      const toXI = setLineupRole(team, starterId, 'starter');
      if (toXI.ok) team = toXI.team;
    }
    const toXI = setLineupRole(team, benchId, 'starter');
    if (toXI.ok) team = toXI.team;
    expect(validateSquadIntegrity(team)).toEqual([]);
    expect(team.slots.filter((s) => s.playerId === starterId)).toHaveLength(1);
  });

  it('refuses to promote a substitute into a full XI', () => {
    const team = squad(MAX_STARTERS, 1);
    const sub = team.bench[0];
    const result = setLineupRole(team, sub, 'starter');
    expect(result.ok).toBe(false);
    expect(validateRoleChange(team, sub, 'starter').role).toBeTruthy();
  });

  it('refuses to demote a starter into a full bench', () => {
    const team = squad(5, MAX_SUBSTITUTES);
    const starter = filled(team)[0].playerId as string;
    expect(setLineupRole(team, starter, 'substitute').ok).toBe(false);
  });

  it('is a no-op when the role already matches', () => {
    const team = squad(2, 0);
    const result = setLineupRole(team, team.players[0].id, 'starter');
    expect(result.ok && result.team).toBe(team);
  });
});

describe('removePlayer', () => {
  it('removes the player from the squad, slot and bench', () => {
    const team = squad(2, 2);
    const starter = filled(team)[0].playerId as string;
    const sub = team.bench[0];
    const next = removePlayer(removePlayer(team, starter), sub);
    expect(next.players.map((p) => p.id)).not.toContain(starter);
    expect(next.slots.map((s) => s.playerId)).not.toContain(starter);
    expect(next.bench).not.toContain(sub);
    expect(validateSquadIntegrity(next)).toEqual([]);
  });
});

describe('views', () => {
  it('sorts starters goalkeeper first and counts roles', () => {
    let team = emptyTeam();
    team = add(team, { name: 'Striker', shirtNumber: 9, preferredPosition: 'ST' });
    team = add(team, { name: 'Keeper', shirtNumber: 1, preferredPosition: 'GK' });
    team = add(team, { name: 'Back', shirtNumber: 2, preferredPosition: 'RB' });
    team = add(team, { name: 'Sub', shirtNumber: 12, role: 'substitute' });
    expect(getStarters(team).map((s) => s.player.name)).toEqual(['Keeper', 'Back', 'Striker']);
    expect(getSubstitutes(team).map((p) => p.name)).toEqual(['Sub']);
    expect(getSquadCounts(team)).toEqual({ total: 4, starters: 3, substitutes: 1 });
  });
});

describe('validateSquadIntegrity', () => {
  it('flags duplicate shirt numbers, double slots and bench/XI overlap', () => {
    const team: Team = {
      ...emptyTeam(),
      players: [
        { id: 'a', name: 'A', shirtNumber: 5, preferredPosition: 'CB', notes: '' },
        { id: 'b', name: 'B', shirtNumber: 5, preferredPosition: 'CB', notes: '' },
      ],
      slots: [
        { id: 's1', playerId: 'a', position: 'CB', x: 0.2, y: 0.4 },
        { id: 's1', playerId: 'a', position: 'CB', x: 1.2, y: 0.6 },
      ],
      bench: ['a', 'b', 'b'],
    };
    const codes = validateSquadIntegrity(team).map((i) => i.code);
    expect(codes).toContain('duplicate-shirt-number');
    expect(codes).toContain('player-in-multiple-slots');
    expect(codes).toContain('player-on-bench-and-in-xi');
    expect(codes).toContain('duplicate-bench-entry');
    expect(codes).toContain('invalid-slot-count');
    expect(codes).toContain('duplicate-slot-id');
    expect(codes).toContain('slot-out-of-bounds');
  });

  it('flags a player that is neither starter nor substitute', () => {
    const team: Team = {
      ...emptyTeam(),
      players: [{ id: 'a', name: 'A', shirtNumber: 5, preferredPosition: 'CB', notes: '' }],
    };
    expect(validateSquadIntegrity(team).map((i) => i.code)).toEqual(['player-without-role']);
  });
});
