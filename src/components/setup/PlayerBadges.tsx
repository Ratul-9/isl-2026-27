import { describeEdits, playerEdits } from '@/domain/presets/snapshot';
import type { Player } from '@/domain/types';

/** Small tags that tell imported, corrected and hand-added players apart (preset teams only). */
export function PlayerBadges({ player, showCustom }: { player: Player; showCustom: boolean }) {
  const edits = playerEdits(player);
  if (edits === null) {
    return showCustom ? <Badge tone="info" title="Added by hand; not part of the imported squad">Added by you</Badge> : null;
  }
  const changes = describeEdits(player);
  return (
    <>
      {edits.numberMissing ? (
        <Badge tone="warn" title="The source gave no shirt number, so this one is temporary. Correct it in Edit.">
          Number missing
        </Badge>
      ) : null}
      {changes.length > 0 ? (
        <Badge tone="info" title={changes.join('. ')}>
          Corrected
        </Badge>
      ) : null}
    </>
  );
}

function Badge({ tone, title, children }: { tone: 'info' | 'warn'; title: string; children: string }) {
  return (
    <span
      title={title}
      className={
        tone === 'warn'
          ? 'rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-200'
          : 'rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[11px] text-sky-200'
      }
    >
      {children}
    </span>
  );
}
