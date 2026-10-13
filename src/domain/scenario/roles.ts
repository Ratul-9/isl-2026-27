/**
 * The fixed shirt-number mapping tactic scenarios use. A number always keeps
 * its meaning: when a tactic is mirrored to the other flank the players on
 * that flank are the ones whose numbers belong there; numbers are never
 * swapped.
 *
 * Assumption (documented, not a rule of the game): No. 4 is the right-sided
 * and No. 5 the left-sided centre-back; 2 is the right back, 3 the left back,
 * 7 the right winger and 11 the left winger (the usual convention).
 */

export type RoleGroup = 'goalkeeper' | 'fullBack' | 'centreBack' | 'defensiveMidfielder' | 'centralMidfielder' | 'attackingMidfielder' | 'winger' | 'striker';
export type Side = 'left' | 'right' | 'centre';

export const ROLE_NUMBERS: Readonly<Record<number, { group: RoleGroup; side: Side }>> = {
  1: { group: 'goalkeeper', side: 'centre' },
  2: { group: 'fullBack', side: 'right' },
  3: { group: 'fullBack', side: 'left' },
  4: { group: 'centreBack', side: 'right' },
  5: { group: 'centreBack', side: 'left' },
  6: { group: 'defensiveMidfielder', side: 'centre' },
  7: { group: 'winger', side: 'right' },
  8: { group: 'centralMidfielder', side: 'centre' },
  9: { group: 'striker', side: 'centre' },
  10: { group: 'attackingMidfielder', side: 'centre' },
  11: { group: 'winger', side: 'left' },
};
