import { describe, expect, it } from 'vitest';
import {
  createMatch,
  durationError,
  getSetupIssues,
  isValidDateString,
  isValidTimeString,
  matchDisplayName,
} from './match';

describe('createMatch', () => {
  it('starts with a 90-minute duration, scheduled status and two distinct teams', () => {
    const m = createMatch();
    expect(m.durationMinutes).toBe(90);
    expect(m.status).toBe('scheduled');
    expect(m.home.id).not.toBe(m.away.id);
    expect(m.home.players).toEqual([]);
    expect(Object.keys(m.officials).sort()).toEqual(['assistant1', 'assistant2', 'fourthOfficial', 'referee']);
  });
});

describe('matchDisplayName', () => {
  it('prefers the explicit name, then "Home vs Away", then a fallback', () => {
    const m = createMatch();
    expect(matchDisplayName(m)).toBe('Untitled match');
    m.home.name = 'Mumbai City';
    expect(matchDisplayName(m)).toBe('Mumbai City match');
    m.away.name = 'Kerala Blasters';
    expect(matchDisplayName(m)).toBe('Mumbai City vs Kerala Blasters');
    m.name = 'ISL Opener';
    expect(matchDisplayName(m)).toBe('ISL Opener');
  });
});

describe('date, time and duration validation', () => {
  it('accepts real dates only', () => {
    expect(isValidDateString('2026-10-10')).toBe(true);
    expect(isValidDateString('2026-02-30')).toBe(false);
    expect(isValidDateString('10/10/2026')).toBe(false);
  });
  it('accepts 24h times only', () => {
    expect(isValidTimeString('19:30')).toBe(true);
    expect(isValidTimeString('24:00')).toBe(false);
    expect(isValidTimeString('7:30')).toBe(false);
  });
  it('bounds duration', () => {
    expect(durationError(90)).toBeNull();
    expect(durationError(5)).toBeTruthy();
    expect(durationError(500)).toBeTruthy();
    expect(durationError(null)).toBeTruthy();
    expect(durationError(90.5)).toBeTruthy();
  });
});

describe('getSetupIssues', () => {
  it('lists incomplete items for a blank match without flagging errors', () => {
    const issues = getSetupIssues(createMatch());
    const ids = issues.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['home-name', 'away-name', 'date', 'kickoff', 'home-xi', 'away-xi']));
    expect(issues.every((i) => i.severity === 'incomplete')).toBe(true);
  });

  it('flags identical team names as an error on the away team', () => {
    const m = createMatch();
    m.home.name = 'FC Goa';
    m.away.name = ' fc goa ';
    const issue = getSetupIssues(m).find((i) => i.id === 'same-names');
    expect(issue).toMatchObject({ severity: 'error', scope: 'away' });
  });

  it('reports an invalid duration', () => {
    const m = { ...createMatch(), durationMinutes: 3 };
    expect(getSetupIssues(m).find((i) => i.id === 'duration')?.severity).toBe('error');
  });
});

describe('createMatch: clock and events', () => {
  it('starts with no events and a stopped pre-match clock', () => {
    const m = createMatch();
    expect(m.events).toEqual([]);
    expect(m.clock).toEqual({ period: 'notStarted', elapsedMs: 0, runningSinceEpochMs: null, endedPeriod: null });
  });
});
