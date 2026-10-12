"""Finds camera shots in a longer video and scores how suitable each is for tracking.

Highlights packages mix wide broadcast shots with close-ups, replays and graphics. Tracking and calibration only
work on wide shots with visible pitch markings, so this lists shots (cut detection on every frame) and samples the
pitch-keypoint model at a low rate to score each shot. No players are detected here.
"""
from __future__ import annotations

import statistics
import threading
from collections.abc import Callable

import cv2
import numpy as np

from . import pitch_calibration as pc
from .config import Settings
from .processing import Cancelled, Models, load_models
from .video_io import VideoError, probe

WIDE_KEYPOINTS = 6  # a sample counts as "wide" with at least this many confident keypoints


def scan(path, settings: Settings, progress: Callable[[str, int, int], None] | None = None,
         cancel: threading.Event | None = None, models: Models | None = None, sample_hz: float = 2.0) -> dict:
    report = progress or (lambda *_: None)
    meta = probe(path)
    if meta.duration_s > settings.max_source_seconds:
        raise VideoError("video_too_long", f"The video is {meta.duration_s:.0f} s long; the limit is {settings.max_source_seconds:.0f} s.")
    models = models or load_models(settings)
    cap = cv2.VideoCapture(str(path))
    step = max(1, int(round(meta.fps / sample_hz)))
    cuts = [0]
    samples: list[tuple[int, int]] = []  # (frame index, confident keypoints)
    batch_idx: list[int] = []
    batch_img: list[np.ndarray] = []
    detector = pc.CutDetector()
    f = 0

    def flush():
        if not batch_img:
            return
        for i, kp in zip(batch_idx, models.keypoints.detect(batch_img)):
            samples.append((i, 0 if kp is None else int((kp.confidence > settings.keypoint_conf).sum())))
        batch_idx.clear()
        batch_img.clear()

    try:
        while True:
            if cancel is not None and cancel.is_set():
                raise Cancelled()
            ok, image = cap.read()
            if not ok:
                break
            if detector.update(image) and f > 0:
                cuts.append(f)
            if f % step == 0:
                batch_idx.append(f)
                batch_img.append(image)
                if len(batch_img) >= settings.batch_size * 2:
                    flush()
            if f % 250 == 0:
                report("scanning shots", f, meta.frame_count)
            f += 1
        flush()
    finally:
        cap.release()
    total = f
    bounds = cuts + [total]
    shots = []
    for a, b in zip(bounds, bounds[1:]):
        if b <= a:
            continue
        ks = [k for i, k in samples if a <= i < b]
        wide = sum(1 for k in ks if k >= WIDE_KEYPOINTS) / len(ks) if ks else 0.0
        shots.append({
            "startS": round(a / meta.fps, 3), "endS": round(b / meta.fps, 3), "durationS": round((b - a) / meta.fps, 3),
            "wideScore": round(wide, 2), "medianKeypoints": statistics.median(ks) if ks else 0, "samples": len(ks),
        })
    suggestions = sorted(
        (s for s in shots if s["wideScore"] >= 0.6 and s["durationS"] >= 3.0),
        key=lambda s: (-s["wideScore"], -s["durationS"]),
    )
    report("done", total, total)
    return {
        "source": {"width": meta.width, "height": meta.height, "fps": meta.fps, "durationS": round(meta.duration_s, 3), "frameCount": meta.frame_count},
        "sampleHz": sample_hz,
        "shots": shots,
        "suggestions": [{"startS": s["startS"], "durationS": round(min(s["durationS"], settings.max_segment_seconds), 3), "wideScore": s["wideScore"]} for s in suggestions[:12]],
    }
