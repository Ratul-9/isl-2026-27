import { NEXT_PERIODS } from '@/domain/clock';
import type { ClockState, Period } from '@/domain/types';

export interface PeriodStep {
  to: Period;
  label: string;
  /** Primary action for the current period; others are shown as secondary. */
  primary: boolean;
}

const STEP_LABELS: Partial<Record<Period, string>> = {
  firstHalf: 'Kick off',
  halfTime: 'Half time',
  secondHalf: 'Start second half',
  extraTimeFirstHalf: 'Extra time',
  extraTimeSecondHalf: 'Extra time half-time',
  fullTime: 'Full time',
};

/** The period changes available from the current period, labelled for buttons. */
export function periodSteps(clock: ClockState): PeriodStep[] {
  return NEXT_PERIODS[clock.period].map((to, index) => ({
    to,
    label: STEP_LABELS[to] ?? to,
    primary: index === 0,
  }));
}
