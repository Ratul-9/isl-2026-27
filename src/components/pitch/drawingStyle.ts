import type { DrawingKind } from '@/domain/types';
import { PITCH_THEME as T } from './pitchTheme';

export interface DrawingStyle {
  colour: string;
  width: number;
  dash?: string;
  arrowhead: boolean;
}

/** Visual language: yellow passes, red shots, dashed runs, LD-labelled lofted passes. */
export const DRAWING_STYLE: Record<DrawingKind, DrawingStyle> = {
  pass: { colour: T.pass, width: 0.45, arrowhead: true },
  lofted: { colour: T.pass, width: 0.45, arrowhead: true },
  shot: { colour: T.shot, width: 0.55, arrowhead: true },
  movement: { colour: T.movement, width: 0.4, dash: '1.4 0.9', arrowhead: true },
  freehand: { colour: T.freehand, width: 0.35, arrowhead: false },
};
