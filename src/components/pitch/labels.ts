const MAX_LABEL = 12;

/** Lower-case name particles that belong to the surname that follows them. */
const PARTICLES = new Set(['de', 'da', 'do', 'dos', 'das', 'del', 'della', 'di', 'van', 'von', 'der', 'den', 'ter', 'la', 'le', 'el', 'al', 'bin', 'ibn', 'mac', 'st', 'st.']);

function truncate(label: string): string {
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
}

/**
 * Short on-pitch label: the surname, or the whole name when it is a single
 * word, truncated with an ellipsis. Particles stay with the surname ("De
 * Bruyne", "van Dijk"); a trailing number-only word ("Sub 0") falls back to
 * the full name so the label is never just "0". Full names live in tooltips
 * and the selection panel.
 */
export function compactName(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  let start = words.length - 1;
  // A trailing dotted abbreviation ("Manoj Md.") is not a surname on its own; keep the word before it.
  if (start > 0 && /^\p{L}{1,3}\.$/u.test(words[start])) start -= 1;
  while (start > 0 && PARTICLES.has(words[start - 1].toLowerCase())) start -= 1;
  const surname = words.slice(start).join(' ');
  if (!/\p{L}/u.test(surname)) return truncate(words.join(' '));
  return truncate(surname);
}
