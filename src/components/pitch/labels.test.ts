import { describe, expect, it } from 'vitest';
import { compactName } from './labels';

describe('compactName', () => {
  it('uses the surname and truncates long names', () => {
    expect(compactName('Sunil Chhetri')).toBe('Chhetri');
    expect(compactName('  Pelé ')).toBe('Pelé');
    expect(compactName('A Supercalifragilistic')).toBe('Supercalifr…');
    expect(compactName('')).toBe('');
  });

  it('keeps name particles with the surname', () => {
    expect(compactName('Kevin De Bruyne')).toBe('De Bruyne');
    expect(compactName('Virgil van Dijk')).toBe('van Dijk');
    expect(compactName('Marc-André ter Stegen')).toBe('ter Stegen');
    expect(compactName('Ruben Dias da Silva')).toBe('da Silva');
    expect(compactName('Sandesh Jhingan')).toBe('Jhingan');
  });

  it('keeps the word before a trailing dotted abbreviation', () => {
    expect(compactName('MANOJ MD.')).toBe('MANOJ MD.');
    expect(compactName('T. DIAMOND SINGH')).toBe('SINGH');
    expect(compactName('Ashutosh Jr.')).toBe('Ashutosh Jr.');
  });

  it('never reduces a name to just a number', () => {
    expect(compactName('Sub 0')).toBe('Sub 0');
    expect(compactName('Player 12')).toBe('Player 12');
    expect(compactName('Ola 7 Ngwa')).toBe('Ngwa');
  });
});
