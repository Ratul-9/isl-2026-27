import type { ReactNode } from 'react';
import { MemoryStore, StoreMatchRepository } from './repository';
import type { MatchRepository, SaveResult } from './repository';
import { RepositoryProvider } from './RepositoryContext';

/** A repository that persists (for status purposes) into memory. */
export function persistentMemoryRepository(): StoreMatchRepository {
  return new StoreMatchRepository(new MemoryStore(), true, () => new Date());
}

/** Wraps a repository so tests can make saves fail on demand. */
export class FlakyRepository implements MatchRepository {
  failWith: Extract<SaveResult, { ok: false }>['error'] | null = null;
  saves = 0;
  constructor(private readonly inner: MatchRepository) {}
  get persistent() {
    return this.inner.persistent;
  }
  list() {
    return this.inner.list();
  }
  load(id: string) {
    return this.inner.load(id);
  }
  save(match: Parameters<MatchRepository['save']>[0]): SaveResult {
    this.saves++;
    if (this.failWith) return { ok: false, error: this.failWith };
    return this.inner.save(match);
  }
  remove(id: string) {
    return this.inner.remove(id);
  }
}

export function WithRepository({ repository, notice = null, children }: { repository: MatchRepository; notice?: string | null; children: ReactNode }) {
  return <RepositoryProvider value={{ repository, notice }}>{children}</RepositoryProvider>;
}
