# DizPitch

A football tactical board and match-analysis app that runs in your browser. No account: your matches are stored locally and can be exported as JSON or as a PNG of the board. Optional features use a server: reading lineup images and sketching clips (Google Gemini), and tracking players in video (a local computer-vision service).

## What you can do

- **Set up a match:** competition, venue, date, kick-off, duration, status, notes, four match officials, both teams' coaches and squads (up to 22 players per team; starting XI and substitutes).
- **Use the tactical board:** drag players on an SVG pitch (landscape or portrait), switch between 10 formations, save your own arrangements, apply 12 tactical patterns (high press, build-up, overlap, set piece, …).
- **Draw:** yellow passes, yellow lofted passes labelled **LD**, red shots, dashed runs, freehand notes; select, edit, annotate, delete; full undo/redo.
- **Run the match:** a real match clock (start, pause, resume, correct), periods and stoppage time (`45+2'`), goals with scorer/assist/own goals, substitutions, cards and notes on a timeline. The score and the on-pitch lineup are always derived from the events, so editing or deleting an old event keeps everything consistent.
- **Start from ISL teams:** choose a home and an away club from the Indian Super League 2026-27 presets (coach, full squad, official crests and headshots), then pick the XI and bench exactly as usual. Needs a one-off data import; see [Team presets](#team-presets-isl-2026-27).
- **Start from lineup images:** upload the Home and Away starting-lineup graphics (PNG/JPEG), review and correct what was read, add the match details, and confirm. See [Creating a match from lineup images](#creating-a-match-from-lineup-images).
- **Go fullscreen:** show only the pitch and players, edge to edge, with the drawing tools in a slim bar. `Esc` (or `Delete`/`Backspace` with nothing selected) exits.
- **Track players and the ball in a video (computer vision):** a local detection-and-tracking service processes a segment of your match video frame by frame; you review it beside the original video, say which kit is which team, link players to your squad, correct mistakes, and save a tracked replay. See [Tracking a video](#tracking-a-video-computer-vision).
- **Sketch a play from a video clip with AI:** upload a short clip, have it analysed by a generative AI model, correct the result, and save an animated tactical replay (play, pause, reset, replay, scrub, 0.25–2×). Positions are estimates, and you can also annotate replays by hand. See [Tactical replays](#sketching-a-play-from-a-video-clip-ai).
- **Keep your work:** autosaved in the browser, a match library (open, rename, duplicate, delete), JSON export/import, PNG export of the board.

## Run it

Requires Node.js 20.9 or newer.

```bash
npm install
npm run dev        # http://localhost:3000
```

Other commands:

```bash
npm run build      # production build
npm start          # serve the production build
npm test           # unit + component tests (Vitest)
npm run typecheck  # next typegen && tsc --noEmit
npm run lint       # ESLint
```

## Team presets (ISL 2026-27)

Library → **Create from ISL teams** (or *Create match* → ISL presets). The 13 clubs, head coaches and squads are read from the league's public website by a maintenance command and served as static files from `public/presets/`; creating a match **copies** the two teams into it, so editing the match never changes the presets and refreshing the presets never changes existing matches. A club's ~30 players go to a **squad pool** next to the matchday squad; nothing is picked for you.

```bash
npm run presets -- fetch --profiles            # preview: what would change, gaps, errors (writes nothing)
npm run presets -- fetch --profiles --apply    # write public/presets/** and docs/presets/*-import-report.md
npm run presets -- import --file squads.csv --season 2026-27 --apply   # supply data by hand (CSV or JSON)
```

The importer is polite (robots.txt, one request per second, no API calls, stops if refused). Logos and headshots are copyrighted: they are only linked, never downloaded, and every picture has a fallback; set `NEXT_PUBLIC_PRESET_IMAGES=off` to never contact the image host. Data sources, the data model, refresh and manual-import steps, known gaps and how to add a season: [`docs/TEAM_PRESETS.md`](docs/TEAM_PRESETS.md).

## Creating a match from lineup images

Library → **Create from lineup images**. Automatic reading needs a Google Gemini API key; without one you can still enter both lineups by hand in the same review screen.

1. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey).
2. Put it in `.env.local` in the project folder and restart the server:

   ```bash
   GEMINI_API_KEY=your-key
   # optional:
   LINEUP_EXTRACTION_MODEL=gemini-3.8-flash   # default; a "-flash-lite" model is cheaper
   ```

3. Upload the Home and Away images, press **Read lineups**, check the review screen, tick the confirmation and create the match.

**Privacy and cost.** The key is only read by the DizPitch *server* and is never sent to the browser. Each image is sent from your DizPitch server to Google's Gemini API to be read, and is not stored by DizPitch. **On a free (unpaid) Gemini key, Google may use what you send to improve its products and people may review it; paid-tier keys are not used that way** (see Google's Gemini API terms). A read is a few thousand tokens per image; check Google's pricing for your model. **Anyone who can reach your DizPitch server can spend your key's quota through this endpoint**, so do not expose a configured server to the public internet. The feature needs a running server (`npm run dev` / `npm start`), not a static export.

Only team names, coaches, formations, starters and substitutes are read; goals, assists and substitutions are not.

> **Video analysis is switched off by default.** Both video features below (computer-vision tracking and the AI clip sketch) only run when `NEXT_PUBLIC_VIDEO_ANALYSIS=on` is set (for example in `.env.local`) at build/start time. Without it the buttons show "Coming Soon" and the API routes refuse requests, which is how the hosted deployment runs.

## Tracking a video (computer vision)

Match → **Replays** → **Track a video**. This needs the separate local service in [`cv-service/`](cv-service/README.md) (Python, run with `uv`). It uses dedicated football detection models and a tracker; no AI chat model or cloud service is involved, and the video never leaves your machine.

```bash
# terminal 1 (once: install uv from https://docs.astral.sh/uv/)
cd cv-service
uv sync
./scripts/download_models.sh          # ~420 MB of model weights (read the licence notes first)
uv run uvicorn app.main:app --host 127.0.0.1 --port 8001

# terminal 2
npm run dev                           # DizPitch finds the service at CV_SERVICE_URL (default http://127.0.0.1:8001)
```

1. Choose the video, then the segment to track (up to 15 s; **Find wide shots** suggests steady wide-camera segments). Press **Track this segment** and watch the real progress (upload, then frame by frame; about 0.5 s per frame on an Apple M5).
2. Review: the original video with boxes, tracker numbers and the projected pitch lines sits beside the pitch. Say which colour group is home and away, link tracks to squad players, hide false detections, join fragments of one player, mark wrong observations, place a missed player by hand, and check the calibration (reject it or click at least 4 pitch landmarks if the lines do not match the video).
3. **Save tracked replay**. It plays from the stored data (play, pause, reset, replay, scrub, frame step, 0.25–2×, ball trail, ids on/off) without the video or the service; choose the video file again to see it alongside.

**What it is, and is not.** Tracker numbers are not shirt numbers and can jump between players when they cross; IDs restart at camera cuts; the ball is often missed at low resolution; automatic pitch calibration is unverified and can be wrong on broadcast footage. Close-ups and replays cannot be placed on the pitch. Full details, measured results and **licence terms that need your decision (the detection models are AGPL-3.0)** are in [`cv-service/README.md`](cv-service/README.md).

## Sketching a play from a video clip (AI)

Match → **Replays** → **AI sketch from a clip**. The same `GEMINI_API_KEY` as the lineup import is needed for automatic analysis; without it you can still **Create replay by hand**.

```bash
GEMINI_API_KEY=your-key
# optional:
GEMINI_MODEL=gemini-3.8-flash   # default
VIDEO_MAX_MB=50                 # largest clip accepted (default 50)
VIDEO_MAX_SECONDS=60            # longest clip accepted (default 60)
VIDEO_SAMPLING_FPS=5            # frames per second shown to the model, 0–24 (default 5; Gemini's own default is 1)
```

1. Choose a short MP4, MOV or WebM clip (a single pass, shot or set piece works best). It is previewed first; nothing is sent until you press **Analyse this clip**.
2. The result opens in an editor: event type and description, timestamps, which team is attacking, players (leave anyone unidentified), keyframes, arrows and labels. Drag players or the ball on the pitch at the current time.
3. **Save replay**. Saved replays play from their stored data, so you can replay as often as you like without uploading or analysing again.

**What it is, and is not.** A replay is an *estimated* tactical reconstruction. A broadcast camera is not a top-down view, so positions are approximate (drawn dashed until you place them), and the AI may not identify the attacking team, players or exact outcome. Check everything before relying on it.

**Privacy and cost.** The clip goes from your DizPitch server to Google's Gemini API, is analysed with **one** request, and is then deleted from Google's file store; DizPitch does not keep the video, only the derived replay (clip name, size, length and model are recorded). Nothing is retried automatically, because each analysis uses API quota or credit; asking again is always your choice. On a free (unpaid) Gemini key Google may use what you send to improve its products and people may review it; a paid key is not used that way. Anyone who can reach a configured server can spend your key's quota, so do not expose it publicly.

## Your data

Matches live in your browser's `localStorage` (about 5 MB per site; a full match is well under 100 KB, but each tracked video segment adds roughly 230 KB per 8 s, so the browser holds about twenty such segments in total). Clearing site data deletes them, and they are not shared between browsers or devices. **Export JSON** from the library or the match header to back a match up or move it. If browser storage is blocked (some private windows), DizPitch tells you and keeps working for the session only.

## Keyboard and touch

- Tools: `V` select, `P` pass, `L` lofted, `S` shot, `M` run, `F` freehand, `E` erase. `Ctrl/⌘+Z` undo, `Ctrl/⌘+Shift+Z` redo, `Delete` removes the selected drawing, `Esc` deselects (or exits fullscreen).
- Focus a player and use the arrow keys to nudge (1 m, `Shift` for 5 m).
- On touch devices, drag players and arrows directly; swipe over open grass to scroll. Drawing tools take over the pitch while active.

## Project documentation

- [`CLAUDE.md`](CLAUDE.md): architecture, invariants and rules for contributors (and AI assistants).
- [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md): phases, decisions and acceptance criteria.
- [`docs/TEAM_PRESETS.md`](docs/TEAM_PRESETS.md): ISL team presets: data model, sources, import/refresh, images and known gaps.
- [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md): current state, verification results and known limitations.
