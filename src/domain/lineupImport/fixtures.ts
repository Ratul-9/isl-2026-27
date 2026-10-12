import type { ExtractedLineup, ExtractedPlayer } from './types';

/**
 * GROUND TRUTH transcribed by hand (by the developer/assistant, reading the
 * images) from the two supplied broadcast graphics:
 *   "Bengaluru FC Starting Lineup 10.8.2026.png"   (2940×1652)
 *   "SC Delhi Starting Lineup 10.8.2026.png"       (2940×1520, letterboxed)
 *
 * This is NOT output from any extraction provider. It is used (a) as the
 * expected answer in the opt-in real-provider integration tests and (b) as
 * realistic "as read" input for the deterministic pipeline tests.
 *
 * Pitch coordinates are the centres of each player's name label, normalised
 * to the graphic's pitch area (the white area left of the coloured panel).
 */

const p = (
  name: string,
  shirtNumber: number | null,
  x: number | null,
  y: number | null,
  extra: Partial<ExtractedPlayer> = {},
): ExtractedPlayer => ({ name, shirtNumber, position: null, x, y, captain: false, uncertain: false, note: null, ...extra });

const sub = (shirtNumber: number, name: string) => p(name, shirtNumber, null, null);

// Bengaluru: displayed 2000×1124 → pitch area x 0–1400, y 0–1124.
const bx = (px: number) => Number((px / 1400).toFixed(3));
const by = (py: number) => Number((py / 1124).toFixed(3));

export const BENGALURU_GROUND_TRUTH: ExtractedLineup = {
  teamName: 'Bengaluru FC',
  teamNameSource: 'crest',
  coach: 'JOSE MUNOZ ZOYO',
  formation: '4-3-3',
  goalkeeperEdge: 'bottom',
  starters: [
    p('GURPREET', 1, bx(690), by(993), { position: 'GK', captain: true }),
    p('NAOREM', 32, bx(293), by(767)),
    p('SANA', 4, bx(565), by(767)),
    p('KOCH', 3, bx(839), by(767)),
    p('SHIVALDO', 51, bx(1126), by(767)),
    p('MARTÍNEZ', 7, bx(417), by(533)),
    p('FANAI', 23, bx(697), by(535)),
    p('SURESH', 8, bx(999), by(530)),
    p('ASHIQUE', 22, bx(455), by(295)),
    p('PEROVIC', 9, bx(715), by(295)),
    p('RYAN', 10, bx(977), by(297)),
  ],
  substitutes: [
    sub(5, 'MANUEL IGNACIO IRIONDO'),
    sub(6, 'SANDRO ANIBAL EMBALO'),
    sub(11, 'SUNIL CHHETRI'),
    sub(14, 'SOHAM VARSHNEYA'),
    sub(27, 'NIKHIL CHANDRASHEKAR POOJARY'),
    sub(28, 'LALTHUAMMAWIA RALTE'),
    sub(29, 'SERTO WORNEILEN KOM'),
    sub(30, 'SAHIL POONIA'),
    sub(37, 'TAOREM KELVIN SINGH'),
  ],
  warnings: [],
};

// SC Delhi: displayed 2000×1034 → pitch area x 95–1362, y 10–1030.
const dx = (px: number) => Number(((px - 95) / 1267).toFixed(3));
const dy = (py: number) => Number(((py - 10) / 1020).toFixed(3));

export const SC_DELHI_GROUND_TRUTH: ExtractedLineup = {
  teamName: 'Sporting Club Delhi',
  teamNameSource: 'crest',
  coach: 'TOMASZ PAWEL TCHORZ',
  formation: '5-3-2',
  goalkeeperEdge: 'bottom',
  starters: [
    p('FERNANDES', 20, dx(730), dy(910), { position: 'GK' }),
    p('TOMBA', 25, dx(226), dy(704)),
    p('MANOJ MD.', 41, dx(471), dy(704)),
    p('DUVAN', 28, dx(719), dy(704)),
    p('NDUKA', 45, dx(979), dy(704)),
    p('GOGOU', 19, dx(1228), dy(704), { captain: true }),
    p('PEÑA', 10, dx(475), dy(493)),
    p('AZHAR', 24, dx(730), dy(491)),
    p('HNAMTE', 4, dx(1000), dy(491)),
    p('RODRIGUINHO', 7, dx(551), dy(277)),
    p('AIMEN', 23, dx(881), dy(278)),
  ],
  substitutes: [
    sub(6, 'ASHUTOSH MEHTA'),
    sub(8, 'RICHARD NDAYISHIMIYE'),
    sub(15, 'CLARENCE SAVIO FERNANDES'),
    sub(18, 'AUGUSTINE LALROCHANA'),
    sub(27, 'SOURAV'),
    sub(30, 'T. DIAMOND SINGH'),
    sub(31, 'VISHAL YADAV'),
    sub(66, 'AKSHAT MEHRA'),
    sub(99, 'CARLOS MANUEL DOS SANTOS FORTES'),
  ],
  warnings: [],
};
