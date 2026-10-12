// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { draftFromExtraction } from '@/domain/lineupImport/draft';
import { BENGALURU_GROUND_TRUTH, SC_DELHI_GROUND_TRUTH } from '@/domain/lineupImport/fixtures';
import type { ExtractedLineup } from '@/domain/lineupImport/types';
import { getFormation } from '@/domain/formations';
import { createGeminiProvider } from './geminiProvider';
import { readExtractionConfig } from './config';
import { extractLineup } from './service';

/**
 * GENUINE vision-provider integration tests.
 *
 * These call the real Gemini API with the real reference images, so they
 *   - use Gemini API quota or credit (a few thousand tokens per image, plus reasoning tokens),
 *   - need network access, and
 *   - are SKIPPED unless BOTH are set:
 *       GEMINI_API_KEY         a real key (Google AI Studio)
 *       LINEUP_FIXTURE_DIR     folder containing the supplied graphics, e.g.
 *                              "Bengaluru FC Starting Lineup 10.8.2026.png" and
 *                              "SC Delhi Starting Lineup 10.8.2026.png"
 *
 *   GEMINI_API_KEY=… LINEUP_FIXTURE_DIR="$HOME/Desktop/ISL Starting Lineups" npx vitest run src/lineup-extraction/provider.integration.test.ts
 *
 * A skipped run proves NOTHING about extraction quality. The mocked and
 * wire-level tests in extraction.test.ts prove the plumbing only.
 * Model output can vary between runs; a failure here is information about the
 * model/prompt, not necessarily a code defect.
 */

const config = readExtractionConfig();
const dir = process.env.LINEUP_FIXTURE_DIR?.trim();
const enabled = config.apiKey !== null && !!dir && existsSync(dir);

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();

interface Case {
  file: string;
  truth: ExtractedLineup;
  teamNameContains: string;
  formation: string;
  slotNames: string[];
}

const CASES: Case[] = [
  {
    file: 'Bengaluru FC Starting Lineup 10.8.2026.png',
    truth: BENGALURU_GROUND_TRUTH,
    teamNameContains: 'BENGALURU',
    formation: '4-3-3',
    slotNames: ['GURPREET', 'NAOREM', 'SANA', 'KOCH', 'SHIVALDO', 'MARTÍNEZ', 'FANAI', 'SURESH', 'ASHIQUE', 'PEROVIC', 'RYAN'],
  },
  {
    file: 'SC Delhi Starting Lineup 10.8.2026.png',
    truth: SC_DELHI_GROUND_TRUTH,
    teamNameContains: 'DELHI',
    formation: '5-3-2',
    slotNames: ['FERNANDES', 'TOMBA', 'MANOJ MD.', 'DUVAN', 'NDUKA', 'GOGOU', 'PEÑA', 'AZHAR', 'HNAMTE', 'RODRIGUINHO', 'AIMEN'],
  },
];

describe.skipIf(!enabled)('real provider: supplied reference graphics', () => {
  for (const c of CASES) {
    it(
      `${c.file}`,
      async () => {
        const full = path.join(dir as string, c.file);
        if (!existsSync(full)) throw new Error(`Fixture not found: ${full}`);
        const data = readFileSync(full).toString('base64');
        const provider = createGeminiProvider({ apiKey: config.apiKey as string, model: config.model, baseUrl: config.baseUrl ?? undefined });

        const result = await extractLineup({ mediaType: 'image/png', data }, provider);
        if (!result.ok) throw new Error(`Extraction failed: ${result.failure.code}: ${result.failure.message}`);
        const lineup = result.lineup;

        // Raw extraction against hand-transcribed truth.
        expect(norm(lineup.teamName)).toContain(c.teamNameContains);
        expect(norm(lineup.coach)).toBe(norm(c.truth.coach));
        expect(lineup.formation?.replace(/\s/g, '')).toBe(c.formation);
        expect(lineup.starters).toHaveLength(11);
        expect(lineup.substitutes).toHaveLength(c.truth.substitutes.length);
        expect(lineup.starters.map((p) => p.shirtNumber).sort()).toEqual(c.truth.starters.map((p) => p.shirtNumber).sort());
        expect(lineup.substitutes.map((p) => p.shirtNumber).sort()).toEqual(c.truth.substitutes.map((p) => p.shirtNumber).sort());
        for (const expected of c.truth.substitutes) {
          const got = lineup.substitutes.find((p) => p.shirtNumber === expected.shirtNumber);
          expect(norm(got?.name), `substitute #${expected.shirtNumber}`).toBe(norm(expected.name));
        }

        // Through the real assignment pipeline into the formation engine.
        const team = draftFromExtraction(lineup, (() => { let n = 0; return () => `k${n++}`; })());
        expect(team.formation).toBe(c.formation);
        const template = getFormation(team.formation).slots;
        const names = template.map((_, i) => norm(team.starters.find((p) => p.slot === i)?.name));
        expect(names).toEqual(c.slotNames.map(norm));
      },
      240_000,
    );
  }
});

describe.skipIf(enabled)('real provider (skipped)', () => {
  it('is skipped: set GEMINI_API_KEY and LINEUP_FIXTURE_DIR to run the genuine integration tests', () => {
    expect(enabled).toBe(false);
  });
});
