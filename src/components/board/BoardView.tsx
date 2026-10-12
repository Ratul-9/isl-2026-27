'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ImageDown, Maximize2, Minimize2, Users } from 'lucide-react';
import type { Orientation } from '@/domain/geometry';
import { useBoardHistory, useMatch, useMatchActions } from '@/store/MatchContext';
import type { BoardSelection, Tool } from '@/components/pitch/boardTypes';
import { TacticalBoard } from '@/components/pitch/TacticalBoard';
import type { TacticalBoardHandle } from '@/components/pitch/TacticalBoard';
import { Button } from '@/components/ui/Button';
import { useFullscreen } from '@/components/ui/useFullscreen';
import { PITCH_THEME } from '@/components/pitch/pitchTheme';
import { exportFileName } from '@/persistence/document';
import { downloadBlob } from '@/lib/download';
import { prepareBoardSvg, svgToPngBlob } from '@/components/pitch/exportBoard';
import { cn } from '@/lib/cn';
import { DrawingList, DrawingPanel } from './DrawingPanel';
import { DrawingToolbar, TOOLS } from './DrawingToolbar';
import { BenchPanel } from './BenchPanel';
import { FormationPanel, SavedLayoutsPanel } from './FormationPanel';
import { KitPanel } from './KitPanel';
import { PatternPanel } from './PatternPanel';
import { PlayerDisplayControl } from './PlayerDisplayControl';
import { SelectionPanel } from './SelectionPanel';

/** True when a key press belongs to a text field or other form control. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** The tactical board workspace: tools and pitch in the centre, controls alongside. */
export function BoardView({
  onOpenSetup,
  onRecordSubstitution,
}: {
  onOpenSetup: () => void;
  onRecordSubstitution: () => void;
}) {
  const match = useMatch();
  const actions = useMatchActions();
  const history = useBoardHistory();
  const boardRef = useRef<TacticalBoardHandle>(null);
  // The stage (tools + pitch) is the one element that goes fullscreen; nothing is re-created or copied.
  const { attach: attachStage, mode: fullscreenMode, active: isFullscreen, exit: exitFullscreen, toggle: toggleFullscreen } =
    useFullscreen<HTMLDivElement>();
  // The pitch is wider than tall; on a phone held upright a portrait pitch uses the space far better.
  const [orientation, setOrientation] = useState<Orientation>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 639px)').matches
      ? 'portrait'
      : 'landscape',
  );
  const [snap, setSnap] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [selection, setSelection] = useState<BoardSelection>(null);
  const [exportError, setExportError] = useState<string | null>(null);
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

  async function exportPng() {
    setExportError(null);
    const svg = boardRef.current?.getSvg();
    if (!svg) return setExportError('The board is not ready to export.');
    try {
      const blob = await svgToPngBlob(prepareBoardSvg(svg));
      downloadBlob(blob, exportFileName(match, 'png', new Date()));
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'The image could not be exported.');
    }
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
      if (boardRef.current?.cancelGesture()) return;
      // Browsers normally exit native fullscreen on Esc themselves (and may not deliver the key at all);
      // the overlay fallback has no such behaviour. Exiting here too is harmless and covers both.
      if (isFullscreen) void exitFullscreen();
      else setSelection(null);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedDrawing) {
        e.preventDefault();
        actions.deleteDrawings([selectedDrawing.id]);
        setSelection(null);
      } else if (isFullscreen) {
        // Mac's "delete" key: with nothing selected to delete, it leaves fullscreen.
        e.preventDefault();
        void exitFullscreen();
      }
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
      <div
        ref={attachStage}
        data-fullscreen={fullscreenMode}
        className={cn(
          'flex min-w-0 flex-col gap-3',
          // Fullscreen: the pitch's own surround colour fills the screen around the (undistorted) pitch.
          isFullscreen && 'gap-2 p-2',
          fullscreenMode === 'fallback' && 'fixed inset-0 z-[100]',
        )}
        style={isFullscreen ? { backgroundColor: PITCH_THEME.surround } : undefined}
      >
        <div className={isFullscreen ? 'flex flex-wrap items-start gap-x-3 gap-y-2' : 'contents'}>
          <DrawingToolbar tool={tool} onToolChange={changeTool} compact={isFullscreen} />
          <div className={cn('flex flex-wrap items-center gap-3', isFullscreen && 'ml-auto')}>
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
            <PlayerDisplayControl />
            <label className="flex items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={snap}
                onChange={(e) => setSnap(e.target.checked)}
                className="h-4 w-4 accent-emerald-500"
              />
              Snap to grid
            </label>
            {isFullscreen ? null : (
              <Button size="sm" onClick={exportPng} title="Download the board as a PNG image">
                <ImageDown size={14} aria-hidden /> <span className="hidden sm:inline">Export PNG</span>
                <span className="sr-only sm:hidden">Export PNG</span>
              </Button>
            )}
            <Button
              size="sm"
              variant={isFullscreen ? 'primary' : 'secondary'}
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              title={isFullscreen ? 'Exit fullscreen (Esc, or Delete with nothing selected)' : 'Show only the pitch, fullscreen'}
            >
              {isFullscreen ? <Minimize2 size={14} aria-hidden /> : <Maximize2 size={14} aria-hidden />}
              <span aria-hidden className={isFullscreen ? undefined : 'hidden sm:inline'}>
                {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              </span>
            </Button>
            {noPlayers && !isFullscreen ? (
              <div className="ml-auto flex items-center gap-2 text-xs text-zinc-400">
                <span>No players yet — empty positions are shown.</span>
                <Button size="sm" onClick={onOpenSetup}>
                  <Users size={14} aria-hidden /> Add squads
                </Button>
              </div>
            ) : null}
          </div>
        </div>
        {exportError && !isFullscreen ? (
          <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">
            PNG export failed: {exportError}
          </p>
        ) : null}
        <div
          className={cn(
            'flex min-h-0 justify-center',
            isFullscreen ? 'flex-1 items-center' : 'rounded-lg border border-zinc-800 bg-zinc-900/40 p-2',
          )}
        >
          <TacticalBoard
            fill={isFullscreen}
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
        <BenchPanel onRecordSubstitution={onRecordSubstitution} />
        <KitPanel />
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
