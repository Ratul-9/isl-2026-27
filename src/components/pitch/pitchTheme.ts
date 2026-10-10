/**
 * Concrete colours for the SVG board. Hex values (not CSS variables) so the
 * board renders identically when serialised for PNG export in Phase 6.
 * Keep in sync with the tokens in `globals.css`.
 */
export const PITCH_THEME = {
  surround: '#17592b',
  grass: '#1f7a3a',
  grassStripe: '#22843f',
  line: '#f5f7f5',
  pass: '#facc15',
  movement: '#f8fafc',
  home: { fill: '#1d4ed8', text: '#ffffff', stroke: '#0b1f5c' },
  away: { fill: '#f4f4f5', text: '#18181b', stroke: '#3f3f46' },
  selection: '#34d399',
  labelText: '#ffffff',
  labelHalo: 'rgba(0,0,0,0.65)',
} as const;

/** Marker radius in metres; arrows are trimmed by this so heads stay visible. */
export const MARKER_RADIUS = 2.4;
