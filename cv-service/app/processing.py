"""The analysis pipeline: decode -> detect -> track -> camera motion -> calibrate -> teams -> trajectories."""
from __future__ import annotations

import hashlib
import statistics
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import numpy as np

from . import pitch_calibration as pc
from .config import Settings
from .detector import Detections, Detector, KeypointDetector, Keypoints
from .schemas import TrackingResult
from .team_assignment import cluster_teams, shirt_colour
from .tracker import BallTracker, PeopleTracker, backfill_match, stabilise_boxes, stitch_tracklets
from .trajectory import PersonObservation, TrackBuilder, ball_track, person_track
from .video_io import VideoError, iter_frames, probe, validate

ProgressFn = Callable[[str, int, int], None]


class ModelsMissing(Exception):
    def __init__(self, missing: list[str], models_dir: Path):
        self.missing = missing
        self.models_dir = models_dir
        super().__init__(f"Model weights missing in {models_dir}: {', '.join(missing)}")


class Cancelled(Exception):
    pass


@dataclass
class AnalyzeRequest:
    video_path: Path
    start_s: float
    duration_s: float
    file_name: str | None = None


@lru_cache(maxsize=8)
def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


@dataclass
class Models:
    detector: Detector
    keypoints: KeypointDetector
    info: list[dict]
    device: str


_MODELS_LOCK = threading.Lock()
_MODELS: dict[tuple, Models] = {}


def load_models(settings: Settings) -> Models:
    """Loads (once per configuration) the detector and the pitch-keypoint model. Raises ModelsMissing."""
    missing = settings.missing_models()
    if missing:
        raise ModelsMissing(missing, settings.models_dir)
    key = (str(settings.models_dir), settings.player_model, settings.ball_model, settings.pitch_model, settings.use_ball_model, settings.device)
    with _MODELS_LOCK:
        if key not in _MODELS:
            from .detector import UltralyticsFootballDetector, UltralyticsPitchKeypointDetector

            device = settings.resolve_device()
            licence = "AGPL-3.0 (Ultralytics YOLOv8 weights; see README)"
            info = [
                {"role": "detector", "name": "Roboflow sports football-player-detection (YOLOv8)", "file": settings.player_model,
                 "sha256": _sha256(str(settings.model_path(settings.player_model))), "licence": licence},
                {"role": "pitchKeypoints", "name": "Roboflow sports football-pitch-detection (YOLOv8-pose, 32 keypoints)",
                 "file": settings.pitch_model, "sha256": _sha256(str(settings.model_path(settings.pitch_model))), "licence": licence},
            ]
            if settings.use_ball_model:
                info.append({"role": "ballDetector", "name": "Roboflow sports football-ball-detection (YOLOv8)", "file": settings.ball_model,
                             "sha256": _sha256(str(settings.model_path(settings.ball_model))), "licence": licence})
            _MODELS[key] = Models(UltralyticsFootballDetector(settings, device), UltralyticsPitchKeypointDetector(settings, device), info, device)
        return _MODELS[key]


@dataclass
class _FrameData:
    people: tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]  # xyxy, conf, cls, global track id
    ball: tuple[np.ndarray | None, float | None]
    keypoints: Keypoints | None
    motion: np.ndarray | None  # previous -> this frame
    cut: bool


@dataclass
class _State:
    timings: dict[str, float] = field(default_factory=lambda: {"decode": 0.0, "detect": 0.0, "keypoints": 0.0, "track": 0.0, "motion": 0.0})


def analyze(
    req: AnalyzeRequest,
    settings: Settings,
    progress: ProgressFn | None = None,
    cancel: threading.Event | None = None,
    models: Models | None = None,
) -> dict:
    t_start = time.perf_counter()
    report = progress or (lambda *_: None)

    report("validating", 0, 1)
    meta = probe(req.video_path)
    validate(meta, settings, req.start_s, req.duration_s)
    end_s = min(req.start_s + req.duration_s, meta.duration_s)
    expected = max(1, int(round((end_s - req.start_s) * meta.fps / settings.frame_stride)))

    report("loading models", 0, 1)
    models = models or load_models(settings)

    def new_tracker() -> PeopleTracker:
        return PeopleTracker(meta.fps / settings.frame_stride, settings.track_activation, settings.track_buffer_frames,
                             settings.track_min_iou, settings.track_min_frames, settings.track_motion_compensation,
                             settings.track_similarity)

    tracker = new_tracker()
    to_stable = np.eye(3)  # current frame -> stabilised image of the shot (for tracking only)
    stable: list[np.ndarray] = []
    tracking_shot: list[int] = []
    ball_tracker = BallTracker(settings.ball_max_jump_px_per_frame * settings.frame_stride)
    state = _State()
    frames: list[_FrameData] = []
    source_index: list[int] = []
    t_ms: list[float] = []
    colours: dict[int, list[np.ndarray]] = {}
    builders: dict[int, TrackBuilder] = {}
    id_offset = 0
    max_local_id = -1
    prev_gray = None
    prev_scale = 1.0
    cuts = pc.CutDetector()
    # Recent frames' detections the tracker left unconfirmed: (frame, xyxy, conf, cls, stabilised xyxy, free mask).
    recent: list[tuple[int, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]] = []
    backfilled = 0

    def process_batch(batch):
        nonlocal id_offset, max_local_id, prev_gray, prev_scale, tracker, ball_tracker, to_stable, recent, backfilled
        images = [fr.image for fr in batch]
        t0 = time.perf_counter()
        detections: list[Detections] = models.detector.detect(images)
        t1 = time.perf_counter()
        kps = models.keypoints.detect(images)
        t2 = time.perf_counter()
        state.timings["detect"] += (t1 - t0) * 1000
        state.timings["keypoints"] += (t2 - t1) * 1000
        for fr, det, kp in zip(batch, detections, kps):
            if cancel is not None and cancel.is_set():
                raise Cancelled()
            f = len(frames)
            t3 = time.perf_counter()
            gray, scale = pc.to_gray_small(fr.image)
            people = det.subset(det.cls != "ball")
            cut = cuts.update(fr.image) and f > 0
            motion = None
            if prev_gray is not None and not cut:
                motion, _ = pc.estimate_motion(prev_gray, gray, people.xyxy, scale)
            if cut:
                # New shot: identities must not carry across a camera cut. (A merely failed motion estimate only
                # breaks calibration pooling; the tracker keeps going.)
                tracker = new_tracker()
                to_stable = np.eye(3)
                ball_tracker = BallTracker(settings.ball_max_jump_px_per_frame * settings.frame_stride)
                id_offset = max(id_offset, max_local_id + id_offset + 1)
                max_local_id = -1
                recent = []
            elif motion is not None:
                to_stable = to_stable @ np.linalg.inv(motion)
            stable.append(to_stable.copy())
            tracking_shot.append((tracking_shot[-1] + 1 if cut else tracking_shot[-1]) if tracking_shot else 0)
            t4 = time.perf_counter()
            xyxy, conf, cls, local_ids = tracker.update(people, to_stable if settings.track_motion_compensation else None)
            ids = local_ids + id_offset
            if len(local_ids):
                max_local_id = max(max_local_id, int(local_ids.max()))
            ball = ball_tracker.update(det.subset(det.cls == "ball"))
            t5 = time.perf_counter()
            for box, c, k, tid in zip(xyxy, conf, cls, ids):
                if int(tid) not in builders:
                    # A newly confirmed track: recover the detections it was built from in the previous frames.
                    builder = builders[int(tid)] = TrackBuilder(int(tid))
                    ref = stabilise_boxes(box[None, :], to_stable)[0] if settings.track_motion_compensation else box
                    for g, gx, gc, gk, gs, free in reversed(recent):
                        j = backfill_match(ref, np.where(free[:, None], gs, -1e6))
                        if j is None:
                            break
                        free[j] = False
                        builder.observations.insert(0, PersonObservation(g, gx[j], float(gc[j]), str(gk[j])))
                        ref = gs[j]
                        backfilled += 1
                builders[int(tid)].observations.append(PersonObservation(f, box, float(c), str(k)))
                if k == "player":
                    col = shirt_colour(fr.image, box)
                    if col is not None:
                        colours.setdefault(int(tid), []).append(col)
            free_now = np.ones(len(people), bool)
            free_now[tracker.last_assigned] = False
            stab_now = stabilise_boxes(people.xyxy.astype(np.float32), to_stable) if (settings.track_motion_compensation and len(people)) else people.xyxy.astype(np.float32)
            recent = (recent + [(f, people.xyxy.astype(np.float32), people.confidence, people.cls, stab_now, free_now)])[-max(0, settings.track_min_frames - 1):] if settings.track_min_frames > 1 else []
            frames.append(_FrameData((xyxy, conf, cls, ids), ball, kp, motion, bool(cut)))
            source_index.append(fr.source_index)
            t_ms.append(round(fr.timestamp_ms - req.start_s * 1000.0, 2))
            prev_gray, prev_scale = gray, scale
            state.timings["motion"] += (t4 - t3) * 1000
            state.timings["track"] += (t5 - t4) * 1000
        report("detecting and tracking", len(frames), expected)

    batch = []
    t_dec = time.perf_counter()
    for fr in iter_frames(req.video_path, req.start_s, end_s, settings.frame_stride):
        if cancel is not None and cancel.is_set():
            raise Cancelled()
        batch.append(fr)
        if len(batch) >= settings.batch_size:
            state.timings["decode"] += (time.perf_counter() - t_dec) * 1000
            process_batch(batch)
            batch = []
            t_dec = time.perf_counter()
    if batch:
        process_batch(batch)
    if not frames:
        raise VideoError("no_frames", "No frames were decoded in the requested segment.")

    # --- calibration -------------------------------------------------------------------------------
    report("calibrating", 0, 1)
    t6 = time.perf_counter()
    T, shots = pc.chain_to_reference([fd.motion for fd in frames], [fd.cut for fd in frames])
    calib = pc.calibrate_from_keypoints(
        [fd.keypoints for fd in frames], T, shots, meta.width, meta.height, settings.keypoint_conf,
        settings.calib_window_frames, settings.calib_ransac_m, settings.calib_max_error_m, settings.calib_min_inliers,
    )
    calib = pc.propagate(calib, T, shots, [fd.keypoints for fd in frames], meta.width, meta.height, settings.keypoint_conf,
                         settings.calib_propagate_frames, settings.calib_propagate_check_m)
    state.timings["calibrate"] = (time.perf_counter() - t6) * 1000

    # --- teams and tracks ---------------------------------------------------------------------------
    report("assembling", 0, 1)
    # Join fragments of the same person (same shot, shortly after, where it was heading, similar shirt).
    chains = stitch_tracklets({tid: b.observations for tid, b in builders.items()}, stable, tracking_shot, colours,
                              max_gap_frames=settings.stitch_max_gap_frames)
    merged_from: dict[int, list[int]] = {}
    for keep, absorbed in chains.items():
        for tid in absorbed:
            builders[keep].observations.extend(builders.pop(tid).observations)
            colours.setdefault(keep, []).extend(colours.pop(tid, []))
        builders[keep].observations.sort(key=lambda o: o.frame)
        merged_from[keep] = absorbed
    teams = cluster_teams(colours)
    tracks = [
        {**person_track(b, calib, teams.assignments.get(tid, "unknown"), teams.confidence.get(tid, 0.0)), "mergedFrom": merged_from.get(tid, [])}
        for tid, b in sorted(builders.items())
    ]
    ball, ball_detected, ball_interp = ball_track([fd.ball for fd in frames], calib, T, shots, settings.ball_max_gap_frames)
    if ball is not None:
        tracks.append({**ball, "mergedFrom": []})

    n = len(frames)
    calibrated = sum(1 for c in calib if c.H is not None)
    propagated = sum(1 for c in calib if c.source == "propagated")
    errors = [c.error_m for c in calib if c.H is not None and c.error_m is not None]
    shot_list = []
    for s in sorted(set(shots)):
        idx = [i for i, x in enumerate(shots) if x == s]
        shot_list.append({"index": s, "startFrame": idx[0], "endFrame": idx[-1]})
    notes = [
        f"{calibrated - propagated} of {n} frames calibrated from pitch keypoints (pooled over +/-{settings.calib_window_frames} frames with camera-motion compensation); "
        f"{propagated} more carried from a calibrated frame of the same shot by camera motion (at most {settings.calib_propagate_frames} frames away, checked against that frame's own keypoints).",
        f"A frame is accepted only if at least {settings.calib_min_inliers} distinct landmarks fit with a leave-one-landmark-out error <= {settings.calib_max_error_m} m.",
    ]
    notes.append(
        "Automatic calibration is not verified against the visible lines: on some broadcasts the keypoint model places a "
        "self-consistent but wrong pitch that passes these checks. Check the projected lines over the video and use manual "
        "calibration where they do not match."
    )
    if len(shot_list) > 1:
        notes.append(f"{len(shot_list) - 1} camera cut(s) or lost camera motion detected; calibration and tracking restart at each.")

    stitched = sum(len(v) for v in merged_from.values())
    warnings = ["Tracker IDs are not shirt numbers and are not linked to squad players; identities can switch when players cross or are hidden."]
    if calibrated == 0:
        warnings.append("No frame could be calibrated: too few pitch markings were recognised reliably. Use manual calibration, or pick a wider shot.")
    elif calibrated < n:
        warnings.append(f"{n - calibrated} of {n} frames have no reliable calibration; pitch positions are missing for those frames.")
    if ball is None:
        warnings.append("The ball was not detected in this segment.")
    else:
        warnings.append(
            f"Ball detected in {ball_detected} of {n} frames; {ball_interp} short gaps (<= {settings.ball_max_gap_frames} frames) were interpolated and are marked as such. "
            "Ball pitch positions assume the ball is on the ground."
        )
    if len(set(tracking_shot)) > 1:
        warnings.append("The segment contains camera cuts; track IDs restart after each cut.")
    if stitched:
        warnings.append(f"{stitched} track fragment(s) were joined automatically (listed in each track's mergedFrom); check them in the editor.")

    result = {
        "schemaVersion": 1,
        "source": {"fileName": req.file_name, "width": meta.width, "height": meta.height, "fps": meta.fps,
                   "durationS": round(meta.duration_s, 3), "frameCount": meta.frame_count, "codec": meta.codec},
        "segment": {"startMs": round(req.start_s * 1000.0, 2), "endMs": round(end_s * 1000.0, 2), "frameStride": settings.frame_stride, "processedFrames": n},
        "models": models.info + [{"role": "tracker", "name": "ByteTrack" + (" with camera-motion compensation" if settings.track_motion_compensation else ""),
                                  "file": None, "sha256": None, "licence": "Apache-2.0 (Roboflow trackers)"}],
        "device": models.device,
        "frames": {"sourceIndex": source_index, "tMs": t_ms},
        "calibration": {
            "status": "unavailable" if calibrated == 0 else ("calibrated" if calibrated == n else "partial"),
            "method": "automatic: pitch keypoints (Roboflow YOLOv8-pose) + RANSAC homography, pooled with camera-motion compensation; UNVERIFIED",
            "framesTotal": n,
            "framesCalibrated": calibrated,
            "medianErrorM": round(statistics.median(errors), 3) if errors else None,
            "maxErrorM": round(max(errors), 3) if errors else None,
            "perFrame": {
                "source": [c.source for c in calib],
                "fromFrame": [getattr(c, "from_frame", None) for c in calib],
                "errorM": [None if c.error_m is None else round(c.error_m, 3) for c in calib],
                "landmarks": [c.landmarks for c in calib],
                "shot": shots,
            },
            "homography": [None if c.H is None else [round(float(v), 9) for v in (c.H / c.H[2, 2]).ravel()] for c in calib],
            "cameraMotion": [[round(float(v), 9) for v in (t / t[2, 2]).ravel()] for t in T],
            "shots": shot_list,
            "notes": notes,
        },
        "teams": {"method": "median torso colour per track (grass removed), k-means k=2; margin < 0.15 => unknown", "clusters": teams.clusters},
        "tracks": tracks,
        "warnings": warnings,
        "timingsMs": {k: round(v, 1) for k, v in {**state.timings, "total": (time.perf_counter() - t_start) * 1000}.items()},
    }
    report("done", n, n)
    # Validate against the published schema before returning anything.
    return TrackingResult.model_validate(result).model_dump(mode="json")
