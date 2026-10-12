import type { Point } from '../types';
import type { GoalkeeperEdge } from './types';

/**
 * Converts a position on the lineup graphic's pitch (0–1 from its left/top
 * edge) into DizPitch's TEAM frame: x = depth from the team's own goal line
 * (0) toward the goal it attacks (1), y = 0 at the team's own left touchline.
 *
 * `edge` is the edge of the graphic's pitch where the team's own goal is.
 * Facing the opposite end, the team's left hand is:
 *   goal at bottom → attacks up    → left = image left
 *   goal at top    → attacks down  → left = image right
 *   goal at left   → attacks right → left = image top
 *   goal at right  → attacks left  → left = image bottom
 */
export function imageToTeamFrame(p: Point, edge: GoalkeeperEdge): Point {
  switch (edge) {
    case 'bottom':
      return { x: 1 - p.y, y: p.x };
    case 'top':
      return { x: p.y, y: 1 - p.x };
    case 'left':
      return { x: p.x, y: p.y };
    case 'right':
      return { x: 1 - p.x, y: 1 - p.y };
  }
}
