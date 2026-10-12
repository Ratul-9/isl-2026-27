import { trackSide } from '@/domain/tracking/sample';
import type { Player, TeamSide, TrackingData, TrackingTrack } from '@/domain/types';
import { compactName } from '@/components/pitch/labels';
import { PITCH_THEME as T } from '@/components/pitch/pitchTheme';

/** How tracks are coloured and labelled, shared by the pitch, the video overlay and the panels. */

export interface TrackNames {
  teams: { home: string; away: string };
  players: ReadonlyMap<string, Player>;
}

const REFEREE = { fill: '#111827', text: '#facc15', stroke: '#facc15' };
const UNKNOWN = { fill: '#71717a', text: '#ffffff', stroke: '#27272a' };

function readableText(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#18181b' : '#ffffff';
}

/** Side colours once the user has mapped teams; until then the kit colour the clusters were built from. */
export function trackColours(tracking: TrackingData, track: TrackingTrack): { fill: string; text: string; stroke: string; side: TeamSide | null } {
  if (track.objectType === 'referee') return { ...REFEREE, side: null };
  const side = trackSide(tracking, track);
  if (side) return { ...T[side], side };
  const cluster = tracking.teams.clusters.find((c) => c.id === track.team);
  if (cluster) return { fill: cluster.colorHex, text: readableText(cluster.colorHex), stroke: '#27272a', side: null };
  return { ...UNKNOWN, side: null };
}

export function trackKindLabel(track: TrackingTrack): string {
  return { player: 'Player', goalkeeper: 'Goalkeeper', referee: 'Referee', ball: 'Ball' }[track.objectType];
}

/** Text inside the marker (shirt number of a linked player, else the tracker id), below it, and for screen readers. */
export function trackLabel(tracking: TrackingData, track: TrackingTrack, names: TrackNames): { inside: string; below: string; description: string } {
  if (track.objectType === 'ball') return { inside: '', below: '', description: 'Ball' };
  const player = track.playerId ? names.players.get(track.playerId) : undefined;
  const side = trackSide(tracking, track);
  const team = track.objectType === 'referee' ? 'Referee' : side ? names.teams[side] : 'Team not set';
  const id = track.trackerId !== null ? `#${track.trackerId}` : track.id;
  if (player) {
    return { inside: String(player.shirtNumber), below: compactName(player.name), description: `${team}: ${player.shirtNumber} ${player.name} (track ${id})` };
  }
  return { inside: track.trackerId !== null ? String(track.trackerId) : '', below: id, description: `${team}: ${trackKindLabel(track)} track ${id}` };
}
