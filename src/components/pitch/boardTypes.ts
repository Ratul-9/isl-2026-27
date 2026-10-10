import type { ArrowKind } from '@/domain/drawings';
import type { Id, TeamSide } from '@/domain/types';

/** Active board tool. Arrow tools draw that kind of arrow. */
export type Tool = 'select' | ArrowKind | 'freehand' | 'eraser';

export type BoardSelection =
  | { type: 'slot'; side: TeamSide; slotId: Id }
  | { type: 'drawing'; id: Id }
  | null;
