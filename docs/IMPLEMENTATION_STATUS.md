# DizPitch — Implementation Status

Authoritative handoff document. If code and this file disagree, trust the code and correct this file.

## Summary

| Item | Value |
|---|---|
| Last completed phase | **Phase 7 — Integration, Responsive Design and QA** (final planned phase) |
| Product state | Feature-complete against the brief's §8 acceptance checklist; verified in a real browser (see matrix below) |
| Next phase | None planned. Optional follow-ups at the end of this file |
| Last updated | 2026-10-12 |
| Version control | Last commit `ce96767` (Phase 3). **Phases 4–7 and all post-Phase-7 features (incl. `cv-service/`) are uncommitted**; Claude does not commit unless asked |
| Post-Phase 7 features | **Team presets (ISL 2026-27)** (`/new`, `npm run presets`, schema v4): implemented and verified in a real browser against the real league site and image CDN — see "Team presets" below. **Computer-vision tracking** (`Replays → Track a video`, `cv-service/`, schema v3): implemented; the real models were run on the real `test_clip.mp4` through the real UI in WebKit — see "Computer-vision tracking" below. **Licence decision open (AGPL-3.0).** **Tactical replays from video clips** (`Replays` view, schema v2): implemented; verified in a real browser against a *stand-in* for Gemini, **never against the real Gemini API** — see "Tactical replays" below. **Image-to-match import** (`/import`): implemented and verified except against a real vision provider — see the section below. **Fullscreen pitch**: implemented and verified in real Chromium (native + overlay fallback) — see "Fullscreen pitch" below |

## Jersey display (added after Phase 7)

Board option **Circles | Jerseys** for matches that use ISL team presets; details, colour sources and what is unverified are in `docs/TEAM_PRESETS.md` ("Jersey display").

| Item | Value |
|---|---|
| Activation | Board → **Jerseys** (control hidden unless a team has a kit theme). Saved with the match; kit per side in the **Kits** panel |
| Persisted | Schema **v5**: optional `Match.playerDisplay`, `Team.kit`, `PlayerOrigin.assignedNumber`; migration `4 → 5` is the identity; v4 documents open with circles |
| Code | `domain/presets/kits.ts`, `components/pitch/Jersey.tsx` + `usePlayerKits.ts`, `PlayerMarker`/`TacticalBoard` (board), `ReplayMarker`/`ReplayPitch` and `TrackingPitch` (replays), `board/PlayerDisplayControl.tsx` + `KitPanel.tsx`, reducer actions `display/setPlayers` + `team/setKit` |
| Themes | All 13 clubs of the 2026-27 dataset. 4 documented, 8 partial, **1 unverified (Inter Kashi: stand-in design)**; away kits documented for 4 clubs (Mohun Bagan, Chennaiyin, Punjab, SC Delhi — the last single-sourced), the rest use a labelled generic stand-in |
| Behaviour decisions | In a preset-vs-custom match only the preset side wears jerseys. Unknown numbers (temporary ones from the import) print nothing. Empty slots keep the dashed circle (tinted with the kit colour) |

### Verification (commands run this session)
| Command | Result |
|---|---|
| `npm run typecheck`, `npm run lint`, `npx knip --no-progress` | Pass, nothing printed |
| `npm test` | **55 files; 770 passed, 2 skipped** (+ `kits.test.ts`, `Jerseys.test.tsx`, replay jersey tests, v4 → v5 migration, round-trip, reducer rules) |
| `npm run build` | Pass |
| Real browser (Playwright Chromium, production build): custom match has no selector and circles; preset match defaults to circles; switching keeps every position; a jersey is dragged with the mouse; mode persists after reload; kit choice applies; axe 0 violations; PNG export written; control present in fullscreen; no horizontal overflow at 390 px; no console errors | **11/11** |
| Visual check of 7 team pairs covering all 13 clubs (screenshots reviewed) | Colours, numbers and the home/away distinction read clearly; two similar-red clubs automatically get the away kit for one side |

Not verified: other browsers, a touch device, and replays with jerseys in a real browser (covered only by component tests); no club confirmed its colours to us, and hex values are approximations.

## Team presets — ISL 2026-27 (added after Phase 7)

Spec: "DizPitch: Build an ISL Team Preset System". Full reference: [`docs/TEAM_PRESETS.md`](TEAM_PRESETS.md); import audit: [`docs/presets/isl-2026-27-import-report.md`](presets/isl-2026-27-import-report.md).

### What it does
Library → **Create from ISL teams** → `/new` offers **ISL presets** or **Custom teams**. Presets: one card per club (crest, name, abbreviation, home city, head coach, squad size, season); choose one Home and one Away (never the same club); *Create match* snapshots both teams into an ordinary match and opens the normal workspace. Each team gets its name, coach and the **whole registered squad in a squad pool**; the XI, bench and formation are untouched, so the existing setup flow (move players *To XI* / *To bench*, edit, add custom players, return to pool) continues exactly as before. Custom teams (and the library's *Create match manually*) are unchanged.

### Data collected (read 2026-10-12)
| Item | Result |
|---|---|
| Season | **Indian Super League 2026-27**: the fixtures page names series 944 `Indian Super League, 2026-27`, and every squad page is tagged series 944 (the importer refuses a squad whose series maps to another season; the site's footer still says "Season 2025-2026", which is stale) |
| Teams | **13** (Bengaluru FC, Chennaiyin FC, Churchill Brothers SC, East Bengal FC, FC Goa, Inter Kashi FC, Kerala Blasters FC, Mohun Bagan Super Giant, Mumbai City FC, NorthEast United FC, Odisha FC, Punjab FC, Sporting Club Delhi) |
| Players | **366** (22–36 per club), each with source URL, headshot URL, profile URL, position, nationality, shirt number (365 of 366), date of birth (336 of 366) |
| Head coaches | **13 of 13**, with photo URL |
| Logos | 13 of 13 URLs; abbreviations 13 of 13 (from the fixtures page) |
| Verification | Every record is `official` = as published on the league's own pages that day. **Not cross-checked against a second source** |
| Gaps | home city: 1 (Inter Kashi, no venue line); short name: 13 (site publishes only abbreviations); DOB: 30 (profile pages that ship no biography in their HTML); nationality: 9; shirt number: 1 (published as `-1`); 7 duplicated shirt numbers on the official page (East Bengal #8 ×2, #34 ×2; Kerala Blasters #26; Punjab #11; Sporting Club Delhi #8, #18, #99); positions are only the 4 coarse categories |
| Network | 16 requests (robots.txt, home, fixtures, 13 squads) + 366 profiles, one per second; raw pages cached in git-ignored `.cache/presets/` |

### Architecture
| Layer | Location | Notes |
|---|---|---|
| Reusable model | `src/domain/presets/types.ts` | `SeasonPresets → TeamPreset → CoachPreset/PlayerPreset`, season-scoped, stable ids (`isl-club-656`, `isl-player-19150`), per-record `verification`, `notes`, `source {url, retrievedAt}` |
| Snapshot | `src/domain/presets/{snapshot,toMatch}.ts` | preset → match team with fresh ids; imported values kept in `Player.origin.imported`; temporary numbers for unusable source numbers; `buildMatchFromPresets` |
| Squad pool | `src/domain/squad.ts` (`getPool`, `promoteFromPool`, `returnToPool`, `updatePoolPlayer`), reducer `pool/*`, `useMatchActions` | `Team.players` stays the ≤ 22 matchday squad (invariant 12 unchanged) |
| Persistence | `persistence/schema.ts` (v4), `migrate.ts` (`3 → 4` identity), `document.ts`, `domain/duplicate.ts` | `Team.pool?`, `Team.preset?`, `Player.origin?` all optional |
| Preset files | `public/presets/index.json`, `public/presets/isl/2026-27.json` (≈ 300 KB) | validated in the browser with the importer's zod schema (`src/presets/schema.ts`, `client.ts`) |
| Importer | `scripts/presets.ts` + `src/presets/{isl,manual,overrides,diff,quality,report}` | `fetch` / `import` / `validate`; preview by default, `--apply` writes; overrides survive refreshes |
| UI | `components/presets/` (`NewMatchView`, `TeamCard`, `usePresetCatalog`), `components/setup/{SquadPool,PlayerBadges}`, `components/ui/{RemoteImage,Avatars}` | image fallbacks, host allow-list, lazy loading |

### Design decisions that were not obvious
* **Squad pool instead of raising the 22-player cap.** An ISL registered squad has 22–36 players; invariant 12 and every event/board/lineup path assume a matchday squad of ≤ 22 with a role each. A separate optional pool keeps all of that untouched and keeps "the user chooses the XI" literally true.
* **Snapshots, not links**, with imported values retained so manual corrections are visible ("Corrected"), hand-added players are labelled ("Added by you"), and a missing source number is flagged ("Number missing", temporary number from 99 down).
* **Static JSON + CLI instead of a runtime scraper or a server route**: no backend exists, refresh needs no rebuild, the browser works offline once loaded, and scraping stays an explicit, previewed, auditable maintenance step.
* **Parsing the embedded widget data of the public page** (the server-rendered JSON in the same HTML document) with a cross-check against the visible cards, instead of the site's data API, which was not documented and whose `/api` paths robots.txt disallows.
* **Images linked, not stored**; only the league host is allow-listed; `NEXT_PUBLIC_PRESET_IMAGES=off` for certainty.
* **New dev dependency `tsx`** (`^4.23.15`) so `scripts/presets.ts` shares the TypeScript schema/parsers with the app and tests.

### Bugs found by verifying this feature (all fixed)
| Problem | Found by | Fix |
|---|---|---|
| Some logos carry a bare `?103.31` cache-buster (not `?v=`), so stored URLs would have churned every deploy | Parser test on a real page excerpt | `absoluteUrl` clears the query for `/static-assets/` URLs |
| ~8 % of profile pages ship `"pagePlayerData":{}` first, which was reported as a parse failure | The first real `--profiles` run (26 "failures") | Every occurrence is tried; a profile with no data yields no DOB and a note |
| 194 warnings "profile names the player differently" (just shorter forms) buried the real ones | Reading the first import report | `isSamePerson` token check; 4 genuine nickname cases remain |
| Inter Kashi is "Inter Kashi FC" on its squad page but "Inter Kashi" elsewhere, silently | Reading the report | A note records the alternative names |
| `getByLabelText('Shirt number')` style ambiguity and lazy images made two first-draft checks wrong (script, not app) | Real-browser run | Scripts corrected; headshots verified 36/36 |
| Ambiguous date "10/12/2026" on the Create match screen | Screenshot review | `formatDay` ("12 Oct 2026") |
| A mutation of the duplicate-match code (sharing `origin` objects) was not caught | Mutation check | `duplicate.test.ts` presets cases |

### Verification (commands run this session)
| Command | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass, no warnings |
| `npm test` | **53 files; 747 passed, 2 skipped** (the skipped are the real-provider lineup tests). New: 97 tests (652 → 749 incl. skipped) across `snapshot`, `squadPool`, `presets`, `isl`, `dataset`, `Presets`, `duplicate`, `migrate` |
| `npm run build` | Pass; `/new` prerendered static |
| `npx knip --no-progress` | Prints nothing |
| `npm run presets -- fetch --profiles --apply` | 13 teams, 366 players, 0 blocking errors, 79 warnings (all gaps listed above) |
| `npm run presets -- validate` | 13 teams, 0 errors, 79 warnings |
| Mutation checks (9 guards: events block on pool return, shirt-number clash, capacity, season guard, image host allow-list, XI left empty, robots rules, same-team guard, clone independence) | All 9 caught by a failing test (one needed a new test) |
| Real browser (Playwright Chromium headless shell, production build, real data, real CDN) | **37/37 checks**: 13/13 crests and 36/36 headshots load; card details; same-club blocked; create → normal workspace; 36-player pool; XI of 11; 12th starter refused; duplicate #8 explained; custom player labelled; board shows the XI; no `<image>` on the SVG; PNG export valid (347 KB); reload keeps state; stored document v4 (58 KB for two teams); JSON export contains pool/preset; re-import makes a copy; custom-teams flow intact; image host blocked → fallbacks, setup usable; "not imported" instructions with no fake teams; phone width 390 px no overflow; **axe 0 violations** on `/new`, Setup with pool (desktop + phone) and Board; no console/page errors |

### Not verified / limitations
* **Data accuracy is as published**: not compared with a second source, and squads move (re-run the preview before an important match). No terms-of-use page was found; use of the site was limited to public pages at one request per second, and image rights are unconfirmed (hence link-only).
* Only Chromium (headless) was exercised; Safari/Firefox/iOS and a real tablet were not. The CDN's images are large (~350 KB each); the first view of a 36-player pool downloads them lazily.
* Position is only the coarse category; the preferred position is the nearest DizPitch code and may need correcting. Formation slots are never assigned automatically.
* The importer targets this site's current markup (embedded widget JSON + card HTML); a redesign will make it fail loudly (parse errors) rather than import wrong data, and the manual CSV/JSON path remains.
* 30 players have no date of birth because their profile pages carry no biography in the HTML; the site's internal data API was deliberately not used.
* Playwright's own browser installer hung under Node 26 while extracting; the headless shell was unzipped manually in the session scratchpad. Nothing from that is in the repo (as with earlier ad-hoc QA scripts, decision A54).
* Presets are loaded whole (≈ 300 KB per season) when `/new` opens.

## Computer-vision tracking (added after Phase 7)

Spec: "Build DizPitch's Computer-Vision Pipeline for Football Video Tracking and Tactical Replay". The primary video path no longer uses a generative model: dedicated detectors + a tracker + deterministic geometry run in a separate local Python service. The Gemini clip feature is kept as a secondary "AI sketch from a clip" button.

### Decisions
| Question | Decision | Why |
|---|---|---|
| SoccerNet `sn-gamestate` vs a modular baseline | **Modular baseline** | sn-gamestate needs Python 3.9, torch 1.13.1, CUDA-era mmcv 2.0.1 and many git dependencies, is GPL-3.0, and auto-downloads a large dataset; not installable on this Apple-silicon machine without a CUDA stack |
| Detector | Roboflow `sports` YOLOv8 football models (players/goalkeepers/referees/ball, separate ball model, 32-keypoint pitch pose model), run with Ultralytics 8.4 | Football-specific weights that are publicly downloadable; see licences |
| Tracker | ByteTrack from Roboflow `trackers` 2.6 (Apache-2.0), associated in camera-motion-compensated coordinates with GIoU | supervision's ByteTrack is deprecated (removed in 0.31); compensation was measured to matter (66 → 48 → 42 tracks on the test segment) |
| Calibration | Keypoints → RANSAC homography pooled over ±12 frames via optical-flow camera motion, leave-one-landmark-out acceptance (≤ 0.8 m, ≥ 6 landmarks), propagation ≤ 50 frames; plus manual landmark calibration in the UI | The model's output cannot be trusted blindly (see limitations), so the UI shows projected lines for verification |
| Service | FastAPI in `cv-service/` with uv (Python 3.12), isolated from npm; Next proxy `/api/cv/[...path]` with a path whitelist | Keeps PyTorch out of the web app; same origin, no CORS |
| FFmpeg | Not required | OpenCV's wheel bundles FFmpeg decoding; timestamps come from the container |
| Frame skipping | None by default (`CV_FRAME_STRIDE=1`) | Profiled first: ~0.47 s/frame on MPS; correctness wins over speed for ≤ 15 s segments |

### Licences — need your decision
- **Ultralytics is AGPL-3.0**, and Ultralytics states that models trained with it are AGPL-3.0 by default; the Roboflow `.pt` weights are YOLOv8-trained. Running this as a network service obliges you to publish the service's source under AGPL-3.0 or buy an Ultralytics Enterprise licence. **Not decided here.**
- The training data's licence could not be verified (Roboflow Universe pages returned 403); the footage reportedly comes from the Kaggle "DFL – Bundesliga Data Shootout", whose rules may restrict use. **Not decided here.**
- Everything else is permissive (trackers Apache-2.0, supervision MIT, OpenCV Apache-2.0 with LGPL FFmpeg libraries, PyTorch BSD-3, FastAPI MIT). Details and alternatives: `cv-service/README.md`.

### Architecture
| Layer | Location | Notes |
|---|---|---|
| Service | `cv-service/app/` | `video_io` (sniff, probe, validate, timestamped decode), `detector`, `tracker` (ByteTrack wrapper, ball gating, back-fill of each new track's first frames, stitching), `pitch` + `pitch_calibration`, `team_assignment`, `trajectory`, `processing` (one job), `scan` (cuts + wide-shot suggestions), `jobs` (one worker, upload cleanup, TTL), `main` (API), `diagnostics` + `cli` |
| Wire schema | `cv-service/app/schemas.py` → `cv-service/schema/tracking-result.v1.schema.json`; `src/tracking/schema.ts` (zod) | `schemaVersion: 1`; provenance per observation; image coords kept apart from pitch coords; `pitch: null` when uncalibrated |
| Model | `TacticalReplay.origin: 'tracking'` + `tracking: TrackingData` | Persisted schema **v3** (migration 2 → 3 adds `tracking: null`); cross-field validation in `parseDocument`; duplicate remaps squad links |
| Pure domain | `src/domain/tracking/` | Homography (normalised DLT, LOO, collinearity), landmarks, sampling with gap rules, overlay geometry, edits, build/validate |
| UI | `src/components/tracking/` (+ `ReplaysView`/`ReplayList`) | Import (health, preview, segment, scan, real progress, cancel), editor (video + overlay beside the pitch, Teams / Tracks / Calibration / Details), viewer (plays stored data; optional re-attached video) |

### Tests and what they prove
| Suite | Proves | Does **not** prove |
|---|---|---|
| `cv-service` unit (`uv run pytest -m "not integration"`, 38) | Probe/timestamps/segments, validation limits, homography + calibration against a synthetic pan with known geometry, camera-motion chaining, cut detection, tracking plumbing (one track per synthetic player across the pan, every frame), back-fill, stitching rules, ball gap rules (short = interpolated, long = empty), uncalibrated → `pitch: null`, team clustering, schema, API errors (415/413/400/503), job lifecycle deletes uploads, exported JSON Schema is current | Detection quality (fake detectors report ground truth) |
| `cv-service` integration (`-m integration`, real weights, real clip) | The real models load and produce structurally valid, plausible output on `test_clip.mp4` | Accuracy against ground truth (there is none for this clip) |
| `domain/tracking/tracking.test.ts` | Homography maths, LOO, degenerate input, landmarks; real-fixture build + validation; sampling (exact, adjacent-frame smoothing, interpolation only across ≤ 0.5 s, gaps empty), edits (reject, place, clear, merge refusal, one player per track, side mapping), manual calibration through camera motion, overlay geometry | — |
| `tracking/client.test.ts`, `app/api/cv/[...path]/route.test.ts` | Upload → real progress → polling → validated result → job deleted; errors passed through; invalid results refused; cancel deletes the job; proxy forwards only whitelisted paths, streams uploads, explains an unreachable service | — |
| `components/tracking/Tracking.test.tsx` (9) | The real UI with injected service calls returning REAL recorded output: availability messages, segment validation, scan suggestions, progress + cancel, failure, team mapping, squad linking, reject/undo/place corrections, save, playback without new requests or match writes, reopen without the service, hide/join, manual calibration from clicked landmarks | Real decoding or networking (covered by the browser run) |
| `persistence/replays.test.ts` + `migrate.test.ts` | v2 → v3 migration with an old fixture, exact round-trip of a tracked replay with edits, squad-link repair, inconsistent tracking refused, duplicate remapping | — |

### Measured on `test_clip.mp4` (Apple M5, MPS)
`test_clip.mp4` is a **5 min 45 s ISL highlights package** (344.84 s, 8621 frames, 25 fps, 854×480, H.264; 66 camera cuts), not a single short clip.
- Speed: ~0.47 s per frame (player and ball models ~170 ms each, pitch model ~50 ms). 8 s segment = 200 frames ≈ 85–95 s. Full-file shot scan ≈ 56 s.
- Segment 147.2–155.2 s: 43 person tracks (median 45 frames), 2 fragments stitched; calibration on 77/200 frames (median self-consistency error 0.85 m); ball on 96/200 frames, 16 short gaps interpolated; one cut at frame 147 into a close-up where the detector fails (boxes on a boot/arm, players missed).
- Browser shows exactly the frames the service analysed (frame grabs at 4 positions matched OpenCV's decode at offset 0).
- Diagnostics: `cv-output/seg147/` (`result.json` 216 KB, `diagnostic.mp4`, `frames/`, `summary.txt`), also `cv-output/seg140/`, `cv-output/seg191/` (these two are from before the back-fill change).

### Bugs found by verifying this feature (all fixed)
| Problem | Found by | Fix |
|---|---|---|
| The keypoint model produced a self-consistent wrong pitch that passed RANSAC/LOO | Visual check of projected lines on real frames | Calibration labelled *unverified*; projected lines over the video; reject + manual calibration |
| A "lower 70 % of the image" plausibility rule rejected correct calibrations | Real frames | Replaced by "the pitch grid maps in front of the camera and the image centre maps near the pitch" |
| Every track lost its first 2 frames (ByteTrack confirmation), so the first frames and the frames after each cut had no boxes | Real-browser screenshot of frame 1 | Back-fill from the detections that formed the track (IoU in stabilised coordinates, same shot) |
| Attaching the video while paused mid-replay showed frame 1 next to a later pitch frame | Real-browser screenshot of the viewer | The video seeks to the clock's frame on `loadedmetadata` |
| Sub-frame smoothing between consecutive detections was drawn as "interpolated" (markers flickered dashed at 60 Hz) | Review of sampling at render rate | Adjacent-frame smoothing counts as detected; only gaps across missing frames are interpolated |
| A saved 8 s tracked replay took ~1 MB of `localStorage`: documents are stored indented, which puts every number of the tracking arrays on its own line | Real-browser storage measurement (1057 KB) | `serializeDocument` writes tracking blocks unindented (placeholder that cannot collide with user text): 987 KB → 230 KB for the same match; test added |
| The selected track row's frame count failed WCAG AA contrast | axe in WebKit | `text-zinc-300` |
| ESLint scanned `cv-service/.venv` | `npm run lint` | `cv-service/**`, `cv-output/**` ignored in ESLint and tsconfig |
| `supervision`'s ByteTrack is deprecated/removed | Install warning | Switched to Roboflow `trackers`; supervision pinned `< 0.31` |

### Known limitations
- Automatic calibration covered 77/200 frames of the best-studied segment; the rest have no pitch positions unless the user calibrates the shot by hand. Its correctness is not guaranteed (see above).
- Identities switch when players cross; ids restart at cuts; stitching is conservative. Squad linking is manual by design.
- Ball: about half the frames in wide shots at 480p; positions assume the ball is on the ground.
- Close-ups, replays and behind-the-goal shots: detector and calibration fail; choose wide segments (scanner).
- Not real time; one job at a time; segments ≤ 15 s. A tracked replay adds ~230 KB per 8 s to `localStorage` (~5 MB per site, so roughly twenty segments in total).
- The video beside the pitch needs a browser that decodes the file (Playwright's Chromium cannot play H.264; WebKit/Safari/Chrome can).
- No per-step undo in the tracking editor (Discard/Cancel only); manual calibration is per shot.

### Verification (commands run this session)
| Command | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass, no warnings (`cv-service/**` and `cv-output/**` ignored) |
| `npm test` | **47 files; 650 passed, 2 skipped** (the skipped are the real-provider lineup tests) |
| `npm run build` | Pass; `/api/cv/[...path]` dynamic |
| `npx knip --no-progress` | Prints nothing |
| `cd cv-service && uv run pytest -m "not integration"` | **38 passed** |
| `cd cv-service && uv run pytest -m integration -s` | **1 passed** — real weights on `test_clip.mp4` 147.2–149.2 s: 23 person tracks, longest 50 frames, calibration 25/50 frames, 24.9 s on MPS |
| `uv run python -m app.cli analyze ../test_clip.mp4 --start 147.2 --duration 8 --out ../cv-output/seg147` | 200 frames in 94 s; 43 person tracks; calibration 77/200; ball 96/200 (+16 interpolated); outputs in `cv-output/seg147/` |
| `uv run python -m app.cli scan ../test_clip.mp4` | 67 shots in 68 s; 12 suggested segments (the 190.52 s suggestion is the fast pan behind the goal: wide score cannot detect that) |
| Real browser (Playwright **WebKit**, production build on :3170 + real cv-service on :8001, real `test_clip.mp4`, 8 s segment) | **18/18 checks**: service status; file length read locally; real progress (upload % → frame counter → calibration), tracking 94 s; H.264 video plays beside the pitch at the segment start; while playing the video stays within 0.036 s of the replay clock; paused = exact frame; save; stored match 233 KB with no video bytes; reload → replay plays from stored data without video or service; re-attached video opens at the clock's frame; **axe 0 violations** on import, editor (teams, calibration, tracks with selection), viewer with and without video; no console errors |
| Frame alignment (scratchpad `frame_sync.py`) | Frames WebKit displayed at segment frames 0/40/75/120 match OpenCV's decode of the same source frames (offset 0; neighbouring frames differ 2–3× more) |

Not verified: Chrome/Firefox/Safari desktop apps and phones with this feature (Playwright's Chromium cannot decode H.264, so WebKit was used); CUDA and CPU-only devices; a second video source; tracking accuracy against ground truth (none exists for this clip).

## Tactical replays from video clips (added after Phase 7)

Spec: "AI-Powered Video Event Analysis and Tactical Replay". **Not verified against the real Gemini API** (no key in the development environment); see the tables below for exactly what was and was not exercised.

### What it does
New workspace tab **Replays**. A list of the match's replays (play / edit / delete with confirmation); **Import video clip** or **Create replay by hand**. Clip flow: choose file (client checks magic bytes, size and duration against the limits the server reports) → preview and confirm → one analysis → editable review → save → play. The review has Event / Players / Keyframes / Arrows / Labels panels over the live pitch preview: edit event type, description, clip timestamps, match clock, outcome, attacking team; identify (or leave unidentified) players and link them to squad players; drag players/ball (creates a keyframe at the current time) or nudge with arrow keys; add/edit/remove keyframes, arrows (pass, lofted pass with LD, shot, run; ends can follow a player) and labels. Re-analysis exists only as an explicit, confirmed action. Saved replays play, pause, reset, replay, scrub, step between keyframes and run at 0.25/0.5/1/2×, using one animation-frame loop.

### Architecture
| Layer | Location | Notes |
|---|---|---|
| Model | `Match.replays: TacticalReplay[]` (`domain/types.ts`) | Persisted with the match: schema **v2**, migration `1 → 2`, JSON export/import and duplicate included |
| Pure domain | `src/domain/replay/` | coords (0–100 canonical), interpolation (cubic Hermite, clamped), playback clock, analysis→replay build (timestamp mapping), immutable edit ops, validate/repair |
| Server | `src/video-analysis/`, `src/app/api/analyze-video/route.ts`, `src/lib/gemini.ts` | Files API upload → poll → one `generateContent` (explicit `videoMetadata.fps`, JSON schema) → delete; shared Gemini helpers also used by the lineup feature |
| UI | `src/components/replay/` | Reuses `PitchMarkings`, `DrawingLayer`/`DrawingDefs` (arrow styles incl. LD), `PITCH_THEME`, `viewBoxFor`/`clientToPitch`, `ConfirmBar`, fields. `ReplayPitch` is a sibling of `TacticalBoard` (the board is bound to slots/gestures), not a second pitch drawing |

Design choices: FFmpeg is **not** used (not installed here; Gemini's per-part `videoMetadata.fps`, valid range 0–24, replaces the default 1 fps sampling, configurable via `VIDEO_SAMPLING_FPS`); the analysis wire schema is lenient on numbers (the model answering x = 104 must not lose the analysis) and `normalizeAnalysis` clamps, drops unknown references and reports every change in `warnings`; the AI answers in the attacking team's frame and the app rotates into the canonical frame for the chosen attacking side; the SDK client is created with one attempt, so no analysis is ever repeated automatically; the clip is not persisted anywhere.

### Configuration, cost, privacy
| Item | Value |
|---|---|
| `GEMINI_API_KEY` | Required for automatic analysis (shared with the lineup import). Server only; never returned or logged. Without it manual replays still work |
| `GEMINI_MODEL` | Optional. Default `gemini-3.8-flash` (the model Google's docs recommended when this was written; **not confirmed by a live call**) |
| `VIDEO_MAX_MB` / `VIDEO_MAX_SECONDS` | Optional. Defaults 50 MB / 60 s. Enforced in the browser, again on the server (magic bytes, size, declared duration) and a third time on the duration Google *measures* after upload |
| `VIDEO_SAMPLING_FPS` | Optional. Default 5; clamped to (0, 24] |
| `VIDEO_PROCESSING_TIMEOUT_MS` / `VIDEO_ANALYSIS_TIMEOUT_MS` | Optional. Defaults 120 s / 180 s |
| `GEMINI_BASE_URL` | Optional endpoint override (proxy / local stand-in); the key is sent to it |
| Cost | One `generateContent` per analysis. Roughly (frames × per-frame tokens + audio) input plus a structured reply; Google's docs give about 66 tokens per frame at default resolution (+ ~32/s of audio) — e.g. a 30 s clip at 5 fps ≈ 150 frames. Dollar cost not measured; depends on the model and your tier. Re-analysis costs the same again and needs confirmation |
| Privacy | Clip → DizPitch server → Google Gemini Files API → deleted after the request (best effort; failures are swallowed). Not stored by DizPitch. **On a free (unpaid) key Google may use submitted content to improve its products and humans may review it; paid keys are not** (Google's Gemini API terms). Video can show people, so this matters more than for lineup graphics; the import screen says so |
| Exposure | `/api/analyze-video` spends the key's quota and uploads the sender's clip for anyone who can reach the server. There is no auth (out of scope); do not expose a configured instance publicly |

### Tests and what they prove
| Suite | Proves | Does **not** prove |
|---|---|---|
| `domain/replay/replay.test.ts` (31) | Coordinates and orientation mapping, interpolation (exact at keys, bounded, deterministic), timestamp mapping, analysis → replay (identity gating, side mapping, away rotation, merging), edit ops, clock state machine, validate/repair | — |
| `persistence/replays.test.ts` (6) + `migrate.test.ts` | v1 → v2 migration and a complete v1 document, exact round-trip of replays (original analysis, provenance), rejection of off-pitch/duplicate/malformed replays with paths, dangling-link repair, duplicate-match remapping and independence | — |
| `video-analysis/video.test.ts` (34) | Config and limits, magic-byte sniffing, normalisation of malformed/hostile answers, provider call order, polling, explicit fps, measured-duration limit, cleanup on every path, **no automatic retry (incl. a real SDK against an HTTP 503)**, error mapping, the real SDK against a local Files-API/`generateContent` stand-in | Model quality; that the live API accepts the request exactly as sent |
| `video-analysis/client.test.ts` (8) | Status, pre-upload checks, multipart request, error envelopes, malformed server answers, cancellation | — |
| `components/replay/Replays.test.tsx` (19) | Whole UI flow with injected fakes: preview-before-analyse, one analysis per click, failure → explicit retry, not-configured, rejected clips, edit/drag/keyboard/arrows, save with unidentified players, edits survive reopen, match untouched, manual replays, play/pause/reset/replay/scrub/speed/step with no new request, loop cancelled on close, delete, portrait key mapping, re-analysis only after confirmation | Real decoding, real network |
| Real-browser run (Playwright/Chromium, production build, 42 + 6 checks) | Real WebM made in the browser → preview → `/api/analyze-video` → real SDK on the server → **local Gemini stand-in** (asserted: key only as a header, `fps` and JSON schema sent, one analysis, file uploaded/polled/deleted, model from `GEMINI_MODEL`) → review → drag/arrow/save → playback → reload → replay from stored data with no further request; saved document is schema v2 and ~28 KB with no video bytes; match unchanged outside `replays`; 503/rejected key/garbage/safety block surface correctly with exactly one request each; non-video rejected before upload; not-configured screen; key absent from client bundles; axe 0 violations on list/import/review/viewer/failure/phone; no console errors | That Gemini understands football footage, or returns this schema reliably. The stand-in returns a fixed fixture regardless of the clip |

### Bugs found by verifying this feature (all fixed)
| Problem | Found by | Fix |
|---|---|---|
| 0–100 ↔ 0–1 conversion left float noise (`55.00000000000001`) that would have been persisted | Domain tests | Stored coordinates are rounded to 1/1000 at the conversion boundary |
| Duplicating a match shared position objects (and reused replay-internal ids) with the original | `duplicate.test.ts` (id-uniqueness) | Replay clone remaps actor/keyframe/path/label ids and deep-copies positions and the analysis |
| The editor's remount key relied on `analysedAt` changing, so a fresh analysis could keep stale edits | Re-analysis component test | Explicit `generation` counter |
| SDK-level retries were not covered by a test, so a regression could silently repeat a paid analysis on 5xx | Mutation check of the provider | Wire test with an HTTP 503 asserting a single `generateContent` request |
| Ball marker did not announce that its position is an estimate (players did) | Component test | Same description for ball and players |
| Portrait arrow-key nudges were inverted | Review of the mapping + test | `[dx, dy] = [-screenY, screenX]` |
| A mock-heavy test asserted a value against itself | Self-review | Replaced by a check against the fixture |

### Known limitations
- **Live Gemini was never called.** Whether the model returns a usable analysis for real footage, how good the estimated positions are, whether the frame-rate/schema/`responseJsonSchema` request is accepted exactly as sent, and the default model id are all unverified. The prompt and schema were designed from the documentation.
- A broadcast clip cannot give true pitch coordinates, the attacking team, or reliable identities; the app stores confidence and shows estimates as estimates, but the reconstruction can still be wrong. It is an editing aid, not tracking data.
- One primary event per clip (others are kept in `original.otherEvents` and the timeline but are not separate replays).
- No FFmpeg path: clips Google cannot decode are reported as processing failures. Only MP4, MOV and WebM are accepted. Duration is checked against the browser's metadata and Google's measurement; there is no server-side container parser.
- Uploads are read fully into server memory (`formData()`); the 50 MB default is the practical limit. No upload progress; "Stop waiting" cannot cancel work the server has already started.
- Retaining the source clip was not implemented (not necessary: replays play from saved data). If wanted, IndexedDB, not `localStorage`.
- Replay editing has no per-step undo (only "Revert edits" to the state when the editor opened). Arrow ends are positioned by actor attachment or numeric X/Y, not by dragging handles.
- Defender/keeper markers are limited to what the model listed; there is no automatic inference of off-screen players.
- Phone layout works but the editor is long (pitch, controls, then panels).
- `npm install` of `@google/genai` prints an allow-scripts warning for its transitive `protobufjs` postinstall; the script is not run and nothing depends on it.

### Verification (commands run this session)
| Command | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass, no warnings |
| `npm test` | **43 files; 602 passed, 2 skipped** (the skipped are the real-provider lineup tests) |
| `npm run build` | Pass; `/api/analyze-video` and `/api/extract-lineup` dynamic |
| `npx knip` | Prints nothing |

## Fullscreen pitch (added after Phase 7)

A **Fullscreen** button in the board controls row expands the existing board to the whole screen (OTT-style); **Exit fullscreen** replaces it, in the same place, while active.

### Behaviour
- Uses the browser Fullscreen API on the board stage element (`BoardView`: tools + pitch, one DOM subtree, never a copy). If the API is missing or refused (iPhone Safari, permissions policy) the same stage becomes a `fixed inset-0` viewport overlay with page scroll locked.
- While fullscreen: compact bar (icon-only tools, undo/redo, Clear annotations, orientation, snap, Exit); Export PNG, side panels (selection/drawing editor, bench, formations, patterns) and the no-players hint are hidden; the screen is filled with the pitch's surround colour; the pitch is scaled to the available box without distortion (`TacticalBoard fill`).
- Exit: the button, `Esc` (cancels an in-progress gesture first), or `Delete`/`Backspace` when no arrow is selected (Mac "delete" key; with an arrow selected it still deletes the arrow). The browser's own Esc/OS exit is mirrored from `fullscreenchange`; the element is released if the board unmounts.
- Everything is the same React tree: positions, drawings, selection, tool, orientation, snap and undo/redo history are untouched by entering/leaving. No new dependency, no change to the data model, storage or pointer routing.

### Files
`components/ui/useFullscreen.ts` (new), `components/board/BoardView.tsx`, `components/board/DrawingToolbar.tsx` (`compact`), `components/pitch/TacticalBoard.tsx` (`fill`), `components/board/Fullscreen.test.tsx` (new, 13 tests).

### Verification (this session)
| Check | Result |
|---|---|
| Unit/component (jsdom, native API stand-in + unsupported-API case) | 13 tests: native request on the stage element, same `<svg>` node, state/undo kept, drag + draw while fullscreen, exit button, browser-initiated exit, Esc, Delete rules, unmount cleanup, refusal → overlay, overlay Esc/scroll lock. Mutation-checked: delete-exits, Esc-exits, unmount cleanup, browser-exit mirroring, refusal fallback each make a test fail when removed |
| Real Chromium (Playwright, production build) | Native: `document.fullscreenElement` is the stage; stage = 1440×900; pitch 596 → 832 px tall; positions/arrows/undo history identical across enter/exit; **drag lands within 0.25 m of the release point** at 1440×900 and again after resizing to 1100×640 while fullscreen; svg aspect ratio preserved on resize; clean enter→exit round trip restores layout to the pixel; axe 0 violations; keyboard Tab reaches Exit with a visible outline; Backspace and Esc exit. Overlay fallback (Fullscreen API disabled) at 1440×900 and 390×844 (portrait): covers the viewport, no horizontal overflow, scroll locked/restored, drag accurate, axe 0 violations, Esc restores layout. No console errors/warnings. (An earlier script run had wrong expectations of mine and a mid-run finding that Esc did nothing in headless native mode; Esc is now also handled by our listener) |
| Commands | `npm run typecheck` pass, `npm run lint` pass, `npm test` **38 files; 502 passed, 2 skipped**, `npm run build` pass, `npx knip` prints nothing |

### Not verified / limitations
- **Safari, Firefox, iOS and a physical tablet were not tested** (only Chromium). The overlay fallback is the intended path on iPhone but was only exercised in Chromium with the API disabled.
- Chromium here was headless: real browsers show their own "press Esc to exit" toast and treat Esc themselves, which could not be observed. Our listener's Esc handling is additionally covered by tests.
- While fullscreen the selection/drawing editor is not available (exit to edit an arrow's note or type); arrows can still be erased with the Erase tool or deleted with `Delete` when selected.
- No zoom/pan (the app has none). On a phone the compact bar wraps to ~3 rows; portrait orientation fills the screen better there.

## Image-to-match import (added after Phase 7)

Creates a normal match from two starting-lineup images (Home / Away). Spec: "DizPitch: Build Image-to-Match Import from Scratch".

### What it does
Library → **Create from lineup images** (`/import`) → upload two PNG/JPEG graphics (preview, replace, remove, swap Home/Away) → **Read lineups** → editable review (team name, coach, formation, starters ↔ substitutes, shirt numbers, positions, pitch slots, add/remove, captain, opt-in "Tidy capitalisation", formation preview drawn by the real engine) → match details (competition, date, kick-off, venue, referee, AR1, AR2, fourth official) → confirmation checkbox → **Create match** → saved through the existing repository and opened in the normal workspace. Events/goals/assists/in-game substitutions are never extracted. The library button was renamed "Create match manually" (was "New match") next to the new one.

### Architecture
| Layer | Location | Notes |
|---|---|---|
| Pure domain | `src/domain/lineupImport/` | `parseFormation`, goal-edge orientation, starter→slot assignment, draft edit ops, validation, `buildMatchFromDrafts`. No React/DOM/storage. 28 tests incl. both reference graphics × all 10 formations × 4 orientations |
| Extraction service | `src/lineup-extraction/` | zod wire schema, prompt, env config, Gemini provider (`geminiProvider.ts`) behind a provider-neutral `LineupProvider` (`provider.ts`), request validation, output normalisation, browser image prep + route client |
| Server route | `src/app/api/extract-lineup/route.ts` | `GET` status, `POST {mediaType, data}`; `await connection()`; typed failure codes mapped to HTTP statuses |
| UI | `src/components/lineupImport/`, `routes/ImportRoute.tsx`, `app/import/page.tsx` | Flow component takes injectable `ImportDeps` (prepare / extract / status) for tests |

Design choices: server-side vision (broadcast graphics need layout + crest reading; in-browser OCR was rejected); official `@google/genai` SDK, `models.generateContent` with the image as `inlineData`, instructions as `systemInstruction`, `responseMimeType: 'application/json'` + `responseJsonSchema` derived from the zod schema (reduced to the documented subset: nullables as `type: [t, "null"]`, no `anyOf`), then re-validated with zod; thought parts ignored; safety blocks (`promptFeedback.blockReason`, SAFETY/PROHIBITED_CONTENT/BLOCKLIST/SPII/RECITATION) reported as refused, `MAX_TOKENS`/empty/non-JSON/wrong-shape replies as unreadable (retryable); SDK errors mapped to safe messages (no key or provider body shown); SDK retries 429/5xx up to 3 attempts, 120 s timeout. The stable `generateContent` surface was chosen over the SDK's newer Interactions API. Temperature is left at the model default and thinking is not configured.

**Provider switch (2026-10-11):** the feature was first built against Anthropic's Messages API and switched to Google Gemini at the user's request. `@anthropic-ai/sdk` was removed; `anthropicProvider.ts` became `geminiProvider.ts`; env vars changed from `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL` to `GEMINI_API_KEY`/`GEMINI_BASE_URL`; the domain layer, UI flow and route contract were unchanged. Everything below describes the Gemini implementation. Nothing from the earlier Anthropic run is carried over as evidence.

### Configuration, cost, privacy
| Item | Value |
|---|---|
| `GEMINI_API_KEY` | Required for automatic reading (create one at aistudio.google.com/apikey). Server only; never returned or logged. Put it in `.env.local` (git-ignored). Only this variable is read: `GOOGLE_API_KEY` is deliberately ignored |
| `LINEUP_EXTRACTION_MODEL` | Optional. Default `gemini-3.8-flash` (the model Google's docs recommended for new projects when this was written; **not confirmed by a live call**). A `-flash-lite` model is cheaper but was not evaluated |
| `GEMINI_BASE_URL` | Optional endpoint override (proxy / local stand-in). The key is sent to it, so only the server operator can set it |
| Runtime | Needs a running Node server (`npm run dev` / `npm start`); not static hosting |
| Cost | A few thousand tokens per image (image ≈ 925 KB after downscaling to a 1568 px long edge, tiled at 768 px; plus instructions, the JSON reply and any reasoning tokens). Dollar cost not measured: depends on the model's current pricing and your tier |
| Privacy | Image → DizPitch server → Google Gemini API, nothing else; not stored by DizPitch. **On a free (unpaid) key Google may use submitted content to improve its products and humans may review it; Google asks that sensitive/personal data not be sent to unpaid services. Paid-tier keys are not used that way** (Google's Gemini API terms, read 2026-10-11; not legal advice). The upload screen says so. Lineup graphics are public broadcast images, but the rule applies to anything uploaded |
| Region | Google's terms require paid services for API clients in the EEA, Switzerland and the UK; free-tier availability varies by country (a 400 `FAILED_PRECONDITION` is reported as "not available for this key or region") |
| Exposure | The endpoint spends the configured key's quota/credit for anyone who can reach the server. There is no auth (out of scope); do not expose a configured instance publicly |

### Tests and what they prove
| Suite | Proves | Does **not** prove |
|---|---|---|
| `domain/lineupImport/lineupImport.test.ts` (28) | Parsing, assignment, validation, match building, against hand-transcribed ground truth of the two supplied graphics | That any model reads the graphics correctly |
| `lineup-extraction/extraction.test.ts` (40) | Request validation, normalisation, request shape (inline image, system instruction, JSON mode, schema subset), error mapping, thought-part filtering, refusal/truncation/empty/non-JSON/wrong-shape replies, and the **real `@google/genai` SDK** against a local `generateContent` HTTP stand-in (key in header not URL, 429/403/400-key/404 mapping, retry of a transient 503, give-up after N attempts, unreachable endpoint) | Model quality; that the live API accepts the schema |
| `lineup-extraction/{client,imageFile}.test.ts` (17) | Route client failures, magic-byte checks, corrupt/oversized/empty/non-image files, re-encoding | Real canvas decoding (covered only in the browser run below) |
| `components/lineupImport/*.test.tsx` (16) | Upload/swap/replace, status states, failed read → retry/manual, review edits, blocking duplicates, confirmation gate, failed save, created match structure, open → edit → leave → reopen | Real network |
| `lineup-extraction/provider.integration.test.ts` | **Genuine** API reading of the supplied graphics vs ground truth | — it is **skipped** unless `GEMINI_API_KEY` and `LINEUP_FIXTURE_DIR` are set; **it has never been run** (no key in the development environment) |
| Real-browser run (Playwright/Chromium, production build, 42 checks) | Whole stack end to end: library → upload real PNGs (browser decode + downscale) → server route → real `@google/genai` SDK → **local stand-in for Gemini's `generateContent`** (asserted: `x-goog-api-key` header, `/v1beta/models/<model>:generateContent`, JSON mode + schema + system instruction sent) → review → create → board (22 markers, no `<image>`) → reload → edit → reopen; failure/retry/refusal/rejected-key/malformed-reply paths; not-configured screen; phone overflow; axe 0 violations on every new screen | That the real model extracts correctly: the stand-in returns the hand-transcribed truth chosen by image height, it does not read images |

**Extraction quality against the real Gemini API is therefore unverified, and so is whether the live API accepts the request exactly as sent** (model id, `responseJsonSchema` subset). To verify: run the integration test (command in `CLAUDE.md`) with a key.

### Bugs found by the verification of this feature (all fixed)
| Problem | Found by | Fix |
|---|---|---|
| A non-JSON or wrong-shape model reply was reported as HTTP 500 `unexpected` (found under the previous provider; the unit test only asserted `rejects.toBeDefined()`) | Browser run with a malformed stand-in reply | Replies are parsed and zod-validated inside the provider and reported as `unreadable` (retryable); tests assert the code and were mutation-checked, including on the Gemini provider (thought parts, safety stops, retry count) |
| A rejected request format (HTTP 400 about the schema/payload) would have been shown as "could not accept this image" | Review of the Gemini error mapping | Mapped to `unexpected` with a "probably a version mismatch" message (test) |
| `<g aria-label>` without a role on the board (`aria-prohibited-attr`; also affected manual matches with no drawings) | axe on the imported match's board | `role="group"` on the drawings and team marker groups |
| Pitch label for "MANOJ MD." was just "MD." | Screenshot review | `compactName` keeps the word before a trailing dotted abbreviation (+ test) |
| Review `ref` read during render (React Compiler lint) | `npm run lint` | Use state, not the ref |

### Known limitations
- Real-provider extraction untested (above). Gemini model ids change frequently; `gemini-3.8-flash` came from Google's docs and may be renamed or retired, in which case set `LINEUP_EXTRACTION_MODEL` (a 404 is reported with that hint). Prompt and assignment were designed from two graphics (4-3-3, 5-3-2) plus synthetic coverage of all 10 presets; other broadcaster layouts may need prompt/assignment work.
- Only DizPitch's 10 preset formations are supported; others (e.g. 4-1-4-1) are flagged "unsupported" and need a manual choice.
- Team names are often only in the crest; they are flagged "read from the badge only".
- ALL-CAPS names are kept as displayed; "Tidy capitalisation" is naïve (e.g. "BENGALURU FC" → "Bengaluru Fc", "DE BRUYNE" → "De Bruyne") and opt-in.
- Position codes shown on the graphic are mapped when they match DizPitch codes, otherwise left as "auto" with the raw text shown.
- PNG/JPEG only (WebP, HEIC, PDF rejected); 25 MB source limit; one image per team.
- The review screen is a long single page (two full squads); fine on phone widths but not compact.
- No authentication or rate limiting on `/api/extract-lineup`.
- New dependency: `@google/genai` ^2.28.0 (official SDK; used server-side only; replaces hand-written HTTP, retry and error handling). `npm install` prints an allow-scripts warning for its transitive `protobufjs` postinstall; the script is not run and nothing depends on it.

### Verification (commands run this session)
| Command | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass, no warnings |
| `npm test` | **37 files; 489 passed, 2 skipped** (the skipped are the real-provider tests) |
| `npm run build` | Pass; `/api/extract-lineup` dynamic, `/import` static |
| `npx knip` | Prints nothing |

## Final acceptance checklist (brief §8)

"Real browser" = Chromium driven by Playwright against `next start` on a clean profile (the scripts were ad hoc and are not kept in the repo; see decision A54). "Tests" = Vitest/RTL in jsdom.

| # | Requirement | Status | How verified |
|---|---|---|---|
| 1 | Create a match with team names, date, kickoff, venue, coaches and four officials | ✅ Verified | Real browser: typed every field through the UI; header shows "Mumbai City vs Kerala Blasters"; fields round-trip through JSON export. Tests: `MatchWorkspace.test.tsx` |
| 2 | Register up to 22 players/team; configure starting XI and substitutes | ✅ Verified | Real browser: 22 players added (11 + 11), 23rd blocked ("squad is full"), duplicate shirt number rejected with a message. Tests: `squad.test.ts`, `MatchWorkspace.test.tsx` |
| 3 | Apply a formation and drag players | ✅ Verified | Real browser: 3-5-2 switch relabelled the left back as LWB; mouse drag moved a marker and the position survived a reload; reset + undo/redo. **Touch drag verified with real touch events** (after a fix, see below) |
| 4 | Use tactical patterns; draw pass, shot, lofted and movement arrows | ✅ Verified | Real browser: pattern added arrows; all four arrow kinds drawn with the mouse (colours asserted: yellow, yellow, red, white-dashed) |
| 5 | LD shown on lofted arrows | ✅ Verified | Real browser: "LD" badge visible on the board and in the exported PNG |
| 6 | Undo, redo, edit and delete drawings | ✅ Verified | Real browser: note added, pass→lofted conversion, Delete key, undo restored. Tests: `history.test.ts`, `DrawingTools.test.tsx` |
| 7 | Start, pause, resume and correct the clock | ✅ Verified | Real browser: ran ~2 s, paused (frozen), resumed, corrected to 44:50; keeps counting across Board/Events/Setup; reload restores it. Tests: `clock.test.ts`, `Autosave.test.tsx` |
| 8 | Record goals, scorers, optional assists, own goals | ✅ Verified | Real browser: goal with scorer + assist → 1–0; own goal by an away player → 2–0 for home |
| 9 | Record and correct substitutions | ✅ Verified | Real browser: sub recorded, board + bench updated; historical sub edited, dependent sub flagged invalid with no duplicate players |
| 10 | Track cards and other events | ✅ Verified | Real browser: yellow, second yellow (sent off), red; note; timeline filter |
| 11 | Score, lineup and timeline stay consistent after edits/deletions | ✅ Verified | Real browser: deleting a goal moved the score 2–0 → 1–0; corrected substitution left 11 distinct players. Tests: `events.test.ts` |
| 12 | Save and reopen matches | ✅ Verified | Real browser: reload restored score, 11 events, board and clock; library lists, renames, duplicates, deletes |
| 13 | Import and export complete match data | ✅ Verified | Real browser: exported JSON downloaded; original deleted; file imported through the file picker; score and all events restored. Malformed file rejected with path-level messages |
| 14 | Export the tactical board as PNG | ✅ Verified | Real browser: downloaded a valid 2000×1345 PNG (~400 KB); inspected visually: pitch, markers, labels, arrows, LD badge, empty positions, no handles |
| 15 | Use the interface at desktop and tablet sizes | ✅ Verified | Real browser at 1440×900, 1024×768, 820×1180 and 390×844 (phone): screenshots reviewed, **no horizontal overflow** on library/board/events/setup, **0 axe violations (WCAG 2 A/AA)** |
| 16 | Pass build, type-checking and automated tests | ✅ Verified | `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` (385 tests) all pass; `npx knip` reports nothing |

## Real-browser findings fixed in Phase 7

These are problems the 377 jsdom tests could not see. Each has a fix and a regression test where jsdom can express it.

| # | Problem | Root cause | Fix | Guard |
|---|---|---|---|---|
| 1 | **Stale hidden routes could overwrite edits.** Rename a match in the library, reopen it → old name and old view; any edit then autosaved the old name over the rename. The library also showed stale titles after in-workspace edits | Cache Components keeps previous routes mounted but hidden with their React state | `ReloadOnReveal` wrapper remounts a route when it is revealed (reads at reveal time, before paint) | `ReloadOnReveal.test.tsx` reproduces the bug with React `<Activity>` and the fix; verified in browser |
| 2 | **Touch dragging a player did nothing** (the pointer stream ended in `pointercancel`) | Browsers ignore `touch-action` on SVG child elements; the page pan won | Native non-passive `touchstart` guard on draggable targets in Select mode; open grass still scrolls | Contract tests in `DrawingTools.test.tsx` (mutation-checked); verified with CDP touch events |
| 3 | Scoreboard on tablet/phone: team names crushed to "M…", score wrapped onto two lines | Single flex row with `flex-1 min-w-0` | Team row is full-width below `lg`; score is `whitespace-nowrap` | Visual (screenshots) |
| 4 | Phone: landscape pitch tiny and unreadable; pitch started ~590 px down | Orientation always landscape; many stacked control rows; sticky chrome | Phones default to portrait; icon-only secondary buttons; header/scoreboard sticky only from `md`; marker text enlarged | Visual |
| 5 | Pitch cut off at 900 px height | `max-h` ignored the sticky chrome | `max-h-[max(24rem,calc(100vh-19rem))]` | Visual |
| 6 | Contrast failures (serious, every page) | White on `emerald-600` (3.8:1); `text-zinc-500` helper text | `emerald-700` / `zinc-400` | axe: 0 violations at 4 sizes |
| 7 | On-pitch label "Sub 0" → "0", "Kevin De Bruyne" → "Bruyne" | Last-word heuristic | Particle-aware, never number-only | `labels.test.ts` |
| 8 | Toolbar targets too small for touch | 32 px buttons | `pointer-coarse:` variants (40–44 px) | Visual |
| 9 | `matchMedia` missing would throw (jsdom / unusual environments) | Unguarded call | Guarded | Test suite |

Also fixed just before this phase (after a dev-server report): Next's dev-only instant-navigation warning (`AppProviders` moved below the page segment).

## What works (summary)

- **Library `/`:** create, open, rename, duplicate (new ids, clock paused), export JSON, import JSON (validated, never overwrites), delete with confirmation; unreadable entries isolated; storage-blocked notice.
- **Workspace `/match/[id]`:** Board / Events / Setup, always-visible scoreboard + clock, autosave with status (Saved / Saving / Not saved + Retry / session only), JSON export, back to library.
- **Board:** SVG pitch (landscape/portrait), 10 formations, saved arrangements, 12 patterns, drag + keyboard + touch, snap, drawing tools with LD, selection/editing, undo/redo (100 steps), bench panel, PNG export.
- **Match events:** goals (types, assists, own goals), substitutions, cards, notes, auto period markers; derived score and lineups; corrections with dependants flagged; timeline with filters and edit/delete.
- **Persistence:** versioned documents (`schemaVersion`, now 2; migration `1 → 2` adds `replays`), zod validation, `localStorage` with in-memory fallback.

## Verification matrix (commands actually run in Phase 7)

| Command / check | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | Pass, no warnings |
| `npm test` | **30 files, 385 tests pass** (+8 vs Phase 6: label particles ×2, ReloadOnReveal ×4, touch contract ×2) |
| `npm run build` | Pass; `/` static, `/match/[id]` partially prerendered |
| `npx knip` (dead code / unused exports / dependencies) | Initially 30 unused exports + 8 unused types (3 genuinely dead: `pitchClient`, `playerShortLabel`, `makePlayer`); now empty. No unused dependencies or files |
| Real-browser acceptance flow (23 steps) | All pass; no console errors/warnings |
| Real-browser view matrix, 4 viewports × (library, board, events, event form, setup ×3) | No overflow; 0 axe violations |
| Real touch (CDP) + keyboard suite (9 checks) | All pass: touch drag, arrow drawing without moving the player, page scroll over grass; Tab order, visible focus on every tabbable control, marker nudge, shortcuts ignored while typing, drawings list, confirmation focus |
| Mutation check | Touch listener removed → test fails (restored) |

## Not verified / limitations

- **Safari/iOS and Firefox were not tested**: only Chromium (with touch emulation). Worth checking in Safari: the non-passive `touchstart` guard, PNG export via `Image` + canvas, and `localStorage` in private mode.
- **Real devices:** touch was emulated through Chromium's input pipeline, not a physical tablet.
- **Screen-reader behaviour** was not tested (axe + keyboard checks only).
- **Two tabs editing the same match:** last write wins (no cross-tab coordination).
- **Scale:** the library validates every stored match when it loads; not measured with hundreds of matches. `localStorage` is ~5 MB per origin.
- **Product limitations:** no penalty shoot-outs/missed penalties (use notes); no substitution-count limit; extra-time halves fixed at 15 min; side-specific patterns use the left flank; saved arrangements are per match; undo history is session-only; a damaged saved match can only be deleted, not rescued; unknown future properties are dropped on import; long on-pitch names are truncated to 12 characters; PNG export covers the board only.
- **Housekeeping:** the `unrs-resolver` allow-scripts warning and dev-tooling `npm audit` advisories (ESLint chain only; `--force` would downgrade `eslint-config-next`) are unchanged. Phases 4–7 are uncommitted.

## Files changed in Phase 7

| Area | Files |
|---|---|
| New | `README.md`, `src/components/ui/ReloadOnReveal.tsx` (+ test) |
| Behaviour | `components/routes/{LibraryRoute,MatchRoute}.tsx` (ReloadOnReveal; AppProviders below the page), `app/layout.tsx`, `pitch/TacticalBoard.tsx` (touch guard, sizing), `pitch/{PlayerMarker,pitchTheme,labels}.ts(x)` (label sizes, particle-aware names), `board/BoardView.tsx` (portrait on phones, compact controls), `board/DrawingToolbar.tsx`, `match/Scoreboard.tsx`, `layout/AppHeader.tsx`, `persistence/ExportJsonButton.tsx`, `MatchWorkspace.tsx` (sticky from `md`), `ui/Button.tsx` |
| Style tokens | `emerald-600→700` (primary/active), `text-zinc-500→400` across components |
| Cleanup | 3 dead functions removed; 35 over-exports un-exported; stray imports removed |
| Tests | `ui/ReloadOnReveal.test.tsx` (new), `board/DrawingTools.test.tsx` (+2), `pitch/labels.test.ts` (+2) |
| Docs | `CLAUDE.md` (state, touch + responsive notes, hidden-route and accessibility sections), `docs/BUILD_PLAN.md` (A51–A54, Phase 7 DONE), this file |

## Dependencies

No dependency was added to the project in Phase 7 (Playwright, axe-core and Chromium were installed only in the session scratchpad). None was removed because none was unused (`knip`).

After Phase 7: **`@google/genai` ^2.28.0** was added for the image-import feature (server-side Gemini vision call with JSON-schema output; replaces hand-written HTTP, retry and error handling). An earlier `@anthropic-ai/sdk` dependency from the first version of this feature was removed. `knip` reports no unused dependency.

The tactical-replay feature added **no dependency**: it reuses `@google/genai` (Files API + `generateContent`), `zod`, and the existing pitch components. FFmpeg was deliberately not introduced.

Computer-vision tracking added **no npm dependency** (the web side reuses `zod`, `lucide-react` and the pitch components). Its Python dependencies live only in `cv-service/pyproject.toml` + `uv.lock`: fastapi, uvicorn[standard], python-multipart, pydantic, numpy, opencv-python, torch, ultralytics (**AGPL-3.0**), supervision (`< 0.31`), trackers, gdown; dev: pytest, httpx. Model weights are downloaded by `cv-service/scripts/download_models.sh` and git-ignored. Playwright WebKit was installed only in the session scratchpad for the browser check.

Team presets added **one dev dependency: `tsx` (^4.23.15)**, used only by `npm run presets` so the maintenance CLI can import the same TypeScript schema and parsers as the app. No runtime dependency was added.

## Suggested follow-ups (not required)

1. **Commit** Phases 4–7.
2. Keep an end-to-end suite in the repo (Playwright). The ad-hoc scripts caught the two most serious defects (stale hidden routes, touch drag) that unit tests could not; adding it means adding a dev dependency (see A15/A54).
3. Test Safari/iOS and a physical tablet.
4. Penalty shoot-outs, per-competition substitution limits, library-wide saved arrangements, cross-tab storage events, an "export raw data" rescue for damaged entries.
