# DizPitch computer-vision service

A local Python service (FastAPI) that turns a short segment of football video into **tracking data** for DizPitch:
players, goalkeepers, referees and the ball are detected by dedicated detection models, tracked frame by frame,
and placed on the pitch through a homography estimated from detected pitch landmarks (or from landmarks the user
clicks). No LLM, multimodal generative model or cloud vision API is used anywhere in this pipeline.

The web app talks to it through its own server (`/api/cv/...` → `CV_SERVICE_URL`), so the browser needs no CORS
setup and nothing is sent anywhere except this service on your machine.

> **Read [Licences](#licences-decisions-for-you) before using this for anything beyond private evaluation.** The
> detection weights are Ultralytics YOLOv8 models, which are AGPL-3.0 by default.

## What it does

| Step | How | Output |
|---|---|---|
| Validate | Magic bytes (MP4/MOV/WebM/MKV), size, duration, fps, dimensions, segment length | Readable error codes (`file_too_large`, `video_too_long`, `segment_too_long`, …) |
| Decode | OpenCV (its wheel bundles FFmpeg; no system FFmpeg needed). Every frame of the segment; timestamps from the container (`CAP_PROP_POS_MSEC`), not frame-count arithmetic | `frames.tMs` (relative to the segment start) and `frames.sourceIndex` |
| Detect | Roboflow *football-player-detection* (YOLOv8, classes ball/goalkeeper/player/referee) + *football-ball-detection* for the ball, run with Ultralytics | boxes, class, confidence |
| Track | ByteTrack (Roboflow `trackers`) in camera-motion-compensated coordinates (sparse optical flow + RANSAC, players masked); reset at camera cuts; short fragments stitched only when gap ≤ 25 frames, same shot, compatible class, similar shirt colour and plausible motion | track ids (`trackerId` = tracker number, **not** a shirt number), `mergedFrom` |
| Ball | Conservative gating; gaps ≤ 6 frames inside one shot bridged in shot-stable coordinates and marked `interpolated` (confidence `null`); longer gaps stay empty | ball track |
| Calibrate | Roboflow *football-pitch-detection* (YOLOv8-pose, 32 landmarks) → RANSAC homography pooled over ±12 frames via camera motion, accepted only with ≥ 6 landmarks and a leave-one-landmark-out error ≤ 0.8 m; carried up to 50 frames within the shot by camera motion if the frame's own landmarks agree within 1.5 m. **Labelled "unverified"** (see Limitations) | per-frame homography image → metres, source (`keypoints`/`propagated`/`none`), error |
| Project | Foot point = bottom centre of the box → metres → DizPitch 0–100 (`x` 0 = left goal line, `y` 0 = top/far touchline). Points > 3 m outside the pitch are dropped; uncalibrated frames give `pitch: null` (never pseudo-coordinates) | `observations.pitch`; image coordinates kept in `bbox`/`foot` |
| Teams | Median torso colour (grass removed, Lab) per track, k-means k = 2, margin < 0.15 → `unknown`; fewer than 4 tracks → all unknown | colour groups `A`/`B` — **which is home/away is the user's decision in DizPitch**; squad players are only ever linked by hand |

Results follow the versioned schema in [`schema/tracking-result.v1.schema.json`](schema/tracking-result.v1.schema.json)
(`schemaVersion: 1`, generated from `app/schemas.py`; regenerate with `uv run python scripts/export_schema.py`).
JSON is compact (no base64, no images); an 8 s / 200-frame segment is about 220 KB (about 230 KB once stored in a DizPitch match).

## 1. Install

Requirements: macOS or Linux, about 3 GB free disk (PyTorch + weights), Python 3.11–3.12 (uv installs it for you).
A GPU is optional: Apple Silicon uses MPS, NVIDIA uses CUDA, otherwise CPU (much slower).

```bash
# once: install uv (https://docs.astral.sh/uv/)
curl -LsSf https://astral.sh/uv/install.sh | sh        # or: brew install uv

cd cv-service
uv sync                     # creates .venv with Python 3.12 and the pinned dependencies (uv.lock)
```

## 2. Download the model weights (≈ 420 MB, not in git)

```bash
cd cv-service
./scripts/download_models.sh     # → cv-service/models/*.pt, prints SHA-256 sums
```

| File | Model | Source | SHA-256 |
|---|---|---|---|
| `football-player-detection.pt` (≈ 137 MB) | YOLOv8 detector, classes ball, goalkeeper, player, referee; run at 1280 px | Roboflow [sports](https://github.com/roboflow/sports) (`examples/soccer/setup.sh`, Google Drive id `17PXFNlx-jI7VjVo_vQnB1sONjRyvoB-q`) | `75b09c377fbf9d0791d23f6cfb689f5aed6eaa43a6818bd1fb884cf7507fffaf` |
| `football-ball-detection.pt` (≈ 137 MB) | YOLOv8 ball detector; run at 1280 px | same repo, id `1isw4wx-MK9h9LMr36VvIWlJD6ppUvw7V` | `678fbad05134f19c5094cb8d273812ec9c6691228180d46832551ecf99ed2912` |
| `football-pitch-detection.pt` (≈ 140 MB) | YOLOv8-pose, 32 pitch landmarks; run at 640 px | same repo, id `1Ma5Kt86tgpdjCTKfum79YMgNnSjcoOyf` | `28f68f7c4056d6d9b137efd2e7ab5f3c494039380c63831649126ced25628b36` |

Compare the printed sums with the table. `.pt` files are Python pickles: only load files from this source.
`models/`, `*.pt`, `.venv/` and `cv-output/` are git-ignored.

## 3. Configure (optional)

Everything has a default; set environment variables only to change them.

| Variable | Default | Meaning |
|---|---|---|
| `CV_DEVICE` | `auto` | `auto` (CUDA → MPS → CPU), `mps`, `cuda`, `cpu` |
| `CV_MODELS_DIR` | `models` | where the `.pt` files are |
| `CV_MAX_UPLOAD_MB` / `CV_MAX_SOURCE_SECONDS` / `CV_MAX_SEGMENT_SECONDS` | 300 / 1800 / 15 | upload and processing bounds |
| `CV_FRAME_STRIDE` | 1 | 1 = every frame (default; profile before raising it) |
| `CV_PERSON_CONF` / `CV_BALL_CONF` / `CV_KEYPOINT_CONF` | 0.3 / 0.2 / 0.5 | detection thresholds |
| `CV_TRACK_BUFFER` / `CV_STITCH_MAX_GAP_FRAMES` | 30 / 25 | how long lost tracks are kept / longest gap stitched |
| `CV_BALL_MAX_GAP_FRAMES` | 6 | longest ball gap bridged (marked interpolated) |
| `CV_CALIB_MAX_ERROR_M` / `CV_CALIB_MIN_INLIERS` / `CV_CALIB_PROPAGATE_FRAMES` | 0.8 / 6 / 50 | calibration acceptance |
| `CV_WORK_DIR` | system temp `dizpitch-cv` | uploads (random names, deleted when the job ends) |
| `CV_RESULT_TTL_SECONDS` | 3600 | how long finished results are kept in memory |
| `CV_CORS_ORIGINS` | empty | only needed if a browser calls the service directly (DizPitch uses its proxy) |

On the DizPitch side: `CV_SERVICE_URL` (default `http://127.0.0.1:8001`) in `.env.local` or the environment.

## 4. Start the service (terminal 1)

```bash
cd cv-service
uv run uvicorn app.main:app --host 127.0.0.1 --port 8001
curl http://127.0.0.1:8001/health      # {"status":"ok","device":"mps",...}; "models_missing" lists absent files
```

Endpoints: `GET /health`, `POST /api/analyze` (multipart `video`, `startSeconds`, `durationSeconds` → `202 {jobId}`),
`POST /api/scan` (multipart `video` → shot list + suggested wide segments), `GET /api/jobs/{id}` (state + real progress),
`GET /api/results/{id}`, `DELETE /api/jobs/{id}` (cancel/forget). One job runs at a time; uploads are stored under
random names and deleted when the job finishes, fails or is cancelled.

## 5. Start DizPitch (terminal 2)

```bash
# repository root
npm install
npm run dev                            # http://localhost:3000 (uses CV_SERVICE_URL, default http://127.0.0.1:8001)
# or production: npm run build && npm start
```

## 6. Track the test clip

In the browser: open (or create) a match → **Replays** → **Track a video** → choose `test_clip.mp4` → optionally
**Find wide shots in the video** → set **Start 147.2**, **Length 8** → **Track this segment**. Progress shows the
upload, then the service's frame counter. Then review: map colour groups to home/away (Teams), check the projected
pitch lines on the video (Calibration — reject or calibrate by hand if they are off), link squad players / hide false
detections / join fragments / correct positions (Tracks), and **Save tracked replay**. The saved replay plays from
the stored data after a reload; choose the video file again to see it beside the pitch.

From the command line (same pipeline, plus diagnostics):

```bash
cd cv-service
uv run python -m app.cli scan ../test_clip.mp4                                   # shot list + suggested segments (~1 min)
uv run python -m app.cli analyze ../test_clip.mp4 --start 147.2 --duration 8 --out ../cv-output/seg147
```

`cv-output/seg147/` then contains `result.json` (the schema above), `diagnostic.mp4` (each frame with boxes coloured
by team, tracker ids, ball, projected pitch lines and the calibration status, next to a top-down mini-map of the
mapped positions), `frames/frame_NNNN.jpg` (one per second) and `summary.txt` (timings, counts, warnings).

## 7. Tests

```bash
cd cv-service
uv run pytest -m "not integration"     # synthetic video with known geometry, API, schema (no weights needed)
uv run pytest -m integration -s        # real weights on the real clip (skipped if either is missing)
CV_TEST_CLIP=/path/clip.mp4 CV_TEST_START=10 CV_TEST_DURATION=2 uv run pytest -m integration -s
```

The synthetic tests render a panning pitch with known players and a known homography, and use fake detectors that
report the ground truth: they prove the geometry, tracking plumbing, gap rules and schema, **not** detection quality.
The integration test runs the real models on the real clip and checks structural sanity only.

## Measured on the test clip (Apple M5, MPS, 16 GB)

`test_clip.mp4` is **not a short clip**: it is a 5 min 45 s (344.84 s, 8621 frames, 25 fps, 854×480, H.264) ISL
highlights package (Inter Kashi vs Kerala Blasters FC) with an intro, lineup graphics, wide shots, close-ups, replays,
celebrations and fast pans — 66 camera cuts. Only parts of it are suitable for tracking; use the scanner.

- Speed: ≈ 0.45–0.55 s per frame (player model ≈ 170 ms, ball model ≈ 170 ms, pitch model ≈ 50 ms). An 8 s segment
  (200 frames) takes ≈ 90–110 s. Every frame is processed; no frame skipping was needed for correctness, and
  `CV_FRAME_STRIDE` exists if you accept the loss.
- Segment 147.2–155.2 s: ≈ 16 people per frame, very fast camera pans (median shift 35 px/frame at the 90th
  percentile). 42 person tracks after motion compensation + GIoU association + stitching (66 without motion
  compensation), median length 47 frames; one camera cut (→ close-up). Calibration on 77/200 frames, median
  self-consistency error 0.85 m. Ball detected on 96/200 frames, 16 short gaps interpolated.
- Segment 191–199 s (fast pan to a behind-the-goal view through the net): heavy fragmentation (median track 10
  frames); this kind of shot is not usable.

## Limitations (observed, not hypothetical)

- **Automatic calibration can be confidently wrong.** The pitch-keypoint model was trained on Bundesliga
  broadcast footage; on this lower-angle 480p ISL broadcast it sometimes predicts a self-consistent but wrong pitch
  (e.g. a centre circle about a third of the real size) that passes RANSAC and leave-one-out checks. A white-line
  support score was tried and did not separate good from bad fits at 480p, so it was not used. Automatic calibration
  is therefore labelled *unverified*; DizPitch draws the projected lines over the video so you can check them,
  lets you reject the automatic result, and supports manual landmark calibration per shot (carried through pans by
  camera motion).
- **Identity.** Tracker ids switch when players cross or leave the frame, and restart at every camera cut. Stitching
  only joins clear cases. ids are never shirt numbers; DizPitch never links squad players automatically.
- **Ball.** Small and often blurred at 480p: detected on roughly half the frames in wide shots; false positives
  occur on close-ups. Ball pitch positions assume the ball is on the ground (wrong for lofted balls).
- **Shots.** Close-ups, replays and behind-the-goal shots have no usable pitch geometry; their frames get
  `pitch: null`. The detector also fails on close-ups (players are far larger than in its training footage): it
  misses them or boxes a boot or an arm.
- **Teams.** Colour clustering confuses kits with similar colours, goalkeepers and referees; low-margin tracks are
  `unknown`.
- **Speed.** Not real time on a laptop GPU; CPU-only is several times slower.

If local processing fails, the service reports the error. It never falls back to an LLM or a cloud API.

## Licences (decisions for you)

| Component | Licence | Notes |
|---|---|---|
| Ultralytics (`ultralytics` 8.4.x, runs the models) | **AGPL-3.0** | Ultralytics states that "all Ultralytics YOLO trained models fall under the AGPL-3.0 License by default". Using it in a network service obliges you to offer the complete corresponding source of that service under AGPL-3.0, or to buy an Ultralytics Enterprise licence. |
| The three `.pt` weights (Roboflow sports) | **AGPL-3.0** (YOLOv8-trained) | Roboflow's repo is MIT, but the weights were trained with Ultralytics YOLOv8, so treat them as AGPL-3.0 unless Roboflow/Ultralytics confirm otherwise. |
| Training data of the weights | **unverified** | Roboflow Universe dataset pages (football-players-detection, football-ball-detection, football-field-detection) could not be checked (HTTP 403). The footage reportedly comes from the Kaggle *DFL – Bundesliga Data Shootout* competition, whose rules may restrict use of the data and derived models. |
| Roboflow `sports` code (keypoint layout reference) | MIT | |
| `trackers` (ByteTrack) | Apache-2.0 | |
| `supervision` | MIT | pinned `< 0.31` (its own ByteTrack was removed in 0.31) |
| OpenCV (`opencv-python`) | Apache-2.0 | the wheel bundles FFmpeg libraries under LGPL |
| PyTorch | BSD-3-Clause | |
| FastAPI / Uvicorn / Pydantic / NumPy | MIT / BSD-3 / MIT / BSD-3 | |
| SoccerNet `sn-gamestate` (evaluated, **not used**) | GPL-3.0 | also needs Python 3.9, torch 1.13 and CUDA-era mmcv, and downloads a large dataset |

**Not decided for you:** whether AGPL-3.0 is acceptable for how DizPitch will be distributed or hosted, and whether
the training-data terms allow your use. For anything commercial, either obtain an Ultralytics Enterprise licence
(and confirm the dataset terms) or replace the detectors with models whose weights and data you can use (e.g.
train an Apache-2.0 detector such as RT-DETR from a permissively licensed implementation on data you own). The
service isolates the models behind `app/detector.py`, so swapping them does not touch tracking, calibration or
DizPitch.

## Troubleshooting

| Symptom | Fix |
|---|---|
| DizPitch says "The computer-vision service is not running at …" | Start it (step 4) or set `CV_SERVICE_URL` for the DizPitch server and restart it. |
| `models_missing` / HTTP 503 | Run `./scripts/download_models.sh`; check `CV_MODELS_DIR`. Google Drive sometimes rate-limits gdown — retry later. |
| `unsupported_format` (415) | Not MP4/MOV/WebM/MKV by content; re-encode the file. |
| `segment_too_long` / `video_too_long` / `file_too_large` | Shorten the segment (≤ 15 s), or raise the `CV_MAX_*` limits. |
| Very slow | Check `/health` → `device`. On a Mac it should say `mps`; `CV_DEVICE=cpu` is a last resort. |
| Many short tracks | The shot pans fast or cuts: choose a steadier wide segment (scanner suggestions). |
| Positions look wrong on the pitch | Check the projected lines over the video in the Calibration tab; reject the automatic calibration or calibrate by hand. |
| The video does not play in the browser next to the pitch | The browser lacks the codec (e.g. H.264 in some Linux Chromium builds); the tracking data still plays on the pitch. |
| `uv sync` fails building torch | Use Python 3.11/3.12 (`uv python install 3.12`); Intel Macs need an older torch wheel. |
