import type { OptionDef, OutcomeDef, ScenarioRole, Segment, TacticScenario } from './types';

/**
 * Wide overload, as a staged scenario (Team A attacks and overloads the left
 * flank; Team B defends). Authored in the attacking frame on the LEFT flank
 * (see types.ts) and mirrored by the compiler.
 *
 * Shirt numbers follow roles.ts and never change meaning: on the left flank
 * the overloaded wide players are No. 11 (winger) and No. 3 (full-back) and the
 * far-side winger is No. 7; mirrored, they are 7 and 2 with 11 as the far-side
 * winger. Centre-backs: 5 is left-sided, 4 right-sided. The goalkeeper (No. 1)
 * is not needed to explain the idea and is not drawn.
 *
 * Seventeen players are on the pitch: the four overload players, the No. 6
 * who covers, the No. 9 and far-side winger as the two ways out, and the
 * rest-defence players (No. 2, 4, 5) on Team A; and the near-side defenders,
 * the central midfield pair, both centre-backs and the far-side full-back on
 * Team B (the last is what makes the far-side space real or not).
 *
 * Positions are illustrative, not measurements. Every highlight is computed
 * from them at the current time (spaces.ts).
 */

const ROLES: ScenarioRole[] = [
  {
    id: 'a-fb',
    team: 'attack',
    number: { left: 3, right: 2 },
    label: { left: '3 Left back', right: '2 Right back' },
    short: { left: 'the No. 3', right: 'the No. 2' },
    description: { left: 'Team A No. 3, the left back who advances', right: 'Team A No. 2, the right back who advances' },
  },
  {
    id: 'a-wg',
    team: 'attack',
    number: { left: 11, right: 7 },
    label: { left: '11 Left winger', right: '7 Right winger' },
    short: { left: 'the No. 11', right: 'the No. 7' },
    description: { left: 'Team A No. 11, the left winger', right: 'Team A No. 7, the right winger' },
  },
  { id: 'a-8', team: 'attack', number: 8, label: '8 Central mid', short: 'the No. 8', description: 'Team A No. 8, the central midfielder' },
  { id: 'a-10', team: 'attack', number: 10, label: '10 Att. mid', short: 'the No. 10', description: 'Team A No. 10, the attacking midfielder' },
  { id: 'a-6', team: 'attack', number: 6, label: '6 Def. mid', short: 'the No. 6', description: 'Team A No. 6, the defensive midfielder who covers' },
  { id: 'a-9', team: 'attack', number: 9, label: '9 Striker', short: 'the No. 9', description: 'Team A No. 9, the striker' },
  {
    id: 'a-far-wg',
    team: 'attack',
    number: { left: 7, right: 11 },
    label: { left: '7 Right winger', right: '11 Left winger' },
    short: { left: 'the No. 7', right: 'the No. 11' },
    description: { left: 'Team A No. 7, the far-side winger', right: 'Team A No. 11, the far-side winger' },
  },
  {
    id: 'a-far-fb',
    team: 'attack',
    number: { left: 2, right: 3 },
    label: { left: '2 Right back', right: '3 Left back' },
    short: { left: 'the No. 2', right: 'the No. 3' },
    description: { left: 'Team A No. 2, the far-side full-back who tucks in', right: 'Team A No. 3, the far-side full-back who tucks in' },
  },
  {
    id: 'a-cb-n',
    team: 'attack',
    number: { left: 5, right: 4 },
    label: { left: '5 Left CB', right: '4 Right CB' },
    short: { left: 'the No. 5', right: 'the No. 4' },
    description: { left: 'Team A No. 5, the near-side centre-back', right: 'Team A No. 4, the near-side centre-back' },
  },
  {
    id: 'a-cb-f',
    team: 'attack',
    number: { left: 4, right: 5 },
    label: { left: '4 Right CB', right: '5 Left CB' },
    short: { left: 'the No. 4', right: 'the No. 5' },
    description: { left: 'Team A No. 4, the far-side centre-back', right: 'Team A No. 5, the far-side centre-back' },
  },
  {
    id: 'b-wg',
    team: 'defence',
    number: { left: 7, right: 11 },
    label: { left: '7 Right winger', right: '11 Left winger' },
    short: { left: 'their No. 7', right: 'their No. 11' },
    description: { left: 'Team B No. 7, the winger who tracks back', right: 'Team B No. 11, the winger who tracks back' },
  },
  {
    id: 'b-fb',
    team: 'defence',
    number: { left: 2, right: 3 },
    label: { left: '2 Right back', right: '3 Left back' },
    short: { left: 'their No. 2', right: 'their No. 3' },
    description: { left: 'Team B No. 2, the full-back facing the winger', right: 'Team B No. 3, the full-back facing the winger' },
  },
  { id: 'b-8', team: 'defence', number: 8, label: '8 Central mid', short: 'their No. 8', description: 'Team B No. 8, the central midfielder' },
  { id: 'b-6', team: 'defence', number: 6, label: '6 Def. mid', short: 'their No. 6', description: 'Team B No. 6, the defensive midfielder' },
  {
    id: 'b-cb-n',
    team: 'defence',
    number: { left: 4, right: 5 },
    label: { left: '4 Right CB', right: '5 Left CB' },
    short: { left: 'their No. 4', right: 'their No. 5' },
    description: { left: 'Team B No. 4, the near-side centre-back', right: 'Team B No. 5, the near-side centre-back' },
  },
  {
    id: 'b-cb-f',
    team: 'defence',
    number: { left: 5, right: 4 },
    label: { left: '5 Left CB', right: '4 Right CB' },
    short: { left: 'their No. 5', right: 'their No. 4' },
    description: { left: 'Team B No. 5, the far-side centre-back', right: 'Team B No. 4, the far-side centre-back' },
  },
  {
    id: 'b-far-fb',
    team: 'defence',
    number: { left: 3, right: 2 },
    label: { left: '3 Left back', right: '2 Right back' },
    short: { left: 'their No. 3', right: 'their No. 2' },
    description: { left: 'Team B No. 3, the far-side full-back', right: 'Team B No. 2, the far-side full-back' },
  },
];

// --- shared start (0 – forkT = 9) -------------------------------------------------

const BASE: Segment = {
  tracks: {
    // Team A: 4-2-3-1 with the ball at the No. 6
    'a-cb-n': [[0, 36, 38], [2.6, 36, 38], [5.4, 40, 40], [9, 44, 40]],
    'a-cb-f': [[0, 36, 62], [2.6, 36, 62], [5.4, 40, 58], [9, 44, 58]],
    'a-far-fb': [[0, 44, 86], [2.6, 44, 86], [5.4, 48, 76], [9, 50, 68]],
    'a-fb': [[0, 46, 12], [2.6, 47, 12], [3.6, 48, 12], [5.4, 60, 11], [6.2, 62, 12], [7, 66, 15], [9, 70, 20]],
    'a-wg': [[0, 72, 9], [5.4, 76, 8], [6.2, 76, 9], [7, 76, 10], [9, 78, 8]],
    'a-8': [[0, 58, 36], [2.6, 58, 36], [5.4, 57, 30], [7, 58, 28], [9, 58, 28]],
    'a-10': [[0, 77, 60], [2.6, 77, 58], [5.4, 74, 46], [7, 72, 36], [7.8, 72, 34], [9, 72, 34]],
    'a-6': [[0, 50, 46], [2.6, 50, 46], [5.4, 52, 44], [9, 52, 38]],
    'a-9': [[0, 82, 50], [5.4, 82, 48], [9, 82, 46]],
    'a-far-wg': [[0, 72, 91], [9, 72, 92]],
    // Team B: 4-4-2 mid-block (the near-side winger and full-back, the central pair, the back line)
    'b-wg': [[0, 74, 18], [3.6, 72, 18], [5.4, 74, 18], [7, 76, 18], [9, 77, 18]],
    'b-fb': [[0, 86, 15], [5.4, 84, 15], [9, 82, 14]],
    'b-8': [[0, 70, 40], [5.4, 70, 46], [9, 70, 46]],
    'b-6': [[0, 70, 56], [5.4, 70, 57], [9, 70, 58]],
    'b-cb-n': [[0, 89, 42], [9, 88, 40]],
    'b-cb-f': [[0, 89, 58], [9, 88, 56]],
    'b-far-fb': [[0, 86, 84], [9, 86, 82]],
  },
  ball: [
    { kind: 'carry', by: 'a-6', t0: 0, t1: 2.6 },
    { kind: 'pass', from: 'a-6', to: 'a-fb', t0: 2.6, t1: 3.6, style: 'pass', note: 'To the full-back', hold: 0.6 },
    { kind: 'carry', by: 'a-fb', t0: 3.6, t1: 5.4 },
    { kind: 'pass', from: 'a-fb', to: 'a-wg', t0: 5.4, t1: 6.2, style: 'pass', note: 'Into the winger', hold: 0.6 },
    { kind: 'carry', by: 'a-wg', t0: 6.2, t1: 7 },
    { kind: 'pass', from: 'a-wg', to: 'a-10', t0: 7, t1: 7.8, style: 'pass', note: 'Inside to No. 10', hold: 0.6 },
    { kind: 'carry', by: 'a-10', t0: 7.8, t1: 9 },
  ],
  arrows: [
    { id: 'fb-advances', actor: 'a-fb', t0: 5.4, t1: 9, note: 'Full-back advances', hold: 0.5 },
    { id: 'ten-comes', actor: 'a-10', t0: 3.6, t1: 7.8, hold: 0.6 },
    { id: 'eight-supports', actor: 'a-8', t0: 3.6, t1: 7, hold: 0.6 },
  ],
  beats: [
    { t: 0, text: 'Initial structure: Team A in a 4-2-3-1 with the No. 6 on the ball. Team B sits in a mid-block. The far-side winger stays wide and high.' },
    { t: 2.6, text: 'Establishing the overload: the ball goes wide to the full-back while the No. 8 and No. 10 start to drift toward the same side.' },
    { t: 5.4, text: 'The winger stays high and wide, the full-back advances behind him, and the No. 8 and No. 10 offer support at different heights.' },
    { t: 7, text: 'Short passes through the group: winger, then inside to the No. 10. Four attackers now occupy the zone; the count against the defenders is shown on the pitch.' },
  ],
};

// --- stage 4 + 5: the defence responds, Team A adapts and covers ---------------------

const CARRY_THEN_LAYOFF: Segment['ball'] = [
  { kind: 'carry', by: 'a-10', t0: 9, t1: 11.4 },
  { kind: 'pass', from: 'a-10', to: 'a-8', t0: 11.4, t1: 12.2, style: 'pass', note: 'Lay-off', hold: 0.6 },
  { kind: 'carry', by: 'a-8', t0: 12.2, t1: 13.6 },
];

const SHIFT: OutcomeDef = {
  label: 'Block shifts across',
  tab: 'Block shifts across',
  summary:
    'Team B’s central midfielders and far-side full-back slide toward the ball: the overload becomes a smaller count, but the far side is stretched.',
  tracks: {
    'a-fb': [[10.4, 71, 22], [13.6, 71, 22]],
    'a-wg': [[10.4, 80, 9], [13.6, 82, 10]],
    'a-8': [[11.4, 60, 30], [12.2, 64, 36], [13.6, 64, 36]],
    'a-10': [[10.4, 72, 34], [11.4, 72, 34], [13.6, 73, 34]],
    'a-6': [[10.6, 54, 30], [13.6, 56, 26]],
    'a-9': [[11, 84, 46], [13.6, 84, 46]],
    'a-far-wg': [[13.6, 72, 92]],
    'a-far-fb': [[11, 52, 68], [13.6, 52, 66]],
    'a-cb-n': [[13.6, 46, 40]],
    'a-cb-f': [[13.6, 46, 58]],
    'b-wg': [[10.4, 76, 18], [13.6, 75, 21]],
    'b-fb': [[10.4, 82, 15], [13.6, 82, 17]],
    'b-8': [[10.4, 73, 41], [11.4, 74, 41], [13.6, 74, 41]],
    'b-6': [[10.4, 72, 49], [13.6, 73, 48]],
    'b-cb-n': [[11.4, 88, 38], [13.6, 88, 36]],
    'b-cb-f': [[11.4, 88, 52], [13.6, 88, 50]],
    'b-far-fb': [[11.4, 86, 76], [13.6, 86, 70]],
  },
  ball: CARRY_THEN_LAYOFF,
  arrows: [
    { id: 'eight-slides', actor: 'b-8', t0: 9, t1: 11.4, note: 'No. 8 slides across', hold: 0 },
    { id: 'far-fb-tucks', actor: 'b-far-fb', t0: 10.4, t1: 13.6, note: 'Far full-back tucks', hold: 0 },
    { id: 'six-covers', actor: 'a-6', t0: 10.6, t1: 13.6, hold: 0.6 },
    { id: 'eight-offers', actor: 'a-8', t0: 11.4, t1: 12.2, note: 'No. 8 offers', hold: 0 },
  ],
  beats: [
    { t: 9, text: 'Response: Team B’s No. 8 slides across to help, so the near-side count shrinks and the far side is left more exposed.' },
    { t: 10.6, text: 'Team A adapts: the No. 6 drops across behind and inside the advancing full-back; the No. 9 pins the centre-backs and the far-side winger stays wide.' },
    { t: 12.2, text: 'The No. 10 lays the ball off to the No. 8. The back line is kept at home in a rest-defence shape.' },
    { t: 13.6, text: 'Decision point: line-breaking pass, diagonal switch, or recycle. Which are on depends on where the defenders are now.' },
  ],
};

const PRESS: OutcomeDef = {
  label: 'Midfielder steps out to press',
  tab: 'Midfielder steps out',
  summary:
    'Team B’s No. 6 steps out to press the ball and its No. 8 tracks the runner, but the back line holds its width: the centre may open and the far side stays covered.',
  tracks: {
    'a-fb': [[10.4, 70, 22], [13.6, 70, 22]],
    'a-wg': [[10.4, 80, 9], [13.6, 83, 9]],
    'a-8': [[11.4, 58, 30], [12.2, 60, 32], [13.6, 60, 32]],
    'a-10': [[10.4, 72, 34], [11.4, 72, 34], [13.6, 76, 40]],
    'a-6': [[10.6, 53, 31], [13.6, 56, 24]],
    'a-9': [[11, 82, 46], [13.6, 80, 48]],
    'a-far-wg': [[13.6, 72, 92]],
    'a-far-fb': [[11, 52, 68], [13.6, 52, 66]],
    'a-cb-n': [[13.6, 46, 40]],
    'a-cb-f': [[13.6, 46, 58]],
    'b-wg': [[10.4, 76, 18], [13.6, 75, 21]],
    'b-fb': [[10.4, 82, 15], [13.6, 82, 16]],
    'b-8': [[10.4, 67, 34], [11.4, 66, 30], [13.6, 66, 26]],
    'b-6': [[10.4, 69, 50], [11.4, 66, 46], [13.6, 66, 46]],
    'b-cb-n': [[13.6, 89, 42]],
    'b-cb-f': [[13.6, 89, 58]],
    'b-far-fb': [[13.6, 86, 80]],
  },
  ball: CARRY_THEN_LAYOFF,
  arrows: [
    { id: 'six-presses', actor: 'b-6', t0: 9.4, t1: 11.4, note: 'No. 6 steps out', hold: 0 },
    { id: 'eight-tracks', actor: 'b-8', t0: 9.4, t1: 13.6, note: 'No. 8 tracks the run', hold: 0 },
    { id: 'six-covers', actor: 'a-6', t0: 10.6, t1: 13.6, hold: 0.6 },
    { id: 'nine-drops', actor: 'a-9', t0: 11, t1: 13.6, note: 'No. 9 drops in', hold: 0 },
  ],
  beats: [
    { t: 9, text: 'Response: Team B’s No. 6 steps out to press the ball and its No. 8 follows the support run, while the back line keeps its width.' },
    { t: 10.6, text: 'Team A adapts: the No. 6 covers behind the full-back, the No. 9 drops toward the space behind the pressing midfielder and the No. 10 moves inside.' },
    { t: 12.2, text: 'The No. 10 releases the ball to the No. 8 before the press arrives. The back line stays at home.' },
    { t: 13.6, text: 'Decision point: line-breaking pass, diagonal switch, or recycle. Which are on depends on where the defenders are now.' },
  ],
};

// --- stage 6 + 7: the options -------------------------------------------------------

/** Keeping the ball: the No. 8 plays back to the No. 6, who re-circulates to the far-side centre-back. */
const RECYCLE_TRACKS: Segment['tracks'] = {
  'a-6': [[14.4, 56, 25], [15.8, 54, 30]],
  'a-cb-f': [[15.8, 46, 58]],
  'a-8': [[15.8, 62, 34]],
};
const RECYCLE_BALL: Segment['ball'] = [
  { kind: 'pass', from: 'a-8', to: 'a-6', t0: 13.6, t1: 14.4, style: 'pass', note: 'Back to the No. 6', hold: 0.6 },
  { kind: 'pass', from: 'a-6', to: 'a-cb-f', t0: 14.8, t1: 15.8, style: 'pass', note: 'Re-set', hold: 0.6 },
];

const RECYCLE_ARROWS: Segment['arrows'] = [];

const BREAK: OptionDef = {
  title: 'Line-breaking pass to the No. 9',
  summary: 'A ground pass from the No. 8 through the midfield line to the No. 9 who has dropped between the lines.',
  fitsWhen: 'When the lane to the No. 9 is clear of defenders and a centre-back is not yet close enough to step onto him.',
  risk: 'The pass can be intercepted by a midfielder who has not been drawn out, or the No. 9 can be turned into a loss behind a ball-side press.',
  end: 16.6,
  verdict: {
    type: 'receiver',
    next: {
      time: 'He has time to turn and carry forward, or to lay the ball off to a runner.',
      tight: 'A centre-back is close: a lay-off to a runner is safer than turning into him.',
      closed: 'He is tightly marked: hold the ball up and recycle rather than turn.',
    },
  },
  tracks: {
    'a-9': [[14.6, 81, 48], [16.6, 85, 48]],
    'a-10': [[14.6, 76, 40], [16.6, 84, 34]],
    'a-wg': [[16.6, 86, 8]],
    'a-8': [[16.6, 64, 34]],
    'b-cb-n': [[14.6, 87, 42], [16.6, 87, 41]],
    'b-cb-f': [[16.6, 88, 56]],
    'b-6': [[14.6, 68, 46], [16.6, 74, 47]],
    'b-8': [[16.6, 68, 28]],
  },
  ball: [
    { kind: 'pass', from: 'a-8', to: 'a-9', t0: 13.6, t1: 14.6, style: 'pass', note: 'Line-breaking', hold: 0.6 },
    { kind: 'carry', by: 'a-9', t0: 14.6, t1: 16.6 },
  ],
  arrows: [{ id: 'ten-runs-beyond', actor: 'a-10', t0: 14.6, t1: 16.6, note: 'No. 10 runs beyond', hold: 0.6 }],
  beats: [
    { t: 13.6, text: 'The No. 8 looks for the No. 9 between the lines.' },
    { t: 14.6, text: 'The No. 9 receives. The next action depends on the nearest centre-back.' },
  ],
  byOutcome: {
    shift: {
      // The block has stayed compact in the middle: the pass is not on, so the ball is kept.
      replace: true,
      tracks: RECYCLE_TRACKS,
      ball: RECYCLE_BALL,
      arrows: RECYCLE_ARROWS,
      beats: [{ t: 13.6, text: 'The central lane is shut by a midfielder who has not been drawn out: the No. 8 does not force it and keeps the ball.' }],
      verdict: { type: 'retain', declined: 'a-9' },
    },
  },
};

const SWITCH: OptionDef = {
  title: 'Diagonal switch to the far-side winger',
  summary: 'A lofted ball from the No. 8 across the pitch to the winger who stayed wide on the far side.',
  fitsWhen: 'When the block has shifted toward the ball, the far-side full-back is not close to the winger and the middle of the lane is clear.',
  risk: 'A long ball gives the defence time to shuffle back; it can be headed away or the winger can be closed down on arrival.',
  end: 17,
  verdict: {
    type: 'receiver',
    next: {
      time: 'He has time to carry forward and look to cross or combine.',
      tight: 'The full-back is close: a quick combination or a recycle is safer than forcing a cross.',
      closed: 'He is already tightly marked: keep the ball and recycle.',
    },
  },
  tracks: {
    'a-far-wg': [[15.2, 74, 90], [17, 84, 84]],
    'a-9': [[15.2, 86, 48], [17, 90, 52]],
    'a-10': [[15.2, 80, 34], [17, 82, 36]],
    'a-wg': [[17, 86, 10]],
    'b-far-fb': [[15.2, 86, 74], [17, 84, 78]],
    'b-cb-f': [[17, 90, 58]],
    'b-8': [[17, 76, 42]],
  },
  ball: [
    { kind: 'pass', from: 'a-8', to: 'a-far-wg', t0: 13.6, t1: 15.2, style: 'lofted', note: 'Switch', hold: 0.8 },
    { kind: 'carry', by: 'a-far-wg', t0: 15.2, t1: 17 },
  ],
  arrows: [{ id: 'nine-attacks-box', actor: 'a-9', t0: 15.2, t1: 17, note: 'No. 9 attacks the box', hold: 0.6 }],
  beats: [
    { t: 13.6, text: 'The No. 8 changes the point of attack with a diagonal ball to the far-side winger.' },
    { t: 15.2, text: 'The winger receives. What he does next depends on how close the far-side full-back is.' },
  ],
  byOutcome: {
    press: {
      // The midfield screen and the far-side full-back have not moved: the switch is not on, so the ball is kept.
      replace: true,
      tracks: RECYCLE_TRACKS,
      ball: RECYCLE_BALL,
      arrows: RECYCLE_ARROWS,
      beats: [{ t: 13.6, text: 'The far-side full-back and the midfield screen have not moved: the long ball is not on, so the No. 8 keeps the ball.' }],
      verdict: { type: 'retain', declined: 'a-far-wg' },
    },
  },
};

const RECYCLE: OptionDef = {
  title: 'Recycle and re-set',
  summary: 'The No. 8 plays back to the No. 6, who re-circulates to the far-side centre-back.',
  fitsWhen: 'When neither the central pass nor the switch is on, or the block has not been disturbed enough to break it.',
  risk: 'Possession is safe but the defence gets time to reset, so the overload has to be built again.',
  end: 15.8,
  verdict: {
    type: 'receiver',
    next: {
      time: 'Possession is kept; the block has to re-shape and the central pass or the switch may come back on.',
      tight: 'Possession is kept under some pressure: play on quickly to the centre-back.',
      closed: 'He is tightly closed: the ball should go to a free teammate rather than be held.',
    },
  },
  tracks: RECYCLE_TRACKS,
  ball: RECYCLE_BALL,
  arrows: [],
  beats: [{ t: 13.6, text: 'Neither pass is forced: the No. 8 plays back to the No. 6, who re-circulates to the far-side centre-back.' }],
};

export const WIDE_OVERLOAD_SCENARIO: TacticScenario = {
  id: 'wide-overload',
  title: 'Wide overload',
  roles: ROLES,
  forkT: 9,
  decisionT: 13.6,
  base: BASE,
  defaultOutcome: 'shift',
  outcomeHeading: 'Defensive response',
  decisionPrompt: 'What does the No. 8 do?',
  outcomes: { shift: SHIFT, press: PRESS },
  options: { break: BREAK, switch: SWITCH, recycle: RECYCLE },
  stages: [
    {
      id: 'structure',
      title: 'Initial structure',
      summary: 'Team A in shape; the far-side winger stays wide.',
      span: [0, 2.6],
      coaching: [
        'Team A starts balanced: a back line, a pivot, three behind the striker and a winger on each side.',
        'The far-side winger stays high and wide from the start. He is the player the defence cannot forget about.',
      ],
    },
    {
      id: 'establish',
      title: 'Establish the overload',
      summary: 'The ball and the support players go to one side.',
      span: [2.6, 5.4],
      coaching: [
        'The ball goes wide early so the defence has to follow it. The No. 8 and No. 10 move toward the ball at different heights and angles.',
        'The winger holds the width high; the full-back comes up behind him. That gives two players on the line and two in the half-spaces.',
      ],
    },
    {
      id: 'advantage',
      title: 'Create the numerical advantage',
      summary: 'Short passes and support runs on one side.',
      span: [5.4, 9],
      coaching: [
        'Short passes through the group pull the nearest defenders onto the ball. The count is measured from where the players actually are.',
        'The advantage exists only while more attackers than defenders are in the zone. If a defender joins, the count shrinks.',
      ],
    },
    {
      id: 'response',
      title: 'Defensive responses',
      summary: 'Defenders shift, step out or track; Team A adapts.',
      span: [9, 11.4],
      coaching: [
        'Defenders can slide across to restore the count, step out to press the ball, or follow a runner. Each leaves something behind.',
        'Team A adapts to what it sees rather than to a script: the No. 9 and the far-side winger keep their positions so that the space they threaten stays real.',
      ],
      outcomeNotes: {
        shift:
          'Block shifts across (default): the near-side count shrinks, but a defence that has moved toward the ball may leave the far side less well covered.',
        press:
          'Midfielder steps out: pressing the ball can open the space behind the presser; whether it does depends on how well the back line and the other midfielder cover it.',
      },
    },
    {
      id: 'cover',
      title: 'Protect against transitions',
      summary: 'No. 6 covers; the back line stays at home.',
      span: [11.4, 13.6],
      coaching: [
        'The No. 6 drops across behind and inside the advancing full-back so a lost ball can be won back immediately.',
        'The centre-backs and the far-side full-back keep a rest-defence shape. The attack is only worth committing to if it is covered.',
      ],
    },
  ],
  decisionStage: {
    label: 'Stage 6',
    title: 'Exploit the opening',
    summary: 'Line-break, switch, or keep it.',
    coaching: [
      'A line-breaking pass is on when the lane through the midfield line is clear and the receiver has room to turn.',
      'A diagonal switch is on when the defence has shifted, the far-side full-back is not tight to the winger and the lane is clear near the passer and the receiver.',
      'If neither lane is clear, keeping the ball is a good choice: the overload has already drawn the block across.',
    ],
  },
  resolveStage: {
    title: 'Resolve the action',
    summary: 'Carry, combine, cross or recycle.',
    coaching: [
      'The receiver reads what is around him: carry forward if there is time, combine with a runner if a defender is close, recycle if both are blocked.',
      'Nothing here is guaranteed to produce a chance; it only tells you what the positions offer.',
    ],
  },
  spaces: [
    {
      id: 'overload',
      type: 'overload',
      attackers: ['a-wg', 'a-fb', 'a-8', 'a-10'],
      window: [7, 11.4],
      options: [null],
      label: 'Overload',
    },
    {
      id: 'central-space',
      type: 'zone',
      rect: [72, 82, 40, 58],
      showAtM: 3.5,
      openAtM: 6,
      window: [9, 13.6],
      options: [null, 'break'],
      label: 'Central space',
    },
    {
      id: 'far-space',
      type: 'zone',
      rect: [70, 88, 80, 98],
      showAtM: 3.5,
      openAtM: 6,
      window: [9, 13.6],
      options: [null, 'switch'],
      label: 'Far-side space',
    },
    {
      id: 'break-lane',
      type: 'lane',
      mode: 'ground',
      from: 'ball',
      to: 'a-9',
      window: [11.4, 13.6],
      options: [null, 'break'],
      label: 'Line-breaking lane',
      shortLabel: 'Break lane',
    },
    {
      id: 'switch-lane',
      type: 'lane',
      mode: 'lofted',
      from: 'ball',
      to: 'a-far-wg',
      window: [11.4, 13.6],
      options: [null, 'switch'],
      label: 'Switch lane',
    },
    { id: 'cover-six', type: 'cover', anchor: 'a-6', radiusM: [9, 7], window: [9, 99], label: 'No. 6 cover' },
    { id: 'behind-fb', type: 'exposed', runner: 'a-fb', window: [7, 99], label: 'Space behind' },
  ],
  marking: [
    { id: 'fb-marks-wg', defender: 'b-fb', attacker: 'a-wg', window: [0, 99] },
    { id: 'far-fb-marks-wg', defender: 'b-far-fb', attacker: 'a-far-wg', window: [0, 99] },
    { id: 'cb-marks-nine', defender: 'b-cb-n', attacker: 'a-9', window: [0, 99] },
    { id: 'eight-marks-ten', defender: 'b-8', attacker: 'a-10', window: [0, 9.4] },
  ],
  minNoteLengthM: 12,
  counters: [
    'The near-side winger and full-back stay compact and the central midfield slides across early, so the zone never becomes 4v2.',
    'The far-side full-back stays tight to the winger, which makes the switch unattractive; the cost is a thinner middle.',
    'The pressing midfielder is covered by the second midfielder, so stepping out does not open the space behind him.',
    'The block forces the ball wide and backward before the overload is built, so the first pass never reaches the half-space.',
  ],
  caveat:
    'This is a teaching illustration built from fixed example positions. The overload does not always succeed and real defenders react to the score, the opposition’s shape and the match situation.',
};
