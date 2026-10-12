# DizPitch — Build Plan

Companion to `CLAUDE.md` (rules, invariants, stack) and `docs/IMPLEMENTATION_STATUS.md` (current state). This file defines **what** is built, **in what order**, and **when it is done**.

## 1. Architecture decisions (made in Phase 0)

| # | Decision | Rationale |
|---|---|---|
| A1 | Next.js App Router + TypeScript strict, npm | Empty repo → mandated default. npm is the only package manager installed. |
| A2 | Routes: `/` (match library), `/match/[id]` (workspace). *Realised in Phase 6* (Phase 1–5 mounted the workspace at `/`). | Avoids shipping a library/route that cannot function yet. No static export requirement, so a dynamic segment is fine. |
| A3 | Match UI is client-only: `<MatchProvider>` renders a loading fallback on the server and the real tree on the client (`useSyncExternalStore` gate); storage is read inside that subtree | Local-first; avoids SSR/hydration mismatch, and keeps random IDs/time out of server prerender under Cache Components. Verified by `hydration.test.tsx`. |
| A4 | Domain logic in pure TS (`src/domain`), no React/DOM/Date | Testable; satisfies "predictable, testable transitions". |
| A5 | One reducer per open match; actions are plain objects | Predictable updates, easy undo history and tests. |
| A6 | Undo/redo covers **board state** (slot geometry, formations, drawings, saved layouts). Match events are changed through explicit edit/delete, not the undo stack. *Confirmed in Phase 3; see A26.* | Clock/event history is a record of fact; mixing it into undo creates confusing clock states. |
| A7 | Pitch frame: one canonical landscape frame, `x` = length, `y` = width, both 0–1; portrait is a render transform | Single source of truth; resizing and orientation never alter stored data. |
| A8 | Formation/pattern templates team-relative; converted for away with a 180° rotation (x→1−x, y→1−y) on apply. *Phase 2 correction: originally "mirrored x→1−x", which flips the away team's left/right.* | One definition serves both sides. |
| A9 | Pitch coordinates are owned by **lineup slots**, not players | Substitution = swap `playerId` in a slot; position and shape are preserved naturally. |
| A10 | Lineup, score, and displayed event times are derived, never stored | Prevents stale state after historical edits. |
| A11 | Persistence: `localStorage`, one key per match behind a `MatchRepository` interface. *Phase 6 refinement: no separate index key* — the library enumerates `dizpitch:match:*` keys and validates each, so there is no index to fall out of sync; at library scale (tens of matches) this is cheap. | Matches are small; interface allows an IndexedDB swap without touching UI. |
| A12 | `zod` schemas as the single validation source for import + storage load | Invariant 9; gives readable error paths. |
| A13 | Pointer Events for drag/draw; no DnD library | Needs pointer capture, touch handling and coordinate normalisation anyway; a DnD lib adds little. |
| A14 | PNG export by serialising the pitch SVG (inline styles, embedded font fallback) to canvas | No heavy dependency; the board is already SVG. |
| A15 | Vitest + RTL for tests; Playwright **not** added unless Phase 7 justifies it | Keep the toolchain small. |
| A16 | Scaffold defaults kept (Next 16.4, `cacheComponents` + `partialPrefetching` on, Tailwind v4, TS 5.9, ESLint 9); system font stack instead of `next/font/google` | User asked to use whatever `create-next-app` installs; fonts removed so builds need no network. |
| A17 | A player's lineup role is derived (slot ⇒ starter, `bench` ⇒ substitute); no stored role flag | Single source of truth; makes "in at most one place" structural. |
| A19 | **Fixed 11 slots per team** (created with the team, ids never change; empty slots have `playerId: null`). Selecting a starter fills the best-fitting empty slot (exact position → family → group; GK slot last). | Formations, patterns and substitutions all re-position or re-occupy slots instead of creating/deleting them; makes "exactly 11" structural. |
| A20 | Formation switch/reset = greedy global-minimum assignment of slots to template positions, cost = label mismatch (dominant) + metres/10; filled slots assigned first | Keeps a left back a left back (→ LWB in a back three), deterministic, preserves identity; Hungarian algorithm unnecessary at 11×11. |
| A21 | Patterns are pure functions in the team frame over the **formation defaults** (never the dragged layout), returning slot positions + pass/movement arrows; arrows become `Drawing`s tagged `source: {patternId, teamId}`; re-applying a pattern replaces that team's previous pattern arrows | Predictable, non-compounding, formation-agnostic; user-drawn arrows (Phase 3) are never touched by patterns. |
| A22 | Phase 2 renders `Drawing`s read-only (only `pass`/`movement` kinds exist); Phase 3 adds tools, editing, selection, shot/lofted/freehand | Patterns need visible arrows now without pulling the drawing engine forward. |
| A23 | Saved custom arrangements live on `Match.savedLayouts` in the team frame (usable by both teams); saving makes the team follow the saved layout; deleting falls back to its base preset | Simple and match-scoped; Phase 6 may decide whether layouts become library-wide. |
| A24 | Drags are local UI state committing one `slot/move` on pointer-up; 0.3 m threshold separates click (select) from drag; pointer mapping via `getBoundingClientRect` + pure `clientToPitch` | One undo step per drag in Phase 3; testable in jsdom; correct under resize/letterboxing. |
| A25 | Workspace has Board (default) and Setup views in the header | The pitch is the visual centre per spec; setup stays one click away. |
| A26 | Undo history wraps the reducer and snapshots slot **geometry by slot id**, not occupants; setup actions bypass history | Undo after roster changes can never resurrect removed players or duplicate bench/XI membership. |
| A27 | One `<svg>`-level pointer router with pointer capture; tool mode gates behaviour; drawing tools find players with a pure hit test (`findPlayerAt`) instead of DOM targets | Unambiguous player-drag vs arrow-draw on mouse, pen and touch; testable in jsdom. |
| A28 | Lofted pass = yellow quadratic Bézier bulging left of travel (18% of length), "LD" badge at the apex; shot = red; movement = white dashed; freehand = light blue polyline, no arrowhead | Lofted is distinguishable even without the label; LD sits on the arrow as required. |
| A29 | Editing a pattern-generated drawing drops its `source`, so re-applying a pattern won't delete user-edited arrows | Pattern output is a starting point; user edits are owned by the user. |
| A30 | Periods: `notStarted, firstHalf, halfTime, secondHalf, extraTimeFirstHalf, extraTimeSecondHalf, fullTime`; ET halves fixed at 15 min; half = `durationMinutes/2` | Spec's "Extra Time" split in two so 105+X' notation and the ET half-time marker work. |
| A31 | Clock = `{period, elapsedMs (within period), runningSinceEpochMs, endedPeriod}`; transitions are a fixed state machine; `correctClock` can set any period/elapsed without markers | Timestamp-derived elapsed (invariant 8); mis-clicked period changes are recoverable. |
| A32 | Events store `period` + continuous `matchTimeMs`; minute notation derived; ordering `(periodIndex, matchTimeMs, array index)` | Stoppage times sort correctly; insertion order is a stable tie-break. |
| A33 | Period markers are a single `periodMarker` event type with a `marker` enum (kickoff, halfTime, secondHalfKickoff, endOfNormalTime, extraTimeKickoff, extraTimeHalfTime, extraTimeSecondHalfKickoff, fullTime), auto-recorded by `clock/advance` | Replaces the sketch's four separate types; covers extra time; one union member to handle. |
| A34 | One `analyzeEvents` pass yields per-event errors/warnings, derived lineups and the score; errors exclude an event from derivation, warnings don't | Score, lineup and timeline can never disagree; historical corrections flag dependants instead of corrupting state. |
| A35 | Goal: `teamId` = credited team; own goal requires the responsible player from the other squad and no assist; scorer/assist optional otherwise; scorer-not-on-pitch is a warning (goal still counts) | Matches the spec's own-goal rule; data-entry order mistakes don't silently change the score. |
| A36 | Second yellow = dismissal; subbed-off players can't return; dismissed substitutes can't come on; no substitution count limit | Standard Laws of the Game; limits vary by competition, so none is enforced. |
| A37 | Players referenced by events can't be removed; roster role changes after kick-off are allowed and re-derive (possibly flagging events) | Prevents dangling references; still lets users fix a wrong starting XI. |
| A38 | `MatchStatus` follows the clock on transitions (live/HT → inProgress, FT → completed), otherwise manual | Resolves the Phase 1 status/clock overlap without removing manual postponed/abandoned. |
| A39 | Workspace views: **Board / Events / Setup**; the **scoreboard + clock controls are rendered once in the shell** (sticky, under the header) so they persist across views; header status badge stays | Satisfies "clock continues working when the user changes sections" structurally rather than by re-syncing. |
| A40 | `useNow` = shared 250 ms ticker store used only to repaint; elapsed time always from `clockReadout(clock, now)` | Honors invariant 8 while giving a live display; late ticks are harmless. |
| A41 | Event forms: pure model (`eventFormModel.ts`) + live `checkEventChange`; errors block save, warnings/`newlyInvalid` are shown and allowed ("Save and flag N"); pickers list only players valid at the form's moment excluding the edited event | Prevents most invalid input up front while still permitting historical corrections that flag dependants (A34). |
| A42 | New events default to the live minute; before kick-off → 1'; at half time → start of the second half; after full time → end of the last half. Unchanged minute keeps exact ms (ordering within a minute follows real time) | Matches how matches are actually recorded; stoppage entered as minute+added or a minute beyond the half. |
| A43 | Board renders the **derived** lineup (substitutes occupy the slot of the player they replaced); arrows attach to current occupants; patterns use current occupants while `Team.slots` keeps the starting XI | Invariant 6 end-to-end: events never mutate slots. |
| A44 | Period changes from the scoreboard confirm before ending a half/the match; clock correction accepts a period + match-scale time (mm:ss) | Prevents mis-clicks on irreversible-feeling actions; recoverable via correction. |
| A45 | Schema versioning lives on the **document envelope** (`{format, schemaVersion, savedAt, match}`), not on `Match`; storage and JSON files use the same envelope | Keeps the domain type free of storage concerns; one parser serves both. (Supersedes "Phase 6 adds `schemaVersion` to Match".) |
| A46 | Import pipeline: size cap 5 MB → JSON → format marker → version → migrations → zod → cross-field integrity (unique ids, `validateSquadIntegrity`) → non-lossy repairs as warnings (missing saved arrangement → 4-3-3, running clock outside a half → paused) → warn about events inconsistent with squads. Errors are path-prefixed, capped at 8 | Strict on structure, tolerant on things that lose nothing; users see exactly what is wrong. |
| A47 | Importing never overwrites: an existing id yields a regenerated-id copy named "… (imported)"; Duplicate regenerates every id, remaps every reference and pauses a running clock | A library must never silently lose a match. |
| A48 | Autosave: debounce 500 ms, flush on unmount/`pagehide`/hidden, derived status (Saved/Saving/Not saved + Retry/Session only); failure keeps the match in memory. Storage blocked → in-memory repository + visible notice | Honest about durability; no data loss on quota errors. |
| A49 | PNG export: DOM clone of the board `<svg>` → strip handles/drafts/rings/hit areas/titles → standalone SVG with explicit size and concrete fonts → `Image` → canvas → `toBlob`. Long edge 2000 px; exports the orientation currently shown | Reuses the on-screen renderer so export always matches the screen; no dependency. |
| A50 | Library actions (create/duplicate/rename/export/import/delete) operate on stored documents via the repository, not on an open match; the workspace is only opened through `/match/[id]` | One source of truth per match at a time; avoids editor/library races. Cross-tab edits are not coordinated (last write wins). |
| A51 | Hidden-route staleness is handled by `ReloadOnReveal` (remount on reveal), not by disabling Cache Components | Keeps the framework default (A16) and fixes the real data-integrity risk found in browser QA. |
| A52 | Touch drag uses a native non-passive `touchstart` guard on draggable targets (Select tool only); open grass keeps page scrolling | `touch-action` is ignored on SVG children in browsers; `touch-action: none` on the whole root would make the pitch a scroll trap on tablets. |
| A53 | Responsive strategy: sticky chrome only from `md`; board defaults to portrait on phones; `pointer-coarse:` enlarges targets; secondary text ≥ `zinc-400`, primary green `emerald-700` | WCAG AA contrast and reachable touch targets without a separate mobile UI. |
| A54 | Real-browser QA is ad-hoc (Playwright + axe-core installed in the session scratchpad, not a project dependency); results recorded in IMPLEMENTATION_STATUS | Keeps the project toolchain small (A15); the scripts are not retained, so re-running means rewriting them. |
| A55 | Video tracking runs in a separate local Python service (`cv-service/`, FastAPI + uv) with dedicated detectors (Roboflow YOLOv8 via Ultralytics), ByteTrack (`trackers`) and deterministic homography geometry; the web app reaches it only via `/api/cv/[...path]`. No generative model is used for detection, tracking or localisation | Spec requirement; keeps PyTorch out of the npm tree. SoccerNet sn-gamestate rejected (Python 3.9/CUDA-era stack, GPL-3.0). **Ultralytics/weights are AGPL-3.0: licence decision left to the owner** |
| A56 | Tracked replays store `TrackingData` (image boxes + pitch points + provenance + edits) on `TacticalReplay` (schema v3), never the video; automatic calibration is presented as unverified, with manual landmark calibration as the fallback | Honest positions (uncalibrated → no pitch point), replay without reprocessing, and a correction path when the keypoint model is wrong (observed on the test clip) |
| A18 | Reducer actions carry pre-generated IDs; hook `useMatchActions` validates then dispatches; reducer ignores invalid ops by returning the same state | Pure/deterministic reducer, StrictMode-safe, errors surfaced to forms. |
| A57 | Team presets are static, validated JSON under `public/presets/<league>/<season>.json` (+ `index.json`), produced by a maintenance CLI and loaded in the browser; creating a match **snapshots** the chosen teams (no live link) | No backend (out of scope), refresh without a rebuild, and the data-integrity rule that presets and historical matches never affect each other |
| A58 | A club's full squad (~25–36) does not fit the ≤ 22 matchday squad, so presets add an optional per-team **squad pool** (`Team.pool`) instead of raising the squad cap; `Team.players` and invariant 12 are unchanged | Every event/board/lineup code path keeps working untouched; the user still chooses the XI and bench; no auto-selection |
| A59 | Importer reads only the public club/squad/profile HTML (robots-aware, 1 req/s), never the site's `/api`; images are linked, never stored (host allow-list + fallbacks) | Respect access rules and unclear image rights; no data API is documented; a manual CSV/JSON path exists for when scraping is not possible |
| A60 | `tsx` added as a dev dependency to run `scripts/presets.ts` against the same TS modules (schema, parsers) the app and tests use | Avoids duplicating the zod schema/parsers in a second language or a hand-rolled loader; dev-only |
| A61 | Persisted schema v4 adds only optional fields (`Team.pool`, `Team.preset`, `Player.origin`); migration `3 → 4` is the identity | Old matches open unchanged; the bump stops an older build from silently stripping preset data on save |

## 2. Domain model sketch

Types are defined in `src/domain/types.ts` in Phase 1 (setup types) and extended in Phases 2–4. Shapes below are the contract; names may be refined, semantics may not.

```ts
type Id = string;                       // generated, opaque
type PositionCode = 'GK'|'LB'|'RB'|'CB'|'LCB'|'RCB'|'LWB'|'RWB'|'CDM'|'CM'|'LCM'|'RCM'|'CAM'|'LM'|'RM'|'LW'|'RW'|'CF'|'ST';
type Period = 'notStarted'|'firstHalf'|'halfTime'|'secondHalf'|'extraTimeFirstHalf'|'extraTimeSecondHalf'|'fullTime'; // A30
interface Point { x: number; y: number }  // normalised 0..1, canonical frame

interface Player { id: Id; name: string; shirtNumber: number; preferredPosition: PositionCode; notes?: string }
interface LineupSlot { id: Id; playerId: Id | null; position: PositionCode; x: number; y: number } // absolute canonical
interface Team {
  id: Id; name: string; coach: string;
  players: Player[];                     // <= 22
  slots: LineupSlot[];                   // exactly 11; filled = starting XI   [Phase 2: fixed]
  bench: Id[];                           // substitute ids, ordered
  formation: FormationRef;               // {kind:'preset', id} | {kind:'saved', id}   [Phase 2]
}
interface SavedLayout { id: Id; name: string; baseFormation: FormationId; slots: TemplateSlot[] } // team frame [Phase 2]
// Match (Phase 1): id + flat MatchInfo {name, competition, date, kickoffTime, venue,
// durationMinutes, notes, status} + officials + home + away.
// Phase 2 added slot x/y, Team.formation, Match.drawings (pass|movement) and Match.savedLayouts.
// Phase 3 added Drawing kinds lofted/shot/freehand, points, note; Phase 4 events + clock; Phase 6 schemaVersion.
interface Officials { referee: string; assistant1: string; assistant2: string; fourthOfficial: string }

type MatchEvent =                        // all carry: id, period, matchTimeMs (array order = tie-break)
  | { type: 'periodMarker'; marker: PeriodMarker }   // Phase 4: replaces separate kickoff/halfTime/… types (A33)
  | { type: 'goal'; teamId: Id; scorerId?: Id; assistId?: Id; goalType: 'normal'|'penalty'|'freeKick'|'header'|'ownGoal'; notes?: string }
  | { type: 'substitution'; teamId: Id; outPlayerId: Id; inPlayerId: Id; reason?: string }
  | { type: 'yellowCard' | 'redCard'; teamId: Id; playerId: Id; notes?: string }
  | { type: 'note'; text: string; teamId?: Id };

interface Drawing { id: Id; kind: 'pass'|'shot'|'lofted'|'movement'|'freehand'; from: Point; to: Point; points?: Point[]; fromPlayerId?: Id; toPlayerId?: Id; note?: string;
  source?: { patternId: string; teamId: Id } }   // all fields implemented (Phase 3)
interface ClockState { period: Period; elapsedMs: number; runningSinceEpochMs: number | null; endedPeriod: PlayingPeriod | null }
```

**Goal credit rule:** for `goalType === 'ownGoal'`, `teamId` is the team *credited* (the opponent); `scorerId` is the responsible player from the other squad. Score = count of goal events per credited `teamId`. (Phase 4 must document and test this convention; the UI presents "own goal by X (Team)".)

**Active lineup:** `reconstructLineup(startingSlots, orderedEvents)` → per slot, current `playerId`, plus `bench` and `sentOff` sets. Substitutions that are invalid at their point in time are reported as validation errors, not silently skipped.

## 3. Feature → phase traceability

| Spec § | Feature | Phase |
|---|---|---|
| 4.1 | Workspace layout, nav, match name | 1 (shell); undo/redo 3; save status + export 6; scoreboard/clock/timeline 5 |
| 4.2 | Match info, officials, team info | 1 |
| 4.3 | Player registration + validation | 1 |
| 4.4 | Position terminology | 1 (data), 2 (labels on pitch) |
| 4.5 | SVG pitch, markers, drag, reset | 2 |
| 4.6 | Formations (10 presets), custom arrangements | 2 |
| 4.7 | Tactical patterns | 2 (initial library) |
| 4.8 | Drawing tools, undo/redo | 3 |
| 4.9 | Clock + periods | 4 (logic), 5 (UI) |
| 4.10 | Goals + score | 4 (logic), 5 (UI) |
| 4.11 | Substitutions | 4 (logic), 5 (UI) |
| 4.12 | Timeline, cards, notes | 4 (logic), 5 (UI) |
| 4.13 | Persistence, library, JSON, PNG | 6 |
| — | Responsive, a11y, QA, cleanup | 7 |

> Note: spec §4.1 lists undo/redo, save status and export in the workspace chrome. Per the "every visible control must work" rule these are **not** rendered until their phase makes them functional (undo/redo in Phase 3, save status and export in Phase 6).

## 4. Phases

Dependencies: 0 → 1 → 2 → 3; 1 → 4 (domain needs team/player types); 2+4 → 5; 1–5 → 6 → 7.

### Phase 0 — Repository audit and project plan *(Sonnet)* — DONE
- Audit repo; write `CLAUDE.md`, `docs/BUILD_PLAN.md`, `docs/IMPLEMENTATION_STATUS.md`; fix stack and data strategy.
- **Done when:** three docs exist and agree; next phase + model specified.

### Phase 1 — Application shell and match setup *(Sonnet)* — DONE
**Tasks**
- Scaffold Next.js (App Router, TS strict, Tailwind, ESLint, npm), add Vitest + RTL, `typecheck`/`test` scripts. Scaffold must not overwrite `CLAUDE.md`/`docs/`.
- Domain types for match setup; `createMatch()` factory; squad validation functions (unit-tested).
- App shell: header with match name and status; setup navigation; live setup checklist. (No pitch placeholder was added — it would be a non-functional control; Phase 2 introduces the pitch region.)
- Match info form (competition, home/away names, date, kickoff, venue, duration, notes, status).
- Team forms (name, coach); four officials.
- Roster editor per team: add/edit/remove players, shirt number, preferred position, notes; assign starting XI vs substitutes; enforce ≤ 22 players, unique shirt numbers, ≤ 11 starters, one slot per player.
- In-memory state for the open match via the reducer. (Persistence arrives in Phase 6; if setup data is lost on refresh in this phase, document it.)

**Acceptance:** app runs; match and roster forms work; both teams independent; squad and shirt-number validation works with clear messages; coherent professional style; typecheck/lint/test/build pass.

**Out of scope:** pitch, dragging, drawing, clock, events, persistence.

### Phase 2 — Pitch, formations and player dragging *(Opus)* — DONE
**Tasks**
- SVG pitch with all required markings; landscape + portrait via render transform; responsive viewBox.
- Formation presets for all 10 formations (team-relative coordinates, position codes per slot), `applyFormation` preserving player identity/starting-XI membership; reset-to-formation.
- Player markers (shirt number, compact label, position abbreviation; full names in tooltip/editor).
- Pointer-based dragging with pointer capture, normalisation, clamping, optional snapping; selection; manual position override.
- Custom arrangements: save/reuse named layouts.
- Initial tactical pattern library (12 patterns from spec §4.7) producing arrangements and/or movement arrows/annotations; non-destructive apply (confirm or snapshot), "clear annotations" without touching lineup.
- Tests: formation slot counts (11, one GK), coordinate bounds, mirroring, layout transform round-trip, identity preservation.

**Acceptance:** every formation yields a valid 11-player layout; formation switch moves markers and keeps identities; dragged positions stay correct on resize and orientation change.

### Phase 3 — Tactical drawing engine *(Opus)* — DONE
**Tasks**
- Tool state: Select/Move, Pass, Shot, Lofted Pass, Movement, Freehand (optional), Eraser, Clear Annotations; visible active tool.
- SVG arrows (yellow pass; red shot; yellow lofted with **LD** label on the arrow; dashed movement), arrowhead markers, label placement that stays legible.
- Start/end on a player or arbitrary coordinate; endpoint editing; select/delete; optional note; convert pass → lofted.
- Undo/redo for board state (A6); clear annotations keeps lineup.
- Disambiguate player drag vs arrow draw (tool-mode gating, hit-testing, `touch-action`), including touch.
- Tests: arrow geometry, hit-testing, reducer undo/redo, tool switching preserves drawings.

**Acceptance:** all drawing types render and edit correctly; undo/redo restores exact state; drawing never moves/deletes players; colours and LD readable.

### Phase 4 — Match domain logic and timekeeping *(Opus)* — DONE
**Tasks**
- Finalise event types; `clock.ts` state machine (start, pause, resume, correct, period transitions incl. extra time) using timestamps; formatters for `mm:ss` and `45+2'`.
- `score.ts` (own goals credited to opponent), `lineup.ts` (reconstruction + validation), `events.ts` (add/edit/delete, ordering, tie-break, historical-edit re-derivation).
- Reducer actions wiring domain functions (no UI).
- Tests (focused, per spec §5): lineup reconstruction, substitution validation (not on pitch, ineligible incoming, already used, multiple subs same minute), goal attribution, own goals, missing assist, score derivation, ordering with stoppage and duplicates, historical substitution correction, clock start/pause/resume/correct, refresh restore of running clock.

**Acceptance:** score always equals valid goal events; edited/deleted old events yield consistent lineup/bench; clock supports start/pause/resume/correction; business rules covered by tests.

### Phase 5 — Scoreboard and match event interface *(Sonnet)* — DONE
**Tasks**
- Scoreboard (teams, score, period, clock) + clock controls; clock keeps running across section changes.
- Goal form (scorer, assist, type, own goal), substitution form, card entry, note entry, with validation messages.
- Timeline with inspect/edit/delete; empty/loading/error states.
- Pitch and bench reflect substitutions via derived lineup.

**Acceptance:** goals update scoreboard + timeline; substitutions update pitch and bench; edits/deletes propagate everywhere; clock unaffected by navigation.

### Phase 6 — Persistence and exports *(Sonnet)* — DONE
**Tasks**
- `MatchRepository` (localStorage), autosave with save-status indicator, storage-failure handling (quota, disabled).
- Match library: create, open, rename, duplicate (new IDs), delete (confirm).
- zod schemas + migrations; JSON export/import with specific error messages.
- PNG export of board only (pitch, markers, labels, arrows, LD) with readable text.
- Tests: schema validation (valid + malformed), JSON round-trip equality, duplicate-ID regeneration, restore of running/paused clock.

**Acceptance:** matches survive refresh; drawings and events restore; JSON round-trip preserves full match; PNG contains expected content.

### Phase 7 — Integration, responsive design and QA *(Sonnet)* — DONE
**Tasks**
- Walk the §8 acceptance checklist end to end; fix defects.
- Resolve lint/type/test failures; remove dead code and unused dependencies.
- Responsive pass at desktop, tablet, and phone widths; keyboard and label review.
- Update all docs; record verification status per feature. If an architecture bug resists a focused attempt, stop and recommend Opus with issue, repro, files, failing test.

**Acceptance:** build + checks pass; core flows exercised; limitations documented; each feature has a verification status.

## 5. Definition of done (any phase)

1. Only the requested phase's scope was implemented.
2. `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` were run (where they exist) and results recorded honestly.
3. New domain logic has unit tests; interactions have component tests where practical.
4. No visible control is non-functional.
5. `CLAUDE.md` updated if architecture or commands changed.
6. `docs/IMPLEMENTATION_STATUS.md` updated (files, deps + reasons, commands run, results, limitations, next phase + model).
7. Final response ends with the standard Phase Boundary block.

## 6. Final product acceptance

The checklist in the original brief (§8) is the product acceptance test; Phase 7 verifies each line and records pass/fail/not-verified in `docs/IMPLEMENTATION_STATUS.md`.
