import { describe, expect, it } from 'vitest';
import { analyzeEvents } from '@/domain/events';
import { at, goal, squadMatch, sub, withEvents } from '@/domain/eventFixtures';
import { advancePeriod } from '@/domain/clock';
import { MINUTE_MS } from '@/domain/time';
import {
  buildCandidate,
  formStateFromEvent,
  initialFormState,
  lineupAtMoment,
  playerGroups,
  whenPreview,
} from './eventFormModel';

const T0 = Date.UTC(2026, 9, 10, 19, 30);
const live = () => {
  const m = squadMatch();
  return { ...m, clock: advancePeriod(m.clock, 'firstHalf', T0, 90)!.clock };
};

describe('initial state', () => {
  it('defaults to the live minute and keeps the exact time', () => {
    const m = live();
    const s = initialFormState('goal', m, T0 + 12 * MINUTE_MS + 20_000);
    expect(s).toMatchObject({ kind: 'goal', side: 'home', period: 'firstHalf', minute: '13', added: '0' });
    expect(buildCandidate(m, s, 'x').matchTimeMs).toBe(12 * MINUTE_MS + 20_000);
  });

  it('defaults half-time events to the start of the second half; notes have no team', () => {
    const m = squadMatch();
    const ht = {
      ...m,
      clock: { period: 'halfTime' as const, elapsedMs: 45 * MINUTE_MS, runningSinceEpochMs: null, endedPeriod: 'firstHalf' as const },
    };
    expect(initialFormState('substitution', ht, T0)).toMatchObject({ period: 'secondHalf', minute: '46' });
    expect(initialFormState('note', m, T0).side).toBe('');
  });
});

describe('buildCandidate', () => {
  it('reports what is missing instead of building a partial event', () => {
    const m = live();
    const s = initialFormState('substitution', m, T0);
    expect(buildCandidate(m, s, 'x')).toMatchObject({
      event: null,
      problems: ['Choose the outgoing player.', 'Choose the incoming player.'],
    });
    expect(buildCandidate(m, { ...s, minute: 'abc' }, 'x').problems).toContain('Enter a valid minute (and added time, if any).');
  });

  it('builds goals with optional scorer and assist, and drops the assist for own goals', () => {
    const m = live();
    const base = initialFormState('goal', m, T0);
    const normal = buildCandidate(m, { ...base, scorerId: 'home-p9', assistId: 'home-p8' }, 'g').event!;
    expect(normal).toMatchObject({ type: 'goal', teamId: m.home.id, scorerId: 'home-p9', assistId: 'home-p8', goalType: 'normal' });
    const anonymous = buildCandidate(m, base, 'g').event!;
    expect('scorerId' in anonymous).toBe(false);
    const own = buildCandidate(m, { ...base, goalType: 'ownGoal', scorerId: 'away-p3', assistId: 'home-p8' }, 'g');
    expect(own.event).toMatchObject({ type: 'goal', teamId: m.home.id, scorerId: 'away-p3', goalType: 'ownGoal' });
    expect('assistId' in own.event!).toBe(false);
    expect(buildCandidate(m, { ...base, goalType: 'ownGoal' }, 'g').problems).toContain(
      'Choose the player who scored the own goal.',
    );
  });

  it('builds substitutions, cards and notes', () => {
    const m = live();
    const s = initialFormState('substitution', m, T0 + 60 * MINUTE_MS);
    expect(buildCandidate(m, { ...s, outId: 'home-p9', inId: 'home-s0', reason: ' injury ' }, 's').event).toMatchObject({
      type: 'substitution',
      outPlayerId: 'home-p9',
      inPlayerId: 'home-s0',
      reason: 'injury',
    });
    const c = initialFormState('card', m, T0);
    expect(buildCandidate(m, { ...c, side: 'away', card: 'red', playerId: 'away-p4' }, 'c').event).toMatchObject({
      type: 'redCard',
      teamId: m.away.id,
      playerId: 'away-p4',
    });
    const n = initialFormState('note', m, T0);
    expect(buildCandidate(m, { ...n, text: '  VAR check  ' }, 'n').event).toMatchObject({ type: 'note', text: 'VAR check' });
    expect(buildCandidate(m, n, 'n').problems).toContain('Write the note.');
  });

  it('round-trips an existing event through the form', () => {
    const m = squadMatch();
    const original = goal(m, 'away', at(77), { scorer: 'away-p9', assist: 'away-p8', type: 'header', id: 'g' });
    const form = formStateFromEvent(m, original);
    expect(form).toMatchObject({ kind: 'goal', side: 'away', goalType: 'header', minute: '77' });
    expect(buildCandidate(m, form, 'g').event).toEqual(original);
    const s = sub(m, 'home', at(60), 'home-p9', 'home-s0', 's');
    expect(buildCandidate(m, formStateFromEvent(m, s), 's').event).toEqual(s);
  });
});

describe('player groups', () => {
  it('offers only on-pitch players to go off and only available substitutes to come on', () => {
    const m = withEvents(squadMatch(), sub(squadMatch(), 'home', at(50), 'home-p9', 'home-s0', 'first'));
    const lineups = lineupAtMoment(m, undefined, 'secondHalf', at(60).matchTimeMs);
    const out = playerGroups(m, 'home', lineups.home, 'outgoing');
    const inn = playerGroups(m, 'home', lineups.home, 'incoming');
    expect(out).toHaveLength(1);
    expect(out[0].players.map((p) => p.id)).toContain('home-s0');
    expect(out[0].players.map((p) => p.id)).not.toContain('home-p9');
    expect(inn[0].players.map((p) => p.id)).toEqual(['home-s1', 'home-s2']);
  });

  it('excludes the event being edited from the lineup it is validated against', () => {
    const base = squadMatch();
    const first = sub(base, 'home', at(50), 'home-p9', 'home-s0', 'first');
    const m = withEvents(base, first);
    // Editing `first`: home-p9 must still be offered as outgoing.
    const lineups = lineupAtMoment(m, 'first', first.period, first.matchTimeMs);
    expect(playerGroups(m, 'home', lineups.home, 'outgoing')[0].players.map((p) => p.id)).toContain('home-p9');
    // Not excluding it hides him.
    const without = lineupAtMoment(m, undefined, first.period, first.matchTimeMs);
    expect(playerGroups(m, 'home', without.home, 'outgoing')[0].players.map((p) => p.id)).not.toContain('home-p9');
  });

  it('keeps sent-off players out of the card list but lists them for scorers', () => {
    const m = withEvents(squadMatch(), { id: 'r', type: 'redCard', teamId: squadMatch().home.id, playerId: 'home-p5', ...at(30) });
    const lineups = analyzeEvents(m).lineups;
    const cards = playerGroups(m, 'home', lineups.home, 'card').flatMap((g) => g.players.map((p) => p.id));
    expect(cards).not.toContain('home-p5');
    expect(cards).toContain('home-s0');
  });
});

describe('preview', () => {
  it('shows football notation for the chosen time', () => {
    const m = squadMatch();
    expect(whenPreview(m, 'firstHalf', 46 * MINUTE_MS)).toBe("45+2'");
    expect(whenPreview(m, 'secondHalf', null)).toBeNull();
  });
});
