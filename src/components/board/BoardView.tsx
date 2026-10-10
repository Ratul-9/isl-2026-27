'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Users } from 'lucide-react';
import type { Orientation } from '@/domain/geometry';
import { useBoardHistory, useMatch, useMatchActions } from '@/store/MatchContext';
import type { BoardSelection, Tool } from '@/components/pitch/boardTypes';
import { TacticalBoard } from '@/components/pitch/TacticalBoard';
import type { TacticalBoardHandle } from '@/components/pitch/TacticalBoard';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { DrawingList, DrawingPanel } from './DrawingPanel';
import { DrawingToolbar, TOOLS } from './DrawingToolbar';
import { FormationPanel, SavedLayoutsPanel } from './FormationPanel';
import { PatternPanel } from './PatternPanel';
import { SelectionPanel } from './SelectionPanel';

/** True when a key press belongs to a text field or other form control. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** The tactical board workspace: tools and pitch in the centre, controls alongside. */
export function BoardView({ onOpenSetup }: { onOpenSetup: () => void }) {
  const match = useMatch();
  const actions = useMatchActions();
  const history = useBoardHistory();
  const boardRef = useRef<TacticalBoardHandle>(null);
  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [snap, setSnap] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [selection, setSelection] = useState<BoardSelection>(null);
  const noPlayers = match.home.players.length === 0 && match.away.players.length === 0;

  const selectedDrawing =
    selection?.type === 'drawing' ? match.drawings.find((d) => d.id === selection.id) : undefined;
  const selectedSlot = selection?.type === 'slot' ? selection : null;

  function changeTool(next: Tool) {
    boardRef.current?.cancelGesture();
    setTool(next);
    // Drawing tools don't select; keep a selected drawing visible only in select mode.
    if (next !== 'select') setSelection(null);
  }

  // Keyboard shortcuts for the board (ignored while typing in a form field).
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (isTypingTarget(e.target)) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) history.redo();
      else history.undo();
      return;
    }
    if (mod && key === 'y') {
      e.preventDefault();
      history.redo();
      return;
    }
    if (mod || e.altKey) return;
    if (e.key === 'Escape') {
      if (!boardRef.current?.cancelGesture()) setSelection(null);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDrawing) {
      e.preventDefault();
      actions.deleteDrawings([selectedDrawing.id]);
      setSelection(null);
      return;
    }
    const shortcut = TOOLS.find((t) => t.shortcut.toLowerCase() === key);
    if (shortcut) changeTool(shortcut.id);
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  return (
    <div className="mx-auto grid w-full max-w-[110rem] flex-1 gap-4 px-4 py-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="flex min-w-0 flex-col gap-3">
        <DrawingToolbar tool={tool} onToolChange={changeTool} />
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Pitch orientation" className="flex gap-1 rounded-md bg-zinc-900 p-1">
            {(['landscape', 'portrait'] as const).map((o) => (
              <button
                key={o}
                type="button"
                aria-pressed={orientation === o}
                onClick={() => setOrientation(o)}
                className={cn(
                  'rounded px-3 py-1.5 text-xs font-medium capitalize',
                  orientation === o ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-100',
                )}
              >
                {o}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={snap}
              onChange={(e) => setSnap(e.target.checked)}
              className="h-4 w-4 accent-emerald-500"
            />
            Snap to grid
          </label>
          {noPlayers ? (
            <div className="ml-auto flex items-center gap-2 text-xs text-zinc-400">
              <span>No players yet — empty positions are shown.</span>
              <Button size="sm" onClick={onOpenSetup}>
                <Users size={14} aria-hidden /> Add squads
              </Button>
            </div>
          ) : null}
        </div>
        <div className="flex min-h-0 justify-center rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
          <TacticalBoard
            ref={boardRef}
            orientation={orientation}
            snap={snap}
            tool={tool}
            selection={selection}
            onSelect={setSelection}
          />
        </div>
      </div>

      <aside aria-label="Board controls" className="flex flex-col gap-3">
        {selectedDrawing ? (
          <DrawingPanel drawing={selectedDrawing} onDeleted={() => setSelection(null)} />
        ) : (
          <SelectionPanel selected={selectedSlot} onClear={() => setSelection(null)} />
        )}
        <DrawingList
          selectedId={selectedDrawing?.id ?? null}
          onSelect={(id) => {
            changeTool('select');
            setSelection({ type: 'drawing', id });
          }}
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <FormationPanel side="home" />
          <FormationPanel side="away" />
        </div>
        <SavedLayoutsPanel />
        <PatternPanel />
      </aside>
    </div>
  );
}
