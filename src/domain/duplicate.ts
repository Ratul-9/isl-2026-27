import type { Drawing, FormationRef, Id, LineupSlot, Match, MatchEvent, Player, SavedLayout, TacticalReplay, Team } from './types';

/**
 * Copies a match under fresh ids, remapping every reference so the copy is
 * fully independent of (and structurally identical to) the original.
 *
 * `newId` is injected (domain code never generates randomness itself). One
 * original id always maps to the same new id, including dangling references
 * (e.g. an event naming a removed player), so relationships are preserved.
 */
export function cloneMatchWithNewIds(match: Match, newId: (prefix: string) => Id): Match {
  const map = new Map<Id, Id>();
  const fresh = (prefix: string, id: Id): Id => {
    let next = map.get(id);
    if (next === undefined) {
      next = newId(prefix);
      map.set(id, next);
    }
    return next;
  };
  const team = (id: Id) => fresh('team', id);
  const playerRef = (id: Id) => fresh('plr', id);
  const optionalPlayer = (id: Id | undefined) => (id === undefined ? undefined : playerRef(id));

  const slot = (s: LineupSlot): LineupSlot => ({
    ...s,
    id: fresh('slot', s.id),
    playerId: s.playerId === null ? null : playerRef(s.playerId),
  });
  // Preset provenance is copied (not shared) so the duplicate is fully independent of the original.
  const player = (p: Player): Player => {
    const next: Player = { ...p, id: playerRef(p.id) };
    if (p.origin) next.origin = { ...p.origin, imported: { ...p.origin.imported } };
    return next;
  };
  const formation = (f: FormationRef): FormationRef =>
    f.kind === 'saved' ? { kind: 'saved', id: fresh('layout', f.id) } : f;
  const cloneTeam = (t: Team): Team => {
    const next: Team = {
      ...t,
      id: team(t.id),
      players: t.players.map(player),
      slots: t.slots.map(slot),
      bench: t.bench.map(playerRef),
      formation: formation(t.formation),
    };
    if (t.pool) next.pool = t.pool.map(player);
    if (t.preset) next.preset = { ...t.preset, coach: t.preset.coach ? { ...t.preset.coach } : null };
    return next;
  };

  const drawing = (d: Drawing): Drawing => {
    const next: Drawing = { ...d, id: fresh('drw', d.id), from: { ...d.from }, to: { ...d.to } };
    if (d.points) next.points = d.points.map((p) => ({ ...p }));
    if (d.fromPlayerId !== undefined) next.fromPlayerId = playerRef(d.fromPlayerId);
    if (d.toPlayerId !== undefined) next.toPlayerId = playerRef(d.toPlayerId);
    if (d.source) next.source = { ...d.source, teamId: team(d.source.teamId) };
    return next;
  };

  const layout = (l: SavedLayout): SavedLayout => ({
    ...l,
    id: fresh('layout', l.id),
    slots: l.slots.map((s) => ({ ...s })),
  });

  const event = (e: MatchEvent): MatchEvent => {
    const id = fresh('evt', e.id);
    switch (e.type) {
      case 'goal': {
        const next = { ...e, id, teamId: team(e.teamId) };
        if (e.scorerId !== undefined) next.scorerId = optionalPlayer(e.scorerId);
        if (e.assistId !== undefined) next.assistId = optionalPlayer(e.assistId);
        return next;
      }
      case 'substitution':
        return { ...e, id, teamId: team(e.teamId), outPlayerId: playerRef(e.outPlayerId), inPlayerId: playerRef(e.inPlayerId) };
      case 'yellowCard':
      case 'redCard':
        return { ...e, id, teamId: team(e.teamId), playerId: playerRef(e.playerId) };
      case 'note':
        return e.teamId === undefined ? { ...e, id } : { ...e, id, teamId: team(e.teamId) };
      case 'periodMarker':
        return { ...e, id };
    }
  };

  // Replay-internal ids (actors, keyframes, arrows, labels) get fresh ids too, and every reference between
  // them is remapped with the same table; links to squad players follow the copied players. The analysis
  // kept in `original` uses its own local labels, not entity ids, and is copied verbatim.
  const replay = (r: TacticalReplay): TacticalReplay => {
    const actor = (id: Id) => fresh('act', id);
    const optionalActor = (id: Id | null) => (id === null ? null : actor(id));
    return {
      ...r,
      id: fresh('rpl', r.id),
      actors: r.actors.map((a) => ({ ...a, id: actor(a.id), playerId: a.playerId === null ? null : playerRef(a.playerId) })),
      keyframes: r.keyframes.map((k) => ({
        ...k,
        id: fresh('kf', k.id),
        positions: Object.fromEntries(Object.entries(k.positions).map(([id, p]) => [actor(id), { ...p }])),
      })),
      paths: r.paths.map((p) => ({
        ...p,
        id: fresh('path', p.id),
        from: { ...p.from },
        to: { ...p.to },
        fromActorId: optionalActor(p.fromActorId),
        toActorId: optionalActor(p.toActorId),
      })),
      annotations: r.annotations.map((a) => ({ ...a, id: fresh('note', a.id), point: a.point ? { ...a.point } : null })),
      event: { ...r.event, evidence: [...r.event.evidence], uncertainty: [...r.event.uncertainty] },
      source: r.source ? { ...r.source } : null,
      original: r.original === null ? null : structuredClone(r.original),
      // Tracking data is copied whole; only links to squad players are remapped to the copy's players.
      tracking: r.tracking === null
        ? null
        : { ...structuredClone(r.tracking), tracks: r.tracking.tracks.map((t) => ({ ...structuredClone(t), playerId: t.playerId === null ? null : playerRef(t.playerId) })) },
    };
  };

  // Teams first so saved-layout and team ids are allocated before references to them.
  const home = cloneTeam(match.home);
  const away = cloneTeam(match.away);
  return {
    ...match,
    id: fresh('match', match.id),
    officials: { ...match.officials },
    home,
    away,
    savedLayouts: match.savedLayouts.map(layout),
    drawings: match.drawings.map(drawing),
    events: match.events.map(event),
    clock: { ...match.clock },
    replays: match.replays.map(replay),
  };
}
