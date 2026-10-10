import type { Id } from './types';

/** Generates an opaque stable ID such as `plr_3f2a…`. */
export function createId(prefix: string): Id {
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random}`;
}
