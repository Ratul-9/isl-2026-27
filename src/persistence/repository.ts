import type { Match, MatchStatus } from '@/domain/types';
import { parseMatchJson, serializeDocument } from './document';

/**
 * Where matches live. The UI only knows this interface, so localStorage can be
 * swapped for IndexedDB later without touching components. Nothing here
 * throws: failures come back as values so the editor never loses in-memory work.
 */

export interface LibraryEntry {
  id: string;
  /** Explicit name, or "Home vs Away", etc. */
  title: string;
  homeName: string;
  awayName: string;
  date: string;
  kickoffTime: string;
  status: MatchStatus;
  /** ISO timestamp of the last save, if known. */
  savedAt: string | null;
  /** Problems found when it loaded (e.g. events that no longer fit the squads). */
  warnings: string[];
}

interface CorruptEntry {
  /** Storage key suffix; usable with `remove`. */
  id: string;
  errors: string[];
}

export interface LibraryListing {
  entries: LibraryEntry[];
  corrupt: CorruptEntry[];
}

export type StorageFailure =
  | { kind: 'quota'; message: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'unknown'; message: string };

export type SaveResult = { ok: true; savedAt: string } | { ok: false; error: StorageFailure };

export type LoadResult =
  | { ok: true; match: Match; warnings: string[] }
  | { ok: false; reason: 'missing' | 'invalid'; errors: string[] };

export interface MatchRepository {
  /** False when data only lives for this tab (storage blocked or in-memory). */
  readonly persistent: boolean;
  list(): LibraryListing;
  load(id: string): LoadResult;
  save(match: Match): SaveResult;
  remove(id: string): { ok: true } | { ok: false; error: StorageFailure };
}

export const KEY_PREFIX = 'dizpitch:match:';
const keyFor = (id: string) => `${KEY_PREFIX}${id}`;

/** Minimal slice of `Storage`, so tests can supply a fake. */
export interface KeyValueStore {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function classifyStorageError(error: unknown): StorageFailure {
  // DOMException is not reliably `instanceof Error` across environments: read fields structurally.
  const fields = (typeof error === 'object' && error !== null ? error : {}) as { name?: unknown; code?: unknown; message?: unknown };
  const name = typeof fields.name === 'string' ? fields.name : '';
  const code = fields.code;
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014) {
    return { kind: 'quota', message: 'Browser storage is full. Export the match to a file and delete old matches to free space.' };
  }
  if (name === 'SecurityError') {
    return { kind: 'unavailable', message: 'Browser storage is blocked (for example in a private window or by site settings).' };
  }
  const detail = typeof fields.message === 'string' && fields.message ? ` (${fields.message})` : '';
  return { kind: 'unknown', message: `The match could not be written to browser storage${detail}.` };
}

function titleOf(match: Match): string {
  const explicit = match.name.trim();
  if (explicit) return explicit;
  const home = match.home.name.trim();
  const away = match.away.name.trim();
  if (home && away) return `${home} vs ${away}`;
  return home || away ? `${home || away} match` : 'Untitled match';
}

function entryFor(match: Match, savedAt: string | null, warnings: string[]): LibraryEntry {
  return {
    id: match.id,
    title: titleOf(match),
    homeName: match.home.name.trim(),
    awayName: match.away.name.trim(),
    date: match.date,
    kickoffTime: match.kickoffTime,
    status: match.status,
    savedAt,
    warnings,
  };
}

/** Most recently saved first; entries without a timestamp last. */
function bySavedAtDesc(a: LibraryEntry, b: LibraryEntry): number {
  return (b.savedAt ?? '').localeCompare(a.savedAt ?? '') || a.title.localeCompare(b.title);
}

/** Repository over any key/value store (localStorage, or a map for tests and fallback). */
export class StoreMatchRepository implements MatchRepository {
  constructor(
    private readonly store: KeyValueStore,
    readonly persistent: boolean,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(): LibraryListing {
    const entries: LibraryEntry[] = [];
    const corrupt: CorruptEntry[] = [];
    const keys: string[] = [];
    try {
      for (let i = 0; i < this.store.length; i++) {
        const key = this.store.key(i);
        if (key?.startsWith(KEY_PREFIX)) keys.push(key);
      }
    } catch {
      return { entries, corrupt };
    }
    for (const key of keys) {
      const id = key.slice(KEY_PREFIX.length);
      const result = this.read(key);
      if (result.ok) entries.push(entryFor(result.match, result.savedAt, result.warnings));
      else corrupt.push({ id, errors: result.errors });
    }
    return { entries: entries.sort(bySavedAtDesc), corrupt: corrupt.sort((a, b) => a.id.localeCompare(b.id)) };
  }

  private read(key: string): { ok: true; match: Match; savedAt: string | null; warnings: string[] } | { ok: false; errors: string[] } {
    let text: string | null;
    try {
      text = this.store.getItem(key);
    } catch (error) {
      return { ok: false, errors: [classifyStorageError(error).message] };
    }
    if (text === null) return { ok: false, errors: ['This match is no longer in browser storage.'] };
    const parsed = parseMatchJson(text);
    return parsed.ok
      ? { ok: true, match: parsed.match, savedAt: parsed.savedAt, warnings: parsed.warnings }
      : { ok: false, errors: parsed.errors };
  }

  load(id: string): LoadResult {
    const key = keyFor(id);
    try {
      if (this.store.getItem(key) === null) return { ok: false, reason: 'missing', errors: ['This match is not in browser storage.'] };
    } catch (error) {
      return { ok: false, reason: 'invalid', errors: [classifyStorageError(error).message] };
    }
    const result = this.read(key);
    if (!result.ok) return { ok: false, reason: 'invalid', errors: result.errors };
    return { ok: true, match: result.match, warnings: result.warnings };
  }

  save(match: Match): SaveResult {
    const savedAt = this.now();
    try {
      this.store.setItem(keyFor(match.id), serializeDocument(match, savedAt));
      return { ok: true, savedAt: savedAt.toISOString() };
    } catch (error) {
      return { ok: false, error: classifyStorageError(error) };
    }
  }

  remove(id: string): { ok: true } | { ok: false; error: StorageFailure } {
    try {
      this.store.removeItem(keyFor(id));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: classifyStorageError(error) };
    }
  }
}

/** A non-persistent store: used by tests and as the fallback when storage is blocked. */
export class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(index: number) {
    return Array.from(this.map.keys())[index] ?? null;
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

export function createMemoryRepository(now?: () => Date): StoreMatchRepository {
  return new StoreMatchRepository(new MemoryStore(), false, now);
}

export interface BrowserRepository {
  repository: MatchRepository;
  /** Set when storage is unusable and the in-memory fallback was used. */
  notice: string | null;
}

/** localStorage when it works; otherwise an in-memory repository plus an explanation. */
export function createBrowserRepository(storage?: KeyValueStore): BrowserRepository {
  try {
    const store = storage ?? window.localStorage;
    const probe = `${KEY_PREFIX}__probe__`;
    store.setItem(probe, '1');
    store.removeItem(probe);
    return { repository: new StoreMatchRepository(store, true), notice: null };
  } catch (error) {
    return {
      repository: createMemoryRepository(),
      notice: `${classifyStorageError(error).message} Matches will be kept only until you close or reload this tab — export them to keep a copy.`,
    };
  }
}
