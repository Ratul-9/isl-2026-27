import { describe, expect, it } from 'vitest';
import { at, card, goal, squadMatch, sub, withEvents } from './eventFixtures';
import {
  analyzeEvents,
  checkEventChange,
  checkEventDeletion,
  describeEvent,
  eventsReferencingPlayer,
  lineupsAt,
  sortEvents,
  timelineText,
} from './events';
import { computeScore } from './score';
import { MINUTE_MS } from './time';
import type { MatchEvent } from './types';

const errorsOf = (m: ReturnType<typeof squadMatch>, id: string) => analyzeEvents(m).byId.get(id)!.errors;
const warningsOf = (m: ReturnType<typeof squadMatch>, id: string) => analyzeEvents(m).byId.get(id)!.warnings;

describe('event ordering', () => {
  it('orders by period, then time, then insertion order', () => {
    const m = squadMatch();
    const late1H = goal(m, 'home', at(45, 2), { id: 'stoppage' }); // 47:00 in the first half
    const early2H = goal(m, 'home', at(46), { id: 'early2H' }); // 45:00 in the second half
    const a = goal(m, 'away', at(30), { id: 'a' });
    const b = goal(m, 'home', at(30), { id: 'b' }); // same minute, inserted later
    const htNote: MatchEvent = { id: 'note', type: 'note', text: 'Team talk', period: 'halfTime', matchTimeMs: 45 * MINUTE_MS };
    const order = sortEvents([early2H, b, htNote, late1H, a]).map((e) => e.id);
    // b and a share 30'; b was inserted (array position) before a. First-half
    // stoppage (47:00) precedes the half-time note, which precedes the 46'.
    expect(order).toEqual(['b', 'a', 'stoppage', 'note', 'early2H']);
  });

  it('keeps insertion order for events at the same moment', () => {
    const m = squadMatch();
    const first = sub(m, 'home', at(67), 'home-p9', 'home-s0', 'first');
    const second = sub(m, 'home', at(67), 'home-p8', 'home-s1', 'second');
    expect(sortEvents([first, second]).map((e) => e.id)).toEqual(['first', 'second']);
    expect(sortEvents([second, first]).map((e) => e.id)).toEqual(['second', 'first']);
  });
});

describe('goals and score', () => {
  it('derives the score from goal events', () => {
    const m = squadMatch();
    const match = withEvents(m, goal(m, 'home', at(10), { scorer: 'home-p9' }), goal(m, 'away', at(20), { scorer: 'away-p9' }), goal(m, 'home', at(80), { scorer: 'home-p8' }));
    expect(computeScore(match)).toEqual({ home: 2, away: 1 });
  });

  it('credits an own goal to the opposing team', () => {
    const m = squadMatch();
    // Away defender (away-p3) puts it into his own net: credited to HOME.
    const og = goal(m, 'home', at(33), { scorer: 'away-p3', type: 'ownGoal', id: 'og' });
    const match = withEvents(m, og);
    expect(computeScore(match)).toEqual({ home: 1, away: 0 });
    expect(errorsOf(match, 'og')).toEqual([]);
    expect(describeEvent(match, og)).toBe('Own goal: Right CB');
    expect(timelineText(match, analyzeEvents(match).byId.get('og')!)).toBe("33' | Home FC | Own goal: Right CB");
  });

  it('rejects an own goal whose player is on the credited team, lacks a player, or has an assist', () => {
    const m = squadMatch();
    const wrongSide = withEvents(m, goal(m, 'home', at(5), { scorer: 'home-p3', type: 'ownGoal', id: 'x' }));
    expect(errorsOf(wrongSide, 'x')).toContain('The own-goal player is not in the away squad.');
    expect(computeScore(wrongSide)).toEqual({ home: 0, away: 0 });
    const noPlayer = withEvents(m, goal(m, 'home', at(5), { type: 'ownGoal', id: 'y' }));
    expect(errorsOf(noPlayer, 'y')).toContain('An own goal needs the responsible player.');
    const assisted = withEvents(m, goal(m, 'home', at(5), { scorer: 'away-p3', assist: 'home-p9', type: 'ownGoal', id: 'z' }));
    expect(errorsOf(assisted, 'z')).toContain('An own goal cannot have an assist.');
  });

  it('allows missing scorers and assists', () => {
    const m = squadMatch();
    const match = withEvents(m, goal(m, 'home', at(12), { id: 'g1' }), goal(m, 'home', at(14), { scorer: 'home-p9', id: 'g2' }));
    expect(computeScore(match)).toEqual({ home: 2, away: 0 });
    expect(errorsOf(match, 'g1')).toEqual([]);
    expect(describeEvent(match, match.events[0])).toBe('Goal: scorer not recorded');
  });

  it('rejects scorers or assists from the wrong team and self-assists', () => {
    const m = squadMatch();
    const match = withEvents(
      m,
      goal(m, 'home', at(5), { scorer: 'away-p9', id: 'wrong' }),
      goal(m, 'home', at(6), { scorer: 'home-p9', assist: 'away-p8', id: 'wrongAssist' }),
      goal(m, 'home', at(7), { scorer: 'home-p9', assist: 'home-p9', id: 'self' }),
    );
    expect(errorsOf(match, 'wrong')).toContain('The scorer is not in the home squad.');
    expect(errorsOf(match, 'wrongAssist')).toContain('The assisting player is not in the home squad.');
    expect(errorsOf(match, 'self')).toContain('A player cannot assist their own goal.');
    expect(computeScore(match)).toEqual({ home: 0, away: 0 });
  });

  it('warns (but still counts the goal) when the scorer was not on the pitch', () => {
    const m = squadMatch();
    const match = withEvents(m, sub(m, 'home', at(60), 'home-p9', 'home-s0'), goal(m, 'home', at(70), { scorer: 'home-p9', id: 'g' }));
    expect(warningsOf(match, 'g')).toContain('The scorer was not on the pitch at this time.');
    expect(computeScore(match)).toEqual({ home: 1, away: 0 });
  });

  it('recomputes the score when a goal is edited or deleted', () => {
    const m = squadMatch();
    const g = goal(m, 'home', at(10), { scorer: 'home-p9', id: 'g' });
    const match = withEvents(m, g, goal(m, 'away', at(20), { scorer: 'away-p9' }));
    expect(computeScore(match)).toEqual({ home: 1, away: 1 });
    const edited = { ...g, teamId: m.away.id, scorerId: 'away-p8' };
    expect(computeScore(match, match.events.map((e) => (e.id === 'g' ? edited : e)))).toEqual({ home: 0, away: 2 });
    expect(computeScore(match, match.events.filter((e) => e.id !== 'g'))).toEqual({ home: 0, away: 1 });
  });

  it('rejects goals in breaks or outside the period', () => {
    const m = squadMatch();
    const inBreak: MatchEvent = { ...goal(m, 'home', at(10), { id: 'b' }), period: 'halfTime', matchTimeMs: 45 * MINUTE_MS };
    const outside: MatchEvent = { ...goal(m, 'home', at(10), { id: 'o' }), period: 'secondHalf', matchTimeMs: 10 * MINUTE_MS };
    const match = withEvents(m, inBreak, outside);
    expect(errorsOf(match, 'b')).toContain('This event must happen during a half.');
    expect(errorsOf(match, 'o')).toContain('The time is outside this period.');
    expect(computeScore(match)).toEqual({ home: 0, away: 0 });
  });
});

describe('substitutions and lineup reconstruction', () => {
  it('puts the substitute into the outgoing player’s slot and updates the bench', () => {
    const m = squadMatch();
    const match = withEvents(m, sub(m, 'home', at(67), 'home-p9', 'home-s0', 's'));
    const { home } = analyzeEvents(match).lineups;
    const strikerSlot = m.home.slots.find((x) => x.playerId === 'home-p9')!;
    const now = home.slots.find((x) => x.id === strikerSlot.id)!;
    expect(now).toMatchObject({ playerId: 'home-s0', position: strikerSlot.position, x: strikerSlot.x, y: strikerSlot.y });
    expect(home.onPitch).toHaveLength(11);
    expect(home.onPitch).not.toContain('home-p9');
    expect(home.bench).toEqual(['home-s1', 'home-s2']);
    expect(home.substitutedOff).toEqual(['home-p9']);
    expect(timelineText(match, analyzeEvents(match).byId.get('s')!)).toBe("67' | Home FC | Striker OFF, Sub 0 ON");
  });

  it('supports several substitutions in the same minute', () => {
    const m = squadMatch();
    const match = withEvents(m, sub(m, 'home', at(75), 'home-p9', 'home-s0'), sub(m, 'home', at(75), 'home-p8', 'home-s1'), sub(m, 'home', at(75), 'home-p10', 'home-s2'));
    const a = analyzeEvents(match);
    expect(a.ordered.every((e) => e.errors.length === 0)).toBe(true);
    expect(a.lineups.home.bench).toEqual([]);
    expect(a.lineups.home.substitutionsMade).toBe(3);
    expect(new Set(a.lineups.home.onPitch).size).toBe(11);
  });

  it('rejects invalid substitutions and leaves the lineup untouched', () => {
    const m = squadMatch();
    const match = withEvents(
      m,
      sub(m, 'home', at(50), 'home-s0', 'home-s1', 'outNotOnPitch'),
      sub(m, 'home', at(51), 'home-p9', 'home-p8', 'inIsStarter'),
      sub(m, 'home', at(52), 'home-p9', 'away-s0', 'otherTeam'),
      sub(m, 'home', at(53), 'home-p9', 'home-s0', 'ok'),
      sub(m, 'home', at(54), 'home-s0', 'home-p9', 'returning'),
      sub(m, 'home', at(55), 'home-p9', 'home-s1', 'outAlreadyOff'),
    );
    const a = analyzeEvents(match);
    expect(a.byId.get('outNotOnPitch')!.errors).toContain('The outgoing player is not on the pitch at this time.');
    expect(a.byId.get('inIsStarter')!.errors).toContain('The incoming player is already on the pitch.');
    expect(a.byId.get('otherTeam')!.errors).toContain('The incoming player is not in this squad.');
    expect(a.byId.get('ok')!.errors).toEqual([]);
    expect(a.byId.get('returning')!.errors).toContain('The incoming player was substituted off and cannot return.');
    expect(a.byId.get('outAlreadyOff')!.errors).toContain('The outgoing player has already been substituted off.');
    expect(a.lineups.home.substitutionsMade).toBe(1);
    expect(a.lineups.home.onPitch).toContain('home-s0');
    expect(a.lineups.home.bench).toEqual(['home-s1', 'home-s2']);
  });

  it('allows a substitute who came on to be substituted off later', () => {
    const m = squadMatch();
    const match = withEvents(m, sub(m, 'home', at(46), 'home-p9', 'home-s0'), sub(m, 'home', at(80), 'home-s0', 'home-s1'));
    const a = analyzeEvents(match);
    expect(a.ordered.every((e) => e.errors.length === 0)).toBe(true);
    expect(a.lineups.home.onPitch).toContain('home-s1');
    expect(a.lineups.home.onPitch).not.toContain('home-s0');
  });

  it('applies events in match order regardless of the order they were entered', () => {
    const m = squadMatch();
    // The 80' sub depends on the 46' sub, but was entered first.
    const match = withEvents(m, sub(m, 'home', at(80), 'home-s0', 'home-s1', 'late'), sub(m, 'home', at(46), 'home-p9', 'home-s0', 'early'));
    expect(analyzeEvents(match).ordered.map((e) => [e.event.id, e.errors.length])).toEqual([
      ['early', 0],
      ['late', 0],
    ]);
  });

  it('reports the lineup at a given moment', () => {
    const m = squadMatch();
    const match = withEvents(m, sub(m, 'home', at(60), 'home-p9', 'home-s0'));
    const before = lineupsAt(match, at(59).period, at(59).matchTimeMs);
    const atSub = lineupsAt(match, at(60).period, at(60).matchTimeMs);
    expect(before.home.onPitch).toContain('home-p9');
    expect(atSub.home.onPitch).toContain('home-s0');
  });
});

describe('historical corrections', () => {
  it('flags later events invalidated by an edited substitution, never duplicating players', () => {
    const m = squadMatch();
    const first = sub(m, 'home', at(60), 'home-p9', 'home-s0', 'first');
    const second = sub(m, 'home', at(80), 'home-s0', 'home-s1', 'second');
    const match = withEvents(m, first, second);

    // Correct the 60' sub: it was actually home-s2 who came on.
    const corrected = { ...first, inPlayerId: 'home-s2' } as MatchEvent;
    const check = checkEventChange(match, corrected);
    expect(check.errors).toEqual([]);
    expect(check.newlyInvalid.map((a) => a.event.id)).toEqual(['second']);

    const after = withEvents(m, corrected, second);
    const a = analyzeEvents(after);
    expect(a.byId.get('second')!.errors).toContain('The outgoing player is not on the pitch at this time.');
    const { onPitch, bench } = a.lineups.home;
    expect(new Set(onPitch).size).toBe(onPitch.length);
    expect(onPitch).toHaveLength(11);
    expect(onPitch.filter((id) => bench.includes(id))).toEqual([]);
    expect(onPitch).toContain('home-s2');
    expect(bench).toEqual(['home-s0', 'home-s1']);
  });

  it('refuses an edit that makes the edited event itself invalid', () => {
    const m = squadMatch();
    const first = sub(m, 'home', at(60), 'home-p9', 'home-s0', 'first');
    const match = withEvents(m, first);
    expect(checkEventChange(match, { ...first, inPlayerId: 'home-p8' } as MatchEvent).errors).toContain(
      'The incoming player is already on the pitch.',
    );
  });

  it('reports events that a deletion would invalidate', () => {
    const m = squadMatch();
    const match = withEvents(m, sub(m, 'home', at(60), 'home-p9', 'home-s0', 'first'), sub(m, 'home', at(80), 'home-s0', 'home-s1', 'second'));
    expect(checkEventDeletion(match, 'first').map((a) => a.event.id)).toEqual(['second']);
    expect(checkEventDeletion(match, 'second')).toEqual([]);
  });

  it('accepts a new event at a historical time and validates it against the state then', () => {
    const m = squadMatch();
    const match = withEvents(m, sub(m, 'home', at(70), 'home-p9', 'home-s0'));
    // A goal by home-p9 at 50' is fine (he was still on); at 75' it warns.
    expect(checkEventChange(match, goal(m, 'home', at(50), { scorer: 'home-p9' })).warnings).toEqual([]);
    expect(checkEventChange(match, goal(m, 'home', at(75), { scorer: 'home-p9' })).warnings).toContain(
      'The scorer was not on the pitch at this time.',
    );
  });
});

describe('cards', () => {
  it('removes a red-carded player without replacement', () => {
    const m = squadMatch();
    const match = withEvents(m, card(m, 'away', at(30), 'away-p4', 'red'));
    const { away } = analyzeEvents(match).lineups;
    expect(away.onPitch).toHaveLength(10);
    expect(away.sentOff).toEqual(['away-p4']);
    expect(away.slots.filter((s) => s.playerId === null)).toHaveLength(1);
  });

  it('treats a second yellow as a sending-off and blocks further events for that player', () => {
    const m = squadMatch();
    const match = withEvents(
      m,
      card(m, 'home', at(20), 'home-p5', 'yellow', 'y1'),
      card(m, 'home', at(70), 'home-p5', 'yellow', 'y2'),
      card(m, 'home', at(75), 'home-p5', 'red', 'again'),
      sub(m, 'home', at(80), 'home-p5', 'home-s0', 'subOff'),
    );
    const a = analyzeEvents(match);
    expect(a.byId.get('y2')!.warnings).toContain('Second yellow card: the player is sent off.');
    expect(a.byId.get('again')!.errors).toContain('This player has already been sent off.');
    expect(a.byId.get('subOff')!.errors).toContain('The outgoing player has been sent off.');
    expect(a.lineups.home.onPitch).toHaveLength(10);
    expect(a.lineups.home.yellowCards['home-p5']).toBe(2);
  });

  it('stops a red-carded substitute from coming on', () => {
    const m = squadMatch();
    const match = withEvents(m, card(m, 'home', at(40), 'home-s0', 'red'), sub(m, 'home', at(60), 'home-p9', 'home-s0', 's'));
    expect(errorsOf(match, 's')).toContain('The incoming player has been sent off.');
  });
});

describe('other events and references', () => {
  it('validates notes and period markers', () => {
    const m = squadMatch();
    const blank: MatchEvent = { id: 'n', type: 'note', text: '   ', ...at(10) };
    const marker: MatchEvent = { id: 'k', type: 'periodMarker', marker: 'kickoff', period: 'firstHalf', matchTimeMs: 0 };
    const match = withEvents(m, blank, marker);
    expect(errorsOf(match, 'n')).toContain('A note needs some text.');
    expect(errorsOf(match, 'k')).toEqual([]);
    expect(describeEvent(match, marker)).toBe('Kick-off');
    expect(analyzeEvents(match).byId.get('k')!.minute).toBe("1'");
  });

  it('finds every event mentioning a player', () => {
    const m = squadMatch();
    const events = [goal(m, 'home', at(10), { scorer: 'home-p9', assist: 'home-p8' }), sub(m, 'home', at(60), 'home-p9', 'home-s0'), card(m, 'home', at(70), 'home-s0', 'yellow')];
    expect(eventsReferencingPlayer(events, 'home-p9')).toHaveLength(2);
    expect(eventsReferencingPlayer(events, 'home-p8')).toHaveLength(1);
    expect(eventsReferencingPlayer(events, 'home-s0')).toHaveLength(2);
    expect(eventsReferencingPlayer(events, 'home-p1')).toHaveLength(0);
  });

  it('warns when a referenced player has since left the squad', () => {
    const m = squadMatch();
    const g = goal(m, 'home', at(10), { scorer: 'ghost', id: 'g' });
    const match = withEvents(m, g);
    expect(warningsOf(match, 'g')).toContain('The scorer is no longer in either squad.');
    expect(describeEvent(match, g)).toBe('Goal: Unknown player');
  });
});
