import type { FormationRef, SavedLayout } from '@/domain/types';
import { FORMATIONS, isFormationId } from '@/domain/formations';

/** `<select>` value encoding for a formation reference. */
export function encodeFormation(ref: FormationRef): string {
  return `${ref.kind}:${ref.id}`;
}

export function decodeFormation(value: string, savedLayouts: readonly SavedLayout[]): FormationRef | null {
  const [kind, ...rest] = value.split(':');
  const id = rest.join(':');
  if (kind === 'preset' && isFormationId(id)) return { kind, id };
  if (kind === 'saved' && savedLayouts.some((l) => l.id === id)) return { kind, id };
  return null;
}

export function formationLabel(ref: FormationRef, savedLayouts: readonly SavedLayout[]): string {
  if (ref.kind === 'preset') return FORMATIONS.find((f) => f.id === ref.id)?.label ?? ref.id;
  return savedLayouts.find((l) => l.id === ref.id)?.name ?? 'Custom';
}
