import type { SeasonPresets } from '@/domain/presets/types';
import { formatDiff } from './diff';
import type { SeasonDiff } from './diff';
import type { OverrideReport } from './overrides';
import { summarizeSeason } from './quality';
import type { PresetIssue } from './quality';

/** The human-readable import report (also written to `docs/presets/`). */

export interface ReportInput {
  doc: SeasonPresets;
  issues: PresetIssue[];
  diff: SeasonDiff | null;
  overrides: OverrideReport | null;
  /** Whether the data was written to disk or only previewed. */
  applied: boolean;
  expectedTeams?: number;
}

const GROUP_LIMIT = 40;

function table(headers: string[], rows: (string | number)[][]): string[] {
  const esc = (v: string | number) => String(v).replace(/\|/g, '\\|');
  return [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)];
}

export function buildReport(input: ReportInput): string {
  const { doc, issues, diff, overrides, applied } = input;
  const summary = summarizeSeason(doc);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const lines: string[] = [];

  lines.push(`# ${doc.league.name} ${doc.season} — team preset import report`, '');
  lines.push(`- Generated: ${doc.generatedAt}`);
  lines.push(`- Generator: ${doc.generator}`);
  lines.push(`- Status: ${applied ? 'written to disk' : 'PREVIEW ONLY — nothing was written'}`);
  lines.push(`- Teams: **${summary.teams}**${input.expectedTeams !== undefined ? ` (expected ${input.expectedTeams})` : ''}`);
  lines.push(`- Players: **${summary.players}**`);
  lines.push(`- Head coaches: **${summary.coaches}** of ${summary.teams} teams`);
  lines.push(`- Blocking errors: **${errors.length}**; warnings: **${warnings.length}**`, '');

  lines.push('## Sources', '');
  for (const s of doc.sources) lines.push(`- ${s.name}: ${s.url} (read ${s.retrievedAt})`);
  lines.push('');

  lines.push('## Teams', '');
  lines.push(
    ...table(
      ['Team', 'Abbr.', 'City', 'Head coach', 'Players', 'Logo'],
      doc.teams.map((t) => [t.displayName, t.abbreviation ?? '—', t.city ?? '—', t.coach?.name ?? '—', t.players.length, t.logoUrl ? 'yes' : 'no']),
    ),
    '',
  );

  lines.push('## Remaining gaps', '');
  lines.push(...table(['Gap', 'Count'], Object.entries(summary.gaps).map(([k, v]) => [k, v])), '');

  if (errors.length > 0) {
    lines.push('## Blocking errors', '');
    for (const e of errors) lines.push(`- ${e.message}`);
    lines.push('');
  }

  if (warnings.length > 0) {
    lines.push('## Warnings', '');
    const byCode = new Map<string, PresetIssue[]>();
    for (const w of warnings) byCode.set(w.code, [...(byCode.get(w.code) ?? []), w]);
    for (const [code, group] of byCode) {
      lines.push(`### ${code} (${group.length})`, '');
      for (const w of group.slice(0, GROUP_LIMIT)) lines.push(`- ${w.message}`);
      if (group.length > GROUP_LIMIT) lines.push(`- …and ${group.length - GROUP_LIMIT} more.`);
      lines.push('');
    }
  }

  if (overrides) {
    lines.push('## Overrides', '');
    lines.push(`- Applied: ${overrides.applied.length}`);
    for (const a of overrides.applied) lines.push(`  - ${a}`);
    if (overrides.redundant.length > 0) {
      lines.push(`- Now equal to the source (can be removed): ${overrides.redundant.length}`);
      for (const r of overrides.redundant) lines.push(`  - ${r}`);
    }
    if (overrides.unmatched.length > 0) {
      lines.push(`- Not matching any team/player (stale?): ${overrides.unmatched.length}`);
      for (const u of overrides.unmatched) lines.push(`  - ${u}`);
    }
    lines.push('');
  }

  if (diff) {
    lines.push('## Changes against the previous file', '');
    lines.push('```text', ...formatDiff(diff), '```', '');
  }

  return `${lines.join('\n')}\n`;
}
