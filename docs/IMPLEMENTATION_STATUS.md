# DizPitch — Implementation Status

Authoritative handoff document. Update at the end of every phase. If code and this file disagree, trust the code and correct this file.

## Summary

| Item | Value |
|---|---|
| Last completed phase | **Phase 2 — Pitch, Formations and Player Dragging** |
| Next phase | **Phase 3 — Tactical Drawing Engine** |
| Recommended model for next phase | **Opus** |
| Last updated | 2026-10-10 |
| Version control | Git repo initialised by the user after Phase 1, **no commits yet**. Phase 2 work is uncommitted (Claude does not commit unless asked). |

## What works now

Single workspace at `/`, one in-memory match created on the client. Header tabs switch between **Board** (default) and **Setup**.

**Setup (Phase 1, unchanged behaviour):** match details, four officials, both teams' names/coaches, roster editor (≤ 22 players, ≤ 11 starters, ≤ 11 subs, unique shirt numbers per team, XI ↔ bench moves, "Plays as" override, remove-with-confirm), live setup checklist.

**Board (Phase 2):**
- SVG pitch with all markings (touchlines, goal lines, halfway line, centre circle + spot, penalty and goal areas, penalty spots and arcs, goals, corner arcs), subtle stripes; **landscape and portrait** toggle (portrait = home goal at the bottom). Scales with the container; positions are viewBox-relative so resizing never moves players.
- **Both teams on one board**, each in its own half: home blue markers attacking right, away white markers attacking left. Marker = shirt number, surname label, position abbreviation; empty positions shown as dashed ghosts; full name + position in the tooltip/accessible name and the selection panel.
- **Formations:** 4-3-3, 4-2-3-1, 4-4-2, 4-1-4-1, 4-3-2-1, 3-5-2, 3-4-3, 3-4-2-1, 5-3-2, 5-4-1, independently per team. Switching moves the actual markers, relabels positions, keeps every player's identity and XI/bench membership (e.g. a 4-3-3 left back becomes the LWB in 3-5-2).
- **Dragging:** pointer (mouse/touch/pen) with pointer capture; click selects without moving (0.3 m threshold); optional **snap to grid** (2.5 m × ~2.8 m); clamped to the pitch. **Keyboard:** markers are focusable buttons — arrows nudge 1 m (Shift 5 m), Enter/Space select, Esc deselect.
- **Reset to formation** (enabled only when positions differ); "Custom positions" badge.
- **Saved arrangements:** save the current team layout by name; appears in both teams' formation lists (mirrored correctly for away); delete with inline confirmation (teams using it fall back to its base preset).
- **Tactical pattern library (12):** High press, Mid-block, Low block, Build-up from the back, Overlapping full-back, Underlapping full-back, Wide overload, Central overload, Counterattack, Counter-press, Positional rotations, Set piece (attacking corner). Each moves the chosen team into a shape (computed from formation defaults, so never compounding) and adds yellow pass / white dashed movement arrows. Re-applying replaces that team's previous pattern arrows. **Non-destructive:** applying a pattern or switching formation over custom positions asks first.
- **Clear arrows** (with confirmation) removes all arrows and leaves the lineup untouched.
- Selection panel: selected player's details + "Plays as" position override (also works on empty positions).

## What does NOT exist yet

Drawing tools (draw/select/edit/delete arrows, shot/lofted "LD"/freehand, eraser), undo/redo (Phase 3); clock, goals, substitution events, cards, timeline, scoreboard (4–5); persistence, match library, JSON/PNG export (6). **Data is lost on refresh** until Phase 6. Arrows currently come only from patterns and are read-only.

## Files changed in Phase 2

| Area | Files |
|---|---|
| Domain (new) | `geometry.ts`, `formations.ts`, `layout.ts`, `patterns.ts`, `fixtures.ts` (+ `geometry.test.ts`, `formations.test.ts`, `layout.test.ts`, `patterns.test.ts`) |
| Domain (changed) | `types.ts` (Point, FormationId/Ref, slot x/y, Team.formation, TemplateSlot, SavedLayout, Drawing, Match.drawings/savedLayouts), `squad.ts` (fixed slots: fill/empty instead of add/remove; `setSlotPosition`; integrity checks for slot count/ids/bounds; no slot-id params), `match.ts` (`createTeam(side)` with 11 slots in 4-3-3), `testing.ts` |
| Store | `matchReducer.ts` (new actions: `slot/move`, `slot/setPosition`, `formation/apply`, `formation/reset`, `layout/save`, `layout/delete`, `pattern/apply`, `drawings/clear`; `player/add` now takes `playerId`), `MatchContext.tsx` (matching helpers in `useMatchActions`) |
| UI (new) | `components/pitch/{TacticalBoard,PitchMarkings,PlayerMarker,DrawingLayer}.tsx`, `pitch/{pitchTheme,labels}.ts`, `components/board/{BoardView,FormationPanel,PatternPanel,SelectionPanel}.tsx`, `board/formationOptions.ts`, `ui/ConfirmBar.tsx` |
| UI (changed) | `MatchWorkspace.tsx` (Board/Setup views, `initialView` prop), `layout/AppHeader.tsx` (workspace tabs), `setup/RosterEditor.tsx` (override by slot id), `ui/Button.tsx` (accepts `ref`), `app/globals.css` (marker focus ring) |
| Tests | new `components/board/BoardView.test.tsx`, `components/pitch/labels.test.ts`; updated `squad.test.ts`, `matchReducer.test.ts`, `MatchWorkspace.test.tsx` (opens in Setup + view switch test), `hydration.test.tsx` (expects the board) |
| Docs | `CLAUDE.md` (state, layout, model, invariant 3 corrected, invariants 14–16, board notes), `docs/BUILD_PLAN.md` (A8 corrected, A19–A25, sketch, Phase 2 DONE), this file |

## Dependencies

**None added in Phase 2.** Drag uses Pointer Events; SVG is hand-written. Installed set unchanged from Phase 1 (`next` 16.4.0, `react` 19.3.0, `typescript` 5.9.3, `tailwindcss` 4.3.3, `zod` 4.6.5 — still unused, `lucide-react` 1.55.0, `vitest` 5.0.3, RTL 16.3.3, `jsdom` 30.1.2, `@types/node` 24.x).

## Commands actually executed in Phase 2 and results

| Command | Result |
|---|---|
| Baseline: `npm run typecheck`, `npm run lint`, `npm test` (before changes) | Passed; 47 tests |
| `npx vitest run …` during development | Failures found and fixed: (1) formation line-order test tolerance for staggered wing-backs (test fix); (2) **mid-block and low-block produced no arrows for formations without wide players** (pattern fix: use "wide-lane" rule); (3) board tests matched both teams' identically named fixture players (test fix); (4) **snap-to-grid made 1 m keyboard nudges no-ops** (code fix: nudges are not snapped) |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed, no warnings |
| `npm test` | **Passed: 11 files, 142 tests** |
| `npm run build` | Passed (Next 16.4.0 Turbopack; `/`, `/_not-found`, `/icon.svg` static) |
| `next start -p 3125` + `curl /` | HTTP 200, loading fallback in server HTML |

## Tests (142)

- `geometry.test.ts` — team-frame rotation & handedness, view transforms in both orientations, client→pitch mapping at multiple sizes and with letterboxing, clamping, snapping, metre distances, screen-relative nudges, segment trimming.
- `formations.test.ts` — all 10 presets present; each 11 slots, 1 GK, valid codes, outfield = 10, own half, no overlaps, back/front line sizes match the name, left/right symmetry.
- `layout.test.ts` — exact template coordinates for both sides; **identity/XI/bench unchanged across all 100 formation pairs × 2 sides**; GK stays GK, full backs stay on their flank; LB→LWB; incomplete XI; reset after drag; label override counts as modified; clamped moves; saved-layout round trip and cross-team reuse; deleted layout resolution.
- `patterns.test.ts` — 12 patterns × 10 formations × 2 sides: in-bounds, deterministic, identity preserved, arrows start at real players, unique ids, tagged source; high press higher / low block deeper; overlap outside vs underlap inside; corner taker at the flag; non-compounding; arrows only for filled slots.
- `squad.test.ts`, `match.test.ts`, `matchReducer.test.ts` — Phase 1 rules on the fixed-slot model, plus board actions (formation apply/reset, per-team pattern arrow replacement, clear keeps players, saved layout save/reuse/delete fallback, blank names ignored, relabel without moving).
- `BoardView.test.tsx` — 22 markers incl. empty ghosts; labels; **drag then resize then drag again lands correctly**; click selects without moving; keyboard nudge; portrait redraw; formation switch keeps players; confirm-before-discard + reset; save/reuse/delete arrangement; pattern arrows + clear arrows keeps positions; confirm before pattern over custom positions; position override; snap on keeps 1 m nudges; confirmation focus; snapped drags land on grid.
- `MatchWorkspace.test.tsx`, `hydration.test.tsx`, `labels.test.ts`.

## Not verified

- **No real-browser check** (again). No browser automation is available in this environment and neither Chrome nor Chromium is installed; downloading Playwright's Chromium was not done without asking. Drag/touch/keyboard behaviour was verified only in jsdom (`fireEvent.pointer*`, mocked layout). **Please try `npm run dev` manually**: drag players (mouse and, if possible, touch/tablet), toggle portrait, apply patterns, check legibility of labels and arrows. Phase 7 owns the full responsive/a11y pass.
- Touch scrolling behaviour: markers set `touch-action: none` (so dragging a player never scrolls), while the grass does not (so the page can still scroll on touch devices). Unverified on a device.

## Known issues and limitations

- Data resets on refresh (Phase 6).
- Arrows are read-only and come only from patterns; they cannot be selected, edited or individually deleted yet (Phase 3). Arrows do not follow players by design (invariant 4) — moving a player after applying a pattern leaves arrows where they were.
- Saved arrangements are per match (`Match.savedLayouts`), not global; Phase 6 may revisit.
- Side-specific patterns (overlap, underlap, wide overload, counter-press, rotations, set piece) always use the team's **left** flank; there is no flank selector yet.
- Board UI state (orientation, snap, selection) is not persisted and resets when switching to Setup and back.
- Two players can be dragged onto the same spot (allowed; free positioning is a requirement).
- Carried over: `MatchStatus` vs clock reconciliation (Phase 4); `zod` unused (Phase 6/7); dev-tooling `npm audit` advisories; `unrs-resolver` allow-scripts warning.

## Architecture notes for Phase 3

- Drawings live in `Match.drawings`; `Drawing.kind` is `'pass' | 'movement'` today — extend the union with `'shot' | 'lofted' | 'freehand'` (freehand needs `points?: Point[]`). `DrawingLayer` currently has `pointer-events: none`; Phase 3 will need hit-testing and selection there.
- Pattern arrows carry `source`; decide whether editing a pattern arrow detaches it (recommended: clear `source` on edit so re-applying a pattern won't delete user-edited arrows).
- Undo/redo (decision A6): history of board state — `home.slots`, `away.slots`, formations, `drawings` (and probably `savedLayouts`). Every board mutation is already a single reducer action (drags commit once on pointer-up), so a history wrapper around the reducer for board action types is the natural fit. Roster/setup actions should not enter the board history, but note they also mutate slots (filling/emptying) — design how history interacts with them (simplest: clear redo stack on non-board actions, or snapshot only board fields and re-merge).
- Tool modes must gate pointer handling: in Select mode markers drag (current behaviour); in drawing modes, pointer-down on a marker should start an arrow from that player instead of dragging it.
- Arrow geometry helpers available: `shortenSegment`, `toView/fromView`, `clientToPitch`, `distanceMetres`.

## Next phase

**Phase 3 — Tactical Drawing Engine** (**Opus**). Scope and acceptance in `docs/BUILD_PLAN.md` §4.

Prompt to send: `Start Phase 3 according to CLAUDE.md and docs/IMPLEMENTATION_STATUS.md.`
