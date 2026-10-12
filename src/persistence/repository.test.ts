import { describe, expect, it } from 'vitest';
import { createMatch } from '@/domain/match';
import { serializeDocument } from './document';
import {
  classifyStorageError,
  createBrowserRepository,
  createMemoryRepository,
  KEY_PREFIX,
  MemoryStore,
  StoreMatchRepository,
} from './repository';
import type { KeyValueStore } from './repository';
import { richMatch } from './testFixtures';

const at = (n: number) => () => new Date(Date.UTC(2026, 9, 10, 12, n));

class QuotaError extends Error {
  name = 'QuotaExceededError';
}

describe('StoreMatchRepository', () => {
  it('saves, lists and loads matches exactly, newest first', () => {
    let minute = 0;
    const repo = new StoreMatchRepository(new MemoryStore(), true, () => at(minute++)());
    const a = { ...richMatch(), id: 'a', name: 'Alpha' };
    const b = { ...createMatch(), id: 'b' };
    expect(repo.save(a)).toMatchObject({ ok: true });
    expect(repo.save(b)).toMatchObject({ ok: true });

    const listing = repo.list();
    expect(listing.corrupt).toEqual([]);
    expect(listing.entries.map((e) => e.id)).toEqual(['b', 'a']);
    expect(listing.entries[1]).toMatchObject({ title: 'Alpha', homeName: 'Home FC', awayName: 'Away FC', status: 'inProgress', date: '2026-10-10' });

    const loaded = repo.load('a');
    expect(loaded).toMatchObject({ ok: true });
    if (loaded.ok) expect(loaded.match).toEqual(a);
  });

  it('overwrites on save and removes on delete', () => {
    const repo = createMemoryRepository();
    const m = createMatch();
    repo.save(m);
    repo.save({ ...m, venue: 'Updated' });
    expect(repo.list().entries).toHaveLength(1);
    const loaded = repo.load(m.id);
    expect(loaded.ok && loaded.match.venue).toBe('Updated');
    expect(repo.remove(m.id)).toEqual({ ok: true });
    expect(repo.load(m.id)).toMatchObject({ ok: false, reason: 'missing' });
    expect(repo.list().entries).toEqual([]);
  });

  it('only lists its own keys', () => {
    const store = new MemoryStore();
    store.setItem('somebody-elses-key', '{"a":1}');
    const repo = new StoreMatchRepository(store, true);
    repo.save(createMatch());
    expect(repo.list().entries).toHaveLength(1);
    expect(repo.list().corrupt).toEqual([]);
  });

  it('reports corrupt entries without failing the whole library', () => {
    const store = new MemoryStore();
    const repo = new StoreMatchRepository(store, true);
    const good = createMatch();
    repo.save(good);
    store.setItem(`${KEY_PREFIX}broken-json`, '{not json');
    store.setItem(`${KEY_PREFIX}wrong-shape`, JSON.stringify({ format: 'dizpitch.match', schemaVersion: 2, match: { id: 'x' } }));
    store.setItem(`${KEY_PREFIX}future`, serializeDocument(good, new Date()).replace(/"schemaVersion": \d+/, '"schemaVersion": 9'));

    const listing = repo.list();
    expect(listing.entries.map((e) => e.id)).toEqual([good.id]);
    expect(listing.corrupt.map((c) => c.id)).toEqual(['broken-json', 'future', 'wrong-shape']);
    expect(listing.corrupt[0].errors[0]).toMatch(/not valid JSON/);
    expect(listing.corrupt[1].errors[0]).toMatch(/newer version/);

    expect(repo.load('broken-json')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(repo.remove('broken-json')).toEqual({ ok: true });
    expect(repo.list().corrupt).toHaveLength(2);
  });

  it('returns a quota failure instead of throwing, leaving the previous version intact', () => {
    const store = new MemoryStore();
    const repo = new StoreMatchRepository(store, true);
    const m = createMatch();
    repo.save(m);
    const full: KeyValueStore = Object.assign(Object.create(store), {
      setItem: () => {
        throw new QuotaError('full');
      },
    });
    const failing = new StoreMatchRepository(full, true);
    const result = failing.save({ ...m, venue: 'Lost' });
    expect(result).toMatchObject({ ok: false, error: { kind: 'quota' } });
    const loaded = repo.load(m.id);
    expect(loaded.ok && loaded.match.venue).toBe('');
  });

  it('survives a store that throws on every read', () => {
    const throwing: KeyValueStore = {
      length: 1,
      key: () => `${KEY_PREFIX}x`,
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem: () => {},
      removeItem: () => {},
    };
    const repo = new StoreMatchRepository(throwing, true);
    expect(repo.list().corrupt).toHaveLength(1);
    expect(repo.load('x')).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('storage errors and browser fallback', () => {
  it('classifies quota, blocked and unknown failures', () => {
    expect(classifyStorageError(new QuotaError()).kind).toBe('quota');
    expect(classifyStorageError(Object.assign(new Error('x'), { code: 22 })).kind).toBe('quota');
    expect(classifyStorageError(new DOMException('no', 'SecurityError')).kind).toBe('unavailable');
    expect(classifyStorageError('weird')).toMatchObject({ kind: 'unknown' });
  });

  it('uses storage when it works and an in-memory fallback with a notice when it does not', () => {
    const ok = createBrowserRepository(new MemoryStore());
    expect(ok.repository.persistent).toBe(true);
    expect(ok.notice).toBeNull();

    const blocked: KeyValueStore = {
      length: 0,
      key: () => null,
      getItem: () => null,
      setItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      removeItem: () => {},
    };
    const fallback = createBrowserRepository(blocked);
    expect(fallback.repository.persistent).toBe(false);
    expect(fallback.notice).toMatch(/blocked.*only until you close or reload/);
    // The fallback still works for the session.
    const m = createMatch();
    expect(fallback.repository.save(m)).toMatchObject({ ok: true });
    expect(fallback.repository.load(m.id)).toMatchObject({ ok: true });
  });
});
