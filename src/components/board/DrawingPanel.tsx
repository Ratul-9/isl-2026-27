'use client';

import { useState } from 'react';
import { ArrowLeftRight, Trash2 } from 'lucide-react';
import { ARROW_KINDS, DRAWING_LABELS, isArrowKind, MAX_NOTE_LENGTH, reverseDrawing } from '@/domain/drawings';
import type { Drawing, DrawingKind, Id } from '@/domain/types';
import { useMatch, useMatchActions } from '@/store/MatchContext';
import { DRAWING_STYLE } from '@/components/pitch/drawingStyle';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/fields';
import { cn } from '@/lib/cn';
import { playerLabel } from './playerLabel';

/** Editor for the selected drawing. */
export function DrawingPanel({ drawing, onDeleted }: { drawing: Drawing; onDeleted: () => void }) {
  const match = useMatch();
  const actions = useMatchActions();
  const from = playerLabel(match, drawing.fromPlayerId) ?? 'a pitch point';
  const to = playerLabel(match, drawing.toPlayerId) ?? 'a pitch point';
  const arrow = isArrowKind(drawing.kind);

  return (
    <section aria-label="Selected drawing" className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="flex items-center gap-2">
        <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: DRAWING_STYLE[drawing.kind].colour }} />
        <h3 className="text-sm font-semibold">{DRAWING_LABELS[drawing.kind]}</h3>
      </div>
      {arrow ? (
        <p className="text-xs text-zinc-400">
          From {from} to {to}.
        </p>
      ) : null}

      {arrow ? (
        <>
          <SelectField
            label="Type"
            value={drawing.kind}
            onChange={(e) => actions.updateDrawing(drawing.id, { kind: e.target.value as DrawingKind })}
          >
            {ARROW_KINDS.map((k) => (
              <option key={k} value={k}>
                {DRAWING_LABELS[k]}
              </option>
            ))}
          </SelectField>
          {drawing.kind === 'pass' || drawing.kind === 'lofted' ? (
            <Button
              size="sm"
              onClick={() => actions.updateDrawing(drawing.id, { kind: drawing.kind === 'pass' ? 'lofted' : 'pass' })}
            >
              {drawing.kind === 'pass' ? 'Make lofted pass (LD)' : 'Make ground pass'}
            </Button>
          ) : null}
        </>
      ) : null}

      {/* Keyed by id so switching drawings resets the draft text. */}
      <NoteField key={drawing.id} id={drawing.id} note={drawing.note ?? ''} />

      <div className="flex flex-wrap gap-2">
        {arrow ? (
          <Button
            size="sm"
            onClick={() => {
              const r = reverseDrawing(drawing);
              actions.updateDrawing(drawing.id, { from: r.from, to: r.to, fromPlayerId: r.fromPlayerId, toPlayerId: r.toPlayerId });
            }}
          >
            <ArrowLeftRight size={14} aria-hidden /> Reverse
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="danger"
          onClick={() => {
            actions.deleteDrawings([drawing.id]);
            onDeleted();
          }}
        >
          <Trash2 size={14} aria-hidden /> Delete
        </Button>
      </div>
      <p className="text-[11px] text-zinc-400">Delete/Backspace removes it; Esc deselects. Changes can be undone.</p>
    </section>
  );
}

/** Note text, committed on blur/Enter so typing is one undo step, not one per key. */
function NoteField({ id, note }: { id: Id; note: string }) {
  const actions = useMatchActions();
  const [text, setText] = useState(note);
  const commit = () => {
    if (text.trim() !== note) actions.updateDrawing(id, { note: text.trim() || undefined });
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      <TextField
        label="Note (optional)"
        value={text}
        maxLength={MAX_NOTE_LENGTH}
        placeholder="e.g. Switch play to the far side"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        hint="Shown beside the drawing. Press Enter to save."
      />
    </form>
  );
}

/** Every drawing as a list, so drawings are selectable without a pointer. */
export function DrawingList({ selectedId, onSelect }: { selectedId: Id | null; onSelect: (id: Id) => void }) {
  const match = useMatch();
  if (match.drawings.length === 0) return null;
  return (
    <section aria-label="Drawings" className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <h3 className="text-sm font-semibold">Drawings ({match.drawings.length})</h3>
      <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto">
        {match.drawings.map((d) => {
          const from = playerLabel(match, d.fromPlayerId);
          const to = playerLabel(match, d.toPlayerId);
          const detail = d.note ?? [from, to].filter(Boolean).join(' → ');
          return (
            <li key={d.id}>
              <button
                type="button"
                aria-pressed={d.id === selectedId}
                onClick={() => onSelect(d.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs',
                  d.id === selectedId ? 'bg-zinc-700 text-white' : 'text-zinc-300 hover:bg-zinc-800',
                )}
              >
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: DRAWING_STYLE[d.kind].colour }} />
                <span className="font-medium">{DRAWING_LABELS[d.kind]}</span>
                {detail ? <span className="truncate text-zinc-400">{detail}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
