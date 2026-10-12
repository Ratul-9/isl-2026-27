// Test-only bridge to the persistence layer (the domain module must not import it in production code).
import { parseMatchJson } from '@/persistence/document';
export const parseDocument = parseMatchJson;
import { serializeDocument } from '@/persistence/document';
import type { Match } from '../types';

export function serializeDocumentForTest(match: Match): string {
  return serializeDocument(match, new Date('2026-10-11T00:00:00Z'));
}
