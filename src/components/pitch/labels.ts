const MAX_LABEL = 12;

/**
 * Short on-pitch label: the surname (last word), or the whole name when it is
 * a single word, truncated with an ellipsis. Full names live in tooltips and
 * the selection panel.
 */
export function compactName(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const label = words[words.length - 1];
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
}
