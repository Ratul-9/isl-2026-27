'use client';

import { useState } from 'react';
import type { ComponentType } from 'react';
import { ArrowUpRight, Eraser, Footprints, MousePointer2, PenLine, Redo2, Spline, Target, Trash2, Undo2 } from 'lucide-react';
import { useBoardHistory, useMatch, useMatchActions } from '@/store/MatchContext';
import type { Tool } from '@/components/pitch/boardTypes';
import { DRAWING_STYLE } from '@/components/pitch/drawingStyle';
import { Button } from '@/components/ui/Button';
import { ConfirmBar } from '@/components/ui/ConfirmBar';
import { cn } from '@/lib/cn';

export interface ToolInfo {
  id: Tool;
  label: string;
  shortcut: string;
  icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
  hint: string;
}

export const TOOLS: readonly ToolInfo[] = [
  { id: 'select', label: 'Select', shortcut: 'V', icon: MousePointer2, hint: 'Drag players or arrows. Click an arrow to edit it; drag its white handles to move an end.' },
  { id: 'pass', label: 'Pass', shortcut: 'P', icon: ArrowUpRight, hint: 'Drag from a player or any point to draw a yellow pass. Release on a player to end at them.' },
  { id: 'lofted', label: 'Lofted', shortcut: 'L', icon: Spline, hint: 'Drag to draw a lofted pass: a yellow curved arrow labelled LD.' },
  { id: 'shot', label: 'Shot', shortcut: 'S', icon: Target, hint: 'Drag to draw a red shot arrow, e.g. toward goal.' },
  { id: 'movement', label: 'Run', shortcut: 'M', icon: Footprints, hint: 'Drag to draw a dashed off-ball movement arrow.' },
  { id: 'freehand', label: 'Draw', shortcut: 'F', icon: PenLine, hint: 'Draw a freehand annotation line.' },
  { id: 'eraser', label: 'Erase', shortcut: 'E', icon: Eraser, hint: 'Click or sweep over drawings to remove them. Players are never erased.' },
];

const SWATCH: Partial<Record<Tool, string>> = {
  pass: DRAWING_STYLE.pass.colour,
  lofted: DRAWING_STYLE.lofted.colour,
  shot: DRAWING_STYLE.shot.colour,
  movement: DRAWING_STYLE.movement.colour,
  freehand: DRAWING_STYLE.freehand.colour,
};

export function DrawingToolbar({ tool, onToolChange }: { tool: Tool; onToolChange: (tool: Tool) => void }) {
  const match = useMatch();
  const actions = useMatchActions();
  const history = useBoardHistory();
  const [confirmClear, setConfirmClear] = useState(false);
  const count = match.drawings.length;
  const active = TOOLS.find((t) => t.id === tool)!;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div role="toolbar" aria-label="Drawing tools" className="flex flex-wrap gap-1 rounded-md bg-zinc-900 p-1">
          {TOOLS.map(({ id, label, shortcut, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={tool === id}
              aria-label={`${label} tool`}
              title={`${label} (${shortcut})`}
              onClick={() => onToolChange(id)}
              className={cn(
                'relative flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors',
                tool === id ? 'bg-emerald-600 text-white shadow-inner' : 'text-zinc-300 hover:bg-zinc-800 hover:text-white',
              )}
            >
              <Icon size={15} aria-hidden />
              <span className="hidden md:inline">{label}</span>
              {SWATCH[id] ? (
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: SWATCH[id] }} />
              ) : null}
            </button>
          ))}
        </div>

        <div className="flex gap-1 rounded-md bg-zinc-900 p-1">
          <Button size="sm" variant="ghost" onClick={history.undo} disabled={!history.canUndo} aria-label="Undo" title="Undo (Ctrl/⌘+Z)">
            <Undo2 size={15} aria-hidden />
          </Button>
          <Button size="sm" variant="ghost" onClick={history.redo} disabled={!history.canRedo} aria-label="Redo" title="Redo (Ctrl/⌘+Shift+Z)">
            <Redo2 size={15} aria-hidden />
          </Button>
        </div>

        <Button
          size="sm"
          onClick={() => setConfirmClear(true)}
          disabled={count === 0 || confirmClear}
          title={count === 0 ? 'There are no annotations on the board' : 'Remove every drawing; players stay'}
        >
          <Trash2 size={14} aria-hidden /> Clear annotations{count > 0 ? ` (${count})` : ''}
        </Button>
      </div>

      <p className="text-xs text-zinc-400" aria-live="polite">
        <span className="font-semibold text-zinc-200">{active.label} tool</span> — {active.hint}
      </p>

      {confirmClear ? (
        <ConfirmBar
          message={`Remove all ${count} drawing${count === 1 ? '' : 's'}? Players stay where they are. You can undo this.`}
          confirmLabel="Clear"
          onConfirm={() => {
            actions.clearDrawings();
            setConfirmClear(false);
          }}
          onCancel={() => setConfirmClear(false)}
        />
      ) : null}
    </div>
  );
}
