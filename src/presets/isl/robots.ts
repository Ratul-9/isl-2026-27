/**
 * A small robots.txt reader, so the importer can refuse any URL the site asks automated clients
 * not to fetch. It implements the common subset: `User-agent` groups, `Allow`/`Disallow` with `*`
 * and `$`, and longest-match precedence. A missing robots.txt means "no restrictions"; an
 * unreadable one is treated as "no restrictions" only when the caller says it was a 404.
 */

interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface Robots {
  /** Rules that apply to our user agent (its own group if present, otherwise `*`). */
  rules: RobotsRule[];
  crawlDelaySeconds: number | null;
  sitemaps: string[];
}

export function parseRobots(text: string, userAgent: string): Robots {
  const product = userAgent.split(/[\s/]/)[0].toLowerCase();
  const groups: { agents: string[]; rules: RobotsRule[]; delay: number | null }[] = [];
  const sitemaps: string[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'sitemap') {
      sitemaps.push(value);
      continue;
    }
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], delay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'allow' || field === 'disallow') {
      // An empty Disallow means "allow everything" and contributes no rule.
      if (value) current.rules.push({ allow: field === 'allow', pattern: value });
    } else if (field === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.delay = n;
    }
  }

  const own = groups.filter((g) => g.agents.some((a) => a !== '*' && product.includes(a)));
  const star = groups.filter((g) => g.agents.includes('*'));
  const chosen = own.length > 0 ? own : star;
  return {
    rules: chosen.flatMap((g) => g.rules),
    crawlDelaySeconds: chosen.map((g) => g.delay).find((d) => d !== null) ?? null,
    sitemaps,
  };
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** Whether `pathAndQuery` (e.g. `/clubs/656-x/squad`) may be fetched. The longest matching rule wins; Allow wins ties. */
export function isAllowed(robots: Robots, pathAndQuery: string): boolean {
  let best: { length: number; allow: boolean } | null = null;
  for (const rule of robots.rules) {
    if (!patternToRegExp(rule.pattern).test(pathAndQuery)) continue;
    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) best = { length, allow: rule.allow };
  }
  return best ? best.allow : true;
}
