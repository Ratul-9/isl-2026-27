# DizPitch — Implementation Status

Authoritative handoff document. Update at the end of every phase. If code and this file disagree, trust the code and correct this file.

## Summary

| Item | Value |
|---|---|
| Last completed phase | **Phase 3 — Tactical Drawing Engine** |
| Next phase | **Phase 4 — Match Domain Logic and Timekeeping** |
| Recommended model for next phase | **Opus** |
| Last updated | 2026-10-10 |
| Version control | User committed Phases 1–2 (`0af568f`). **Phase 3 work is uncommitted** (Claude does not commit unless asked). |

## What works now

Single workspace at `/`, one in-memory match created on the client. Header tabs: **Board** (default) / **Setup**.

**Setup (Phase 1):** match details, four officials, team names/coaches, roster editor (≤ 22 players, ≤ 11 starters, ≤ 11 subs, unique shirt numbers per team, XI ↔ bench, "Plays as" override, remove-with-confirm), setup checklist.

**Board (Phase 2):** SVG pitch (landscape/portrait), both teams with numbered/labelled markers, 10 formations per team with identity-preserving switching, drag/keyboard positioning with optional snap, reset to formation, saved arrangements, 12 tactical patterns with confirm-before-overwrite.

**Drawing engine (Phase 3):**
- **Toolbar** (`role="toolbar"`): Select (V), Pass (P), Lofted (L), Shot (S), Run (M), Draw/freehand (F), Erase (E). Active tool is highlighted green with a colour swatch per kind, plus a live hint line ("Pass tool — drag from a player…").
- **Arrow styles:** pass = yellow; **lofted = yellow curved arrow with an "LD" badge on the arrow**; shot = red (thicker); movement = white dashed; freehand = light-blue line. Arrowheads per colour.
- **Drawing:** drag from a player or any point; releasing on a player ends the arrow at them (player hints `fromPlayerId`/`toPlayerId`); clicks shorter than 1.5 m make nothing; Esc cancels an arrow in progress. Pressing on a player in a drawing tool **never moves the player**. Snap-to-grid applies to free endpoints.
- **Editing (Select tool):** click an arrow to select it (wide invisible hit area); drag the arrow to move it; drag its white endpoint handles to move either end (snaps onto/off players); side panel to change type (incl. "Make lofted pass (LD)" / "Make ground pass"), add a note (shown beside the arrow; committed on Enter/blur), reverse direction, delete. Delete/Backspace deletes; Esc deselects. A "Drawings" list in the side panel gives keyboard access to every drawing.
- **Eraser:** click or sweep; removes drawings only, one undo step per sweep.
- **Clear annotations** (toolbar, inline confirm) removes all drawings and keeps the lineup. (The duplicate "Clear arrows" in the pattern panel was removed.)
- **Undo / redo** buttons and Ctrl/⌘+Z, Ctrl/⌘+Shift+Z, Ctrl+Y for every board change: player drags/nudges, position relabels, formation switches/resets, saved-layout save/delete, patterns, and all drawing operations. Setup/roster edits are not undoable and are never reverted by undo.
- Pattern arrows become user-owned once edited (re-applying a pattern no longer replaces them).
- Touch: in Select the grass still scrolls the page while markers/handles capture touch; in drawing tools the whole pitch captures touch.

## What does NOT exist yet

Clock, periods, goals, substitution events, cards, timeline, scoreboard (Phases 4–5); persistence, match library, JSON/PNG export (6). **Data is lost on refresh** until Phase 6.

## Files changed in Phase 3

| Area | Files |
|---|---|
| Domain | **new** `drawings.ts` (+ `drawings.test.ts`); `types.ts` (DrawingKind adds lofted/shot/freehand; `points`, `note`); `layout.ts` (`findPlayerAt`); `geometry.ts` (`metresToView`) |
| Store | **new** `history.ts` (+ `history.test.ts`); `matchReducer.ts` (`drawing/add`, `drawing/update`, `drawing/move`, `drawings/delete`, `BOARD_ACTION_TYPES`, sanitising, detach-on-edit); `MatchContext.tsx` (history reducer, `useBoardHistory`, drawing helpers) |
| Pitch UI | **new** `useBoardInteraction.ts`, `drawingPath.ts` (+ test), `drawingStyle.ts`, `boardTypes.ts`; rewritten `TacticalBoard.tsx`, `DrawingLayer.tsx`; `PlayerMarker.tsx` (keyboard only, `data-slot-id`); `pitchTheme.ts` (shot/freehand/badge colours) |
| Board UI | **new** `DrawingToolbar.tsx`, `DrawingPanel.tsx` (panel + list), `playerLabel.ts`, `boardTestUtils.ts`, `DrawingTools.test.tsx`; `BoardView.tsx` (tool state, unified selection, shortcuts via `useEffectEvent`); `SelectionPanel.tsx`; `PatternPanel.tsx` (clear moved to toolbar) |
| Tests updated | `BoardView.test.tsx` (shared utils, new drawing markup, toolbar clear), `matchReducer.test.ts`, `layout.test.ts` |
| Docs | `CLAUDE.md` (state, layout, Drawing model, invariants 16–18, board notes/shortcuts), `docs/BUILD_PLAN.md` (A6 confirmed, A26–A29, Phase 3 DONE), this file |

## Dependencies

**None added in Phase 3.** Same installed set as Phase 1 (`zod` still unused).

## Commands actually executed in Phase 3 and results

| Command | Result |
|---|---|
| Baseline `npm run typecheck`, `npm run lint`, `npm test` | Passed; 142 tests |
| `npx eslint` during development | Caught "Cannot update ref during render" (React Compiler rule) in the keyboard-shortcut code → rewritten with `useEffectEvent` |
| `npx vitest run` during development | Two expected failures in Phase 2 board tests after the markup change (`line[data-kind]` → drawing groups; clear moved to toolbar) — tests updated |
| Mutation checks (temporary code breaks, then restored) | Removing the "LD" label → 2 tests fail; letting drawing tools drag players → 2 tests fail. Confirms the tests guard these behaviours. |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed, no warnings |
| `npm test` | **Passed: 15 files, 202 tests** |
| `npm run build` | Passed |
| `next start -p 3126` + `curl /` | HTTP 200 |

## Tests added in Phase 3 (60)

- `drawings.test.ts` — segment distance; lofted bulge side/size; Bézier sub-curves match the original; trim parameters; LD anchor at apex; hit testing for straight, lofted (curve not chord) and freehand; nearest/top-most preference; translate keeps shape on pitch and drops hints; reverse swaps hints; freehand spacing; sanitising (clamp, optional fields, min length, NaN, unknown kind, note limit).
- `history.test.ts` — undo/redo of drags; exact drawing list restored across add/edit/move/delete/clear in both directions; formation + pattern undone together; redo cleared by new change; setup changes bypass history and survive undo; **undo never resurrects a removed player or un-benches a player**; no-ops/rejections not recorded; cap of 100.
- `matchReducer.test.ts` — add (sanitised, duplicate/tiny rejected, source stripped), pass→lofted + note keeps geometry, endpoint attach/detach, pattern arrows detach on edit and survive re-apply, arrow↔freehand refused, move/delete.
- `drawingPath.test.ts` — straight paths in metres with player trims, portrait rotation, lofted curve + apex label, bulge side preserved in portrait, freehand polyline.
- `layout.test.ts` — `findPlayerAt` both teams, radius, ignores empty slots.
- `DrawingTools.test.tsx` (23) — active tool visible; each arrow tool draws its kind; LD on lofted in yellow; pass yellow / shot red / run dashed; arrow from player doesn't move them and attaches to both players; short click ignored; freehand; tools switch (click + shortcuts) without losing drawings; Esc cancels draft; select + convert to lofted + change type; note shown on pitch; typing in note doesn't trigger shortcuts/delete; Delete key + Esc; endpoint drag + snap to player; move whole arrow without moving players; reverse; eraser sweep (players untouched, one undo step); undo/redo buttons and shortcuts; undo restores cleared annotations and player drag; touch drag in Select and touch draw in Pass.

## Not verified

- **No real-browser check** (no browser automation here; Chrome/Chromium not installed). Pointer, touch and keyboard behaviour is verified only in jsdom with mocked layout. Please try `npm run dev`: draw each arrow type, edit endpoints, erase, undo/redo, and check LD/note legibility at small sizes and in portrait; ideally test touch on a tablet. Phase 7 owns the full responsive/a11y pass.
- Visual quality of arrowheads/LD badge at very small board sizes (phone width) is unverified.

## Known issues and limitations

- Data resets on refresh (Phase 6). Undo history is in memory only and will not survive a reload even after Phase 6 (by design unless decided otherwise).
- An endpoint edit that would make an arrow shorter than 1.5 m is silently rejected (the arrow snaps back).
- Freehand drawings can be moved, noted and deleted but their individual points can't be edited.
- Endpoint handles and arrow selection are pointer-only; keyboard users select drawings via the side-panel list and edit via the panel (no keyboard endpoint nudging).
- Arrows lying underneath a player marker can only be clicked where they're not covered (markers win by design); the side-panel list always works.
- Side-specific patterns still use only the left flank; board UI state (tool, orientation, snap, selection) resets when switching to Setup and back.
- Carried over: `MatchStatus` vs clock reconciliation (Phase 4); `zod` unused (Phase 6/7); dev-tooling `npm audit` advisories; `unrs-resolver` allow-scripts warning.

## Architecture notes for Phase 4

- **Starting XI vs active lineup:** `Team.slots[].playerId` is the *starting* XI (edited in Setup). Per invariant 6, the active lineup must be *derived* by folding valid, ordered substitution (and red-card) events over the starting slots: the incoming player takes the outgoing player's **slot** (and therefore its pitch position); a sent-off player's slot becomes empty in the derived view. Do not mutate `slots` when recording events. Phase 5 will switch the board to render the derived lineup.
- Roster edits after events exist can invalidate them (e.g. removing a player referenced by a goal/sub, or moving a starter to the bench). Decide and test the rule: suggested — derivation reports invalid events (never crashes), and Setup warns/blocks removing players referenced by events.
- Events and the clock are **not** board state: keep their actions out of `BOARD_ACTION_TYPES` (decision A6). Event edits are explicit edit/delete.
- Clock (invariant 8): pure functions taking `now`; persisted `ClockState` = `{ period, elapsedMs, runningSinceEpochMs }`; `durationMinutes` (10–180) sets half length; extra time 2 × 15. Reconcile `MatchStatus` with clock transitions (e.g. kickoff → `inProgress`, full time → `completed`).
- Event IDs: generate in `useMatchActions` like other entities; ordering tie-breaker = insertion order (keep an array order or a `createdSeq`).

## Next phase

**Phase 4 — Match Domain Logic and Timekeeping** (**Opus**). Scope and acceptance in `docs/BUILD_PLAN.md` §4.

Prompt to send: `Start Phase 4 according to CLAUDE.md and docs/IMPLEMENTATION_STATUS.md.`
