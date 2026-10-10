import { describe, expect, it } from 'vitest';
import { compactName } from './labels';

describe('compactName', () => {
  it('uses the surname and truncates long names', () => {
    expect(compactName('Sunil Chhetri')).toBe('Chhetri');
    expect(compactName('  Pelé ')).toBe('Pelé');
    expect(compactName('Kevin De Bruyne')).toBe('Bruyne');
    expect(compactName('A Supercalifragilistic')).toBe('Supercalifr…');
    expect(compactName('')).toBe('');
  });
});
