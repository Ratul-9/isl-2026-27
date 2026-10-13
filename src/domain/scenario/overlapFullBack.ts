import type { OptionDef, OutcomeDef, ScenarioRole, Segment, TacticScenario } from './types';

/**
 * The Overlapping full-back, as a staged scenario.
 *
 * Authored in the attacking team's frame on its LEFT flank (see types.ts).
 * Team A attacks, Team B defends. Only the players that matter to the idea are
 * on the pitch: the four attackers around the move plus the No. 6 who covers,
 * and the defenders whose position or reaction changes the outcome (Team B's
 * winger, full-back, two centre-backs and the screening midfielder — the
 * second centre-back is needed to show who covers the striker when the first
 * steps out, the midfielder to show when the lane to the No. 8 closes).
 *
 * Numbers are illustrative positions, not measurements. Every highlight in the
 * scene is computed from these positions at the current time (spaces.ts).
 */

const ROLES: ScenarioRole[] = [
  {
    id: 'a-fb',
    team: 'attack',
    badge: { left: 'LB', right: 'RB' },
    label: { left: 'Left back', right: 'Right back' },
    short: { left: 'the left back', right: 'the right back' },
    description: { left: 'Team A left back (the overlapping full-back)', right: 'Team A right back (the overlapping full-back)' },
  },
  {
    id: 'a-wg',
    team: 'attack',
    badge: { left: 'LW', right: 'RW' },
    label: { left: 'Left winger', right: 'Right winger' },
    short: 'the winger',
    description: { left: 'Team A left winger', right: 'Team A right winger' },
  },
  { id: 'a-9', team: 'attack', badge: '9', label: 'Number 9', short: 'the No. 9', description: 'Team A number 9, the centre-forward' },
  {
    id: 'a-8',
    team: 'attack',
    badge: '8',
    label: 'Number 8',
    short: 'the No. 8',
    description: 'Team A number 8, the supporting central midfielder',
  },
  { id: 'a-6', team: 'attack', badge: '6', label: 'Number 6', description: 'Team A number 6, the deeper covering midfielder' },
  {
    id: 'b-wg',
    team: 'defence',
    badge: { left: 'RW', right: 'LW' },
    label: { left: 'Right winger', right: 'Left winger' },
    description: { left: 'Team B right winger, who presses the full-back', right: 'Team B left winger, who presses the full-back' },
  },
  {
    id: 'b-fb',
    team: 'defence',
    badge: { left: 'RB', right: 'LB' },
    label: { left: 'Right back', right: 'Left back' },
    description: { left: 'Team B right back, who faces the winger', right: 'Team B left back, who faces the winger' },
  },
  { id: 'b-cb', team: 'defence', badge: 'CB', label: 'Centre-back', description: 'Team B centre-back marking the number 9' },
  { id: 'b-cb2', team: 'defence', badge: 'CB', label: 'Covering CB', description: 'Team B second centre-back, covering' },
  { id: 'b-dm', team: 'defence', badge: 'DM', label: 'Def. midfield', description: 'Team B defensive midfielder, screening the edge of the box' },
];

// --- shared start (0 – forkT) ----------------------------------------------

const BASE: Segment = {
  tracks: {
    // Team A
    'a-fb': [[0, 46, 8], [2, 50.5, 8], [3.4, 54.5, 8], [4.4, 55, 8], [5.2, 56.5, 7.5], [6, 60, 6.4], [7, 66, 5.2]],
    'a-wg': [[0, 60, 20], [3.4, 62, 21], [4.4, 62.8, 21.6], [5.4, 65.5, 24.6], [7, 69, 29.5]],
    'a-9': [[0, 82, 46], [3.4, 82, 45.5], [7, 83, 45]],
    'a-8': [[0, 77, 32], [3.4, 77.5, 32], [7, 79, 31]],
    'a-6': [[0, 58, 50], [7, 59, 49]],
    // Team B
    'b-wg': [[0, 63, 10], [2.4, 60.8, 8.4], [3.4, 59.6, 7.2], [4.4, 59, 8.4], [5.4, 60.5, 12.5], [7, 62, 16]],
    'b-fb': [[0, 70, 23], [3.4, 69, 23.5], [4.4, 68.5, 24], [5.4, 69.5, 26.2], [7, 74, 29.8]],
    'b-cb': [[0, 87, 40], [7, 87, 40.5]],
    'b-cb2': [[0, 88, 57], [7, 88, 56.5]],
    'b-dm': [[0, 76, 46], [4.4, 75, 44], [7, 76, 42]],
  },
  ball: [
    { kind: 'carry', by: 'a-fb', t0: 0, t1: 3.4 },
    { kind: 'pass', from: 'a-fb', to: 'a-wg', t0: 3.4, t1: 4.4, style: 'pass', note: 'Pass inside', hold: 1.2 },
    { kind: 'carry', by: 'a-wg', t0: 4.4, t1: 7 },
  ],
  arrows: [
    { id: 'press', actor: 'b-wg', t0: 0.4, t1: 3.4, note: 'Presses', hold: 0.8 },
    { id: 'carry-in', actor: 'a-wg', t0: 4.4, t1: 7, note: 'Carries inside', hold: 1 },
    { id: 'close-down', actor: 'b-fb', t0: 4.4, t1: 7, note: 'Closes down', hold: 1 },
  ],
  beats: [
    { t: 0, text: 'Team A’s full-back carries the ball up the touchline; Team B’s winger moves out to press him.' },
    { t: 2.4, text: 'The press blocks the outside route: the full-back is steered inward, so the next pass goes inside.' },
    { t: 3.4, text: 'The full-back passes inward to his winger, who is slightly ahead and inside.' },
    { t: 4.4, text: 'The winger receives and turns infield; Team B’s full-back closes him down.' },
    { t: 5, text: 'As the winger drives toward the half-space, the full-back starts his run around the outside.' },
  ],
};

// --- stage 3 + 4: the defender's decision ---------------------------------

const OUTCOME_A: OutcomeDef = {
  label: 'Outcome A · the winger stays on the ball',
  tab: 'Outcome A · default',
  summary: 'Team B’s winger follows the ball carrier inside and the outside channel is left open.',
  tracks: {
    'a-fb': [[8, 73.5, 4.8], [9, 79.5, 4.8], [9.4, 82, 5], [11, 87.5, 7.5], [12.4, 91, 10]],
    'a-wg': [[7.8, 70, 31], [8.2, 70.5, 31.2], [9.4, 71, 30.6], [10.6, 74, 27], [12.4, 77.5, 22.5]],
    'a-9': [[9.4, 84, 46], [11, 88, 46], [12.4, 89, 46]],
    'a-8': [[9.4, 81, 29.5], [11, 82, 28.5], [12.4, 83, 27]],
    'a-6': [[9.4, 60, 47], [12.4, 62, 42]],
    'b-wg': [[8.2, 65, 20], [9.4, 68, 25], [10.4, 73.5, 21], [11.4, 79.5, 17], [12.4, 85, 13.5]],
    'b-fb': [[8.2, 75, 30.5], [9.4, 76, 31], [10.6, 77, 31.5], [12.4, 78, 31]],
    'b-cb': [[9.4, 87, 41], [10.4, 88, 37], [11.4, 90, 33], [12.4, 91.5, 31]],
    'b-cb2': [[9.4, 88, 55], [11, 90, 52], [12.4, 93.5, 49]],
    'b-dm': [[9.4, 78, 40], [11, 81.5, 38], [12.4, 84, 37]],
  },
  ball: [
    { kind: 'carry', by: 'a-wg', t0: 7, t1: 8.2 },
    { kind: 'pass', from: 'a-wg', to: 'a-fb', t0: 8.2, t1: 9.4, style: 'pass', note: 'Release ball', hold: 1.6 },
    { kind: 'carry', by: 'a-fb', t0: 9.4, t1: 12.4 },
  ],
  arrows: [
    { id: 'overlap', actor: 'a-fb', t0: 5, t1: 9.4, note: 'Overlap run', hold: 3.2 },
    { id: 'wg-follows-ball', actor: 'b-wg', t0: 7, t1: 9.4, note: 'Follows the ball', hold: 0.8 },
    { id: 'wg-recovers', actor: 'b-wg', t0: 9.4, t1: 12.4, note: 'Recovers', hold: 0 },
    { id: 'cb-shifts', actor: 'b-cb', t0: 9.4, t1: 12.4, note: 'Steps wide', hold: 0 },
    { id: 'cb2-covers', actor: 'b-cb2', t0: 10.4, t1: 12.4, note: 'Covers the 9', hold: 0 },
  ],
  beats: [
    { t: 7, text: 'The dilemma: Team B’s winger is caught between the ball carrier inside and the runner outside him.' },
    { t: 8.2, text: 'He stays with the ball. The outside channel ahead of the full-back is open.' },
    { t: 9.4, text: 'The full-back receives near the touchline with limited pressure; Team B’s winger is recovering from behind.' },
    { t: 10.4, text: 'Team B’s centre-back must weigh stepping out to the ball against holding his place; the second centre-back narrows to cover the 9.' },
    { t: 12.4, text: 'Decision point: the full-back can cross, play back inside, or cut the ball back. Choose an option.' },
  ],
};

const OUTCOME_B: OutcomeDef = {
  label: 'Outcome B · the winger tracks the overlap',
  tab: 'Outcome B · alternative',
  summary: 'Team B’s winger turns and follows the runner, so the full-back receives under pressure.',
  tracks: {
    'a-fb': [[8, 72.5, 4.6], [8.8, 77, 5], [9.8, 82, 6.5], [11, 84, 7.8], [12.4, 86, 9]],
    'a-wg': [[7.8, 70, 31], [8.8, 70.5, 31.2], [9.8, 71.5, 30], [11, 72.5, 27.5], [12.4, 74, 25]],
    'a-9': [[9.8, 84.5, 46], [11, 88, 46], [12.4, 89, 46]],
    'a-8': [[9.8, 81, 29.5], [11, 82, 28.5], [12.4, 83, 27]],
    'a-6': [[9.8, 60, 47], [12.4, 62, 42]],
    'b-wg': [[8, 66, 9], [9, 72, 7.5], [9.8, 77.5, 8.5], [11, 80, 10.5], [12.4, 81, 12.5]],
    'b-fb': [[8.8, 75, 30.5], [9.8, 76, 29.5], [11, 79, 24], [12.4, 83, 19]],
    'b-cb': [[9.8, 87, 41], [11, 88, 38], [12.4, 89.5, 35.5]],
    'b-cb2': [[9.8, 88, 55.5], [12.4, 92.5, 51.5]],
    'b-dm': [[9.8, 78, 40], [11, 82, 35], [12.4, 85.5, 32.5]],
  },
  ball: [
    { kind: 'carry', by: 'a-wg', t0: 7, t1: 8.8 },
    { kind: 'pass', from: 'a-wg', to: 'a-fb', t0: 8.8, t1: 9.8, style: 'pass', note: 'Release ball', hold: 1.6 },
    { kind: 'carry', by: 'a-fb', t0: 9.8, t1: 12.4 },
  ],
  arrows: [
    { id: 'overlap', actor: 'a-fb', t0: 5, t1: 9.8, note: 'Overlap run', hold: 3.2 },
    { id: 'wg-tracks', actor: 'b-wg', t0: 7, t1: 9.8, note: 'Tracks the run', hold: 2 },
    { id: 'fb-doubles-up', actor: 'b-fb', t0: 9.8, t1: 12.4, note: 'Helps out wide', hold: 0 },
    { id: 'dm-tucks', actor: 'b-dm', t0: 9.8, t1: 12.4, note: 'Screens the edge', hold: 0 },
  ],
  beats: [
    { t: 7, text: 'The dilemma: Team B’s winger is caught between the ball carrier inside and the runner outside him.' },
    { t: 8, text: 'He turns and sprints after the runner instead of staying with the ball.' },
    { t: 9.8, text: 'The full-back receives with the winger close behind: he has little time and must adjust.' },
    { t: 11, text: 'Team B’s full-back steps across to help, which leaves the inside lighter for Team A’s winger.' },
    { t: 12.4, text: 'Decision point under pressure: cross, play back inside, or cut the ball back. Choose an option.' },
  ],
};

// --- stage 5: the three options ---------------------------------------------

const CROSS: OptionDef = {
  title: 'Cross to the number 9',
  summary: 'A lofted delivery toward the penalty-spot zone, where the No. 9 attacks the space.',
  fitsWhen:
    'When the No. 9 has found a gap or the far centre-back is out of position, and the full-back has time to pick a delivery.',
  risk: 'The cross can be hurried by the recovering winger or headed away by a centre-back who gets goal-side.',
  end: 14.6,
  verdict: { type: 'delivery' },
  tracks: {
    'a-fb': [[14.6, 91, 9]],
    'a-9': [[13, 90.5, 45.5], [13.7, 92, 44.3]],
    'a-8': [[14.6, 84.5, 29]],
    'a-wg': [[14.6, 76.5, 25]],
    'b-cb': [[13, 92, 35], [13.7, 90.5, 38]],
    'b-cb2': [[13, 94.5, 48.5], [13.7, 96, 47]],
    'b-wg': [[13, 87, 13], [14.6, 88, 15]],
    'b-dm': [[13.7, 86, 38.5], [14.6, 86.5, 41]],
    'b-fb': [[13.7, 80, 33], [14.6, 81, 35]],
  },
  ball: [{ kind: 'pass', from: 'a-fb', to: [92.5, 44], t0: 12.4, t1: 13.7, style: 'lofted', note: 'Cross', hold: 1.6 }],
  arrows: [
    { id: 'nine-attacks', actor: 'a-9', t0: 12.4, t1: 13.7, hold: 1 },
    { id: 'cb2-contests', actor: 'b-cb2', t0: 12.8, t1: 13.7, hold: 0 },
  ],
  beats: [
    { t: 12.4, text: 'The full-back delivers toward the penalty-spot zone.' },
    { t: 13, text: 'The No. 9 attacks the space while the centre-backs close in to contest it.' },
  ],
  byOutcome: {
    B: {
      tracks: {
        'b-wg': [[12.9, 83, 11], [13.7, 85, 10.5], [14.6, 86, 14]],
        'b-fb': [[13.7, 81.5, 21], [14.6, 79.5, 26]],
        'b-cb': [[13, 91, 37], [13.7, 90.5, 38]],
        'b-cb2': [[13, 94.5, 49], [13.7, 96, 47]],
        'b-dm': [[13.7, 86.5, 36], [14.6, 86.5, 40]],
        'a-wg': [[14.6, 75, 24]],
      },
    },
  },
};

const COMBINE: OptionDef = {
  title: 'Pass back inside to the winger',
  summary: 'A short return to the winger, who has moved into a supporting position inside.',
  fitsWhen: 'When the winger is between the lines with time, or the cross is not on because the winger is tight behind.',
  risk: 'It slows the attack and gives Team B time to recover its shape and re-form the line.',
  end: 15,
  verdict: { type: 'lanes', to: ['a-8', 'a-9'] },
  tracks: {
    'a-wg': [[13.4, 80, 21.5], [15, 82, 24]],
    'a-fb': [[13.4, 92, 11], [15, 95, 20]],
    'a-8': [[13.4, 84, 27], [15, 86, 26]],
    'a-9': [[15, 90, 46]],
    'b-wg': [[13.4, 85, 15.5], [15, 84, 18]],
    'b-fb': [[13.4, 77, 27], [15, 77.5, 25]],
    'b-dm': [[13.4, 85, 34], [15, 85.5, 33]],
    'b-cb': [[15, 90.5, 34]],
  },
  ball: [
    { kind: 'pass', from: 'a-fb', to: 'a-wg', t0: 12.4, t1: 13.4, style: 'pass', note: 'Back inside', hold: 0.6 },
    { kind: 'carry', by: 'a-wg', t0: 13.4, t1: 15 },
  ],
  arrows: [{ id: 'fb-goes-inside', actor: 'a-fb', t0: 13.4, t1: 15, note: 'Runs for return', hold: 0.8 }],
  beats: [
    { t: 12.4, text: 'The full-back plays the ball back inside to the winger, who has stepped into support.' },
    { t: 13.4, text: 'Team B’s winger and full-back have to turn and reset; the full-back keeps moving for the return.' },
  ],
  byOutcome: {
    B: {
      tracks: {
        'a-wg': [[13.4, 77, 24.5], [15, 78, 27]],
        'a-fb': [[13.4, 88, 10], [15, 91, 17]],
        'b-wg': [[13.4, 83, 13.5], [15, 85, 16]],
        'b-fb': [[13.4, 80.5, 20], [15, 81, 22]],
      },
    },
  },
};

const CUTBACK: OptionDef = {
  title: 'Pass to the number 8',
  summary: 'A cutback along the ground to the No. 8, arriving at the attacking-side edge of the box.',
  fitsWhen: 'When the lane to the No. 8 is not covered and the nearest defender is too far away to close him at once.',
  risk: 'The pass can be intercepted if the screening midfielder or recovering winger gets across the lane.',
  end: 14.4,
  verdict: { type: 'receiver' },
  tracks: {
    'a-8': [[13, 84, 26.5], [13.4, 84.8, 26.2], [14.4, 85, 26.2]],
    'a-9': [[14.4, 90.5, 45]],
    'a-wg': [[14.4, 78.5, 22.5]],
    'a-fb': [[14.4, 92, 9]],
    'b-cb': [[14.4, 91, 34]],
    'b-dm': [[13.4, 85.2, 33], [14.4, 86.2, 32.2]],
    'b-fb': [[13.4, 80.5, 29.5], [14.4, 81, 28.3]],
    'b-wg': [[13.4, 87.5, 12.5], [14.4, 88, 15]],
  },
  ball: [
    { kind: 'pass', from: 'a-fb', to: 'a-8', t0: 12.4, t1: 13.4, style: 'pass', note: 'Cutback', hold: 0.6 },
    { kind: 'carry', by: 'a-8', t0: 13.4, t1: 14.4 },
  ],
  arrows: [{ id: 'eight-presents', actor: 'a-8', t0: 12.6, t1: 13.4, note: 'Presents', hold: 0.8 }],
  beats: [
    { t: 12.4, text: 'The No. 8 presents himself at the edge of the box and the full-back cuts the ball back to him.' },
    { t: 13.4, text: 'Team B’s defenders react to the pass and try to close the receiver.' },
  ],
  byOutcome: {
    B: {
      tracks: {
        'a-wg': [[14.4, 76.5, 24]],
        'b-cb': [[14.4, 91.5, 35.5]],
        'b-dm': [[13.4, 87, 32], [14.4, 88.5, 31]],
        'b-fb': [[13.4, 80, 19.5], [14.4, 81, 23]],
        'b-wg': [[13.4, 84.5, 11.5], [14.4, 86, 14]],
      },
    },
  },
};

export const OVERLAP_SCENARIO: TacticScenario = {
  id: 'overlap',
  title: 'Overlapping full-back',
  roles: ROLES,
  forkT: 7,
  decisionT: 12.4,
  base: BASE,
  outcomes: { A: OUTCOME_A, B: OUTCOME_B },
  options: { cross: CROSS, combine: COMBINE, cutback: CUTBACK },
  stages: [
    {
      id: 'carry',
      title: 'Full-back carries into the opposition half',
      summary: 'Carry, press, pass inside.',
      span: [0, 4.4],
      coaching: [
        'Carrying up the touchline commits Team B’s winger to a press. That is what frees the pass inside.',
        'The No. 9 and No. 8 are already placed centrally, so every defender has to keep one eye on them.',
        'The No. 6 sits deeper from the start. He is the insurance for everything that follows.',
      ],
    },
    {
      id: 'receive',
      title: 'Winger receives and carries inside',
      summary: 'Winger drives toward the half-space; the run starts.',
      span: [4.4, 7],
      coaching: [
        'The winger carries inside to pull Team B’s full-back and winger toward the middle, which opens the flank for the run.',
        'The overlap starts as the winger turns inside. Too early and the defender simply stays; too late and the winger runs out of room.',
      ],
    },
    {
      id: 'overlap',
      title: 'The overlap and the defensive decision',
      summary: 'Team B’s winger must pick: ball or runner.',
      span: { A: [7, 8.2], B: [7, 8.8] },
      coaching: [
        'The run outside creates a dilemma. Stay with the ball and the channel is open; follow the runner and the ball carrier gets time.',
        'Neither choice is always right. It depends on whether his full-back can pass the winger on and whether midfield covers the channel.',
      ],
      outcomeNotes: {
        A: 'Outcome A (default): he stays with the ball, so the full-back runs into the channel with limited pressure.',
        B: 'Outcome B: he tracks the runner. The full-back has less time, but Team B’s winger is no longer pressing the ball.',
      },
    },
    {
      id: 'release',
      title: 'Winger releases the overlapping full-back',
      summary: 'Pass wide and forward; defenders re-balance.',
      span: { A: [8.2, 12.4], B: [8.8, 12.4] },
      coaching: [
        'The pass goes forward and wide into the runner’s path, so he receives without breaking stride.',
        'The centre-back has two jobs: engage the full-back and keep the box protected. He can step out only if the other centre-back can take the striker, and that is how the marking changes.',
        'The No. 8 arrives at the edge of the box for a cutback or lay-off, and the No. 6 stays deeper to protect against a counter.',
      ],
      outcomeNotes: {
        A: 'Outcome A: Team B’s winger has to recover from the inside, so the full-back has a moment before the pressure arrives.',
        B: 'Outcome B: with the winger tight behind, Team B’s full-back may help out wide, which can leave room inside for Team A’s winger.',
      },
    },
  ],
  defaultOutcome: 'A',
  outcomeHeading: 'Defender’s decision',
  decisionPrompt: 'What does the full-back do?',
  decisionStage: {
    title: 'Decision point',
    summary: 'Cross, combine or cut back.',
    coaching: [
      'Cross when the No. 9 has a step on his marker and the full-back has time for the delivery.',
      'Play back inside when the winger is free and the cross is not on, to re-set the attack rather than force it.',
      'Cut the ball back when the lane to the No. 8 is open and the nearest defender is too far to close him quickly.',
    ],
  },
  spaces: [
    {
      id: 'channel',
      type: 'channel',
      runner: 'a-fb',
      window: [6.2, 11.4],
      label: 'Open channel',
    },
    {
      id: 'cross-lane',
      type: 'lane',
      mode: 'cross',
      from: 'ball',
      to: [92.5, 44],
      window: [10.2, 12.4],
      options: [null],
      label: 'Crossing lane',
    },
    {
      id: 'cb-gap',
      type: 'gap',
      between: ['b-cb', 'b-cb2'],
      attacker: 'a-9',
      window: [10.2, 12.4],
      options: [null],
      label: 'Gap between CBs',
    },
    {
      id: 'lane-8',
      type: 'lane',
      mode: 'ground',
      from: 'ball',
      to: 'a-8',
      window: [10.6, 13.4],
      options: [null, 'cutback'],
      label: 'Lane to the 8',
    },
    {
      id: 'winger-pocket',
      type: 'pocket',
      anchor: 'a-wg',
      window: [10.4, 15],
      options: [null, 'combine'],
      label: 'Winger’s room',
    },
    {
      id: 'cover-six',
      type: 'cover',
      anchor: 'a-6',
      radiusM: [9, 6],
      window: [0, 99],
      label: 'No. 6 cover',
    },
    {
      id: 'behind-fb',
      type: 'exposed',
      runner: 'a-fb',
      window: [6.4, 99],
      label: 'Space behind',
    },
    {
      id: 'cross-target',
      type: 'target',
      at: [92.5, 44],
      radiusM: 5,
      window: [12.4, 14.6],
      options: ['cross'],
      label: 'Target zone',
    },
  ],
  marking: [
    { id: 'cb-marks-9', defender: 'b-cb', attacker: 'a-9', window: [0, 9.8] },
    { id: 'cb2-marks-9-a', defender: 'b-cb2', attacker: 'a-9', window: [10.6, 99], outcomes: ['A'] },
    { id: 'cb2-marks-9-b', defender: 'b-cb2', attacker: 'a-9', window: [10, 99], outcomes: ['B'] },
    { id: 'fb-marks-wg', defender: 'b-fb', attacker: 'a-wg', window: [4.4, 9.4] },
  ],
  counters: [
    'Team B’s winger tracks the runner and his full-back helps, so the outside is covered (Outcome B).',
    'The centre-back holds his place and the screening midfielder or full-back covers the flank instead.',
    'Team B’s midfield line stays compact enough that the lane to the No. 8 is closed before the pass.',
    'The press forces the first pass backward, so the sequence never reaches the half-space.',
  ],
  caveat:
    'This is a teaching illustration built from fixed example positions. Real defenders react differently to the team’s shape, the score and the match situation.',
};
