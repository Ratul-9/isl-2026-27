"""Synthetic broadcast-like footage with KNOWN geometry, for testing the pipeline without models.

A top-down pitch (with markings and a textured stand at the far side) is warped into a camera view by a
known homography that pans over time; coloured "players" move along known pitch paths. Fake detector and
keypoint models report the ground truth, so tests can check projection, tracking and calibration exactly.
These tests prove the pipeline's logic, NOT the quality of any real model.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from app.detector import Detections, Keypoints
from app.pitch import LENGTH, WIDTH, keypoint_template, pitch_lines

PX_PER_M = 12
W_IMG, H_IMG = 640, 360


def topdown() -> np.ndarray:
    rng = np.random.default_rng(7)
    h, w = int((WIDTH + 40) * PX_PER_M), int((LENGTH + 20) * PX_PER_M)
    img = np.full((h, w, 3), (40, 120, 40), np.uint8)
    noise = rng.integers(-18, 18, (h, w, 1)).astype(np.int16)
    img = np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    # textured "stand" beyond the far touchline gives the motion estimator something to track
    stand = rng.integers(0, 255, (int(25 * PX_PER_M), w, 3)).astype(np.uint8)
    img[: stand.shape[0]] = cv2.GaussianBlur(stand, (5, 5), 0)
    for line in pitch_lines(48):
        pts = ((line + [10, 30]) * PX_PER_M).astype(np.int32)
        cv2.polylines(img, [pts], False, (240, 240, 240), 3)
    return img


def pitch_to_topdown() -> np.ndarray:
    return np.array([[PX_PER_M, 0, 10 * PX_PER_M], [0, PX_PER_M, 30 * PX_PER_M], [0, 0, 1]], np.float64)


def camera(t: float) -> np.ndarray:
    """Homography pitch metres -> image pixels at time t (seconds): a broadcast-like view that pans to the right."""
    centre_x = 40.0 + 6.0 * t  # metres along the pitch
    src = np.array([[centre_x - 22, 6], [centre_x + 22, 6], [centre_x + 30, 66], [centre_x - 30, 66]], np.float32)
    dst = np.array([[40, 70], [600, 70], [640, 350], [0, 350]], np.float32)
    return cv2.getPerspectiveTransform(src, dst).astype(np.float64)


@dataclass
class Player:
    team: str
    start: tuple[float, float]
    velocity: tuple[float, float]  # metres per second

    def at(self, t: float) -> np.ndarray:
        return np.array(self.start) + np.array(self.velocity) * t


PLAYERS = [
    Player("A", (30, 20), (3, 0)), Player("A", (38, 34), (2, 1)), Player("A", (45, 50), (4, -1)),
    Player("B", (50, 25), (-1, 2)), Player("B", (55, 40), (1, 0)), Player("B", (60, 15), (2, 2)),
]
COLOURS = {"A": (250, 250, 250), "B": (40, 40, 220)}  # white vs red shirts (BGR)


def ball_at(t: float) -> np.ndarray:
    return np.array([40 + 8 * t, 30 + 2 * t])


def apply(H: np.ndarray, pts) -> np.ndarray:
    p = np.c_[np.asarray(pts, np.float64).reshape(-1, 2), np.ones(len(np.asarray(pts).reshape(-1, 2)))] @ H.T
    return p[:, :2] / p[:, 2:3]


def player_box(H: np.ndarray, foot_m: np.ndarray) -> np.ndarray:
    fx, fy = apply(H, foot_m)[0]
    head = apply(H, foot_m + [0, -0.0001])[0]  # direction only
    h = 46.0 * (0.55 + 0.45 * fy / H_IMG)  # nearer the camera -> taller
    w = h * 0.4
    return np.array([fx - w / 2, fy - h, fx + w / 2, fy], np.float64)


def write_video(path: Path, seconds: float = 2.0, fps: float = 25.0) -> None:
    td = topdown()
    T = pitch_to_topdown()
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (W_IMG, H_IMG))
    for i in range(int(round(seconds * fps))):
        t = i / fps
        H = camera(t)
        frame = cv2.warpPerspective(td, H @ np.linalg.inv(T), (W_IMG, H_IMG))
        for p in PLAYERS:
            x1, y1, x2, y2 = player_box(H, p.at(t)).astype(int)
            cv2.rectangle(frame, (x1, y1), (x2, y2), COLOURS[p.team], -1)
            cv2.rectangle(frame, (x1, int(y1 + 0.55 * (y2 - y1))), (x2, y2), (20, 20, 20), -1)  # shorts
        bx, by = apply(H, ball_at(t))[0].astype(int)
        cv2.circle(frame, (bx, by), 3, (255, 255, 255), -1)
        writer.write(frame)
    writer.release()


class FakeDetector:
    """Reports the true boxes. `drop_ball` frames have no ball (to test gaps)."""

    def __init__(self, fps: float = 25.0, drop_ball: set[int] | None = None):
        self.fps, self.i, self.drop_ball = fps, 0, drop_ball or set()

    def detect(self, frames):
        out = []
        for _ in frames:
            t = self.i / self.fps
            H = camera(t)
            boxes = [player_box(H, p.at(t)) for p in PLAYERS]
            cls = ["player"] * len(PLAYERS)
            conf = [0.9] * len(PLAYERS)
            if self.i not in self.drop_ball:
                bx, by = apply(H, ball_at(t))[0]
                boxes.append([bx - 3, by - 3, bx + 3, by + 3])
                cls.append("ball")
                conf.append(0.8)
            out.append(Detections(np.array(boxes, np.float32), np.array(conf, np.float32), np.array(cls, object)))
            self.i += 1
        return out


class FakeKeypoints:
    """Projects the template keypoints with the true camera (only those inside the image)."""

    def __init__(self, fps: float = 25.0, noise_px: float = 0.0):
        self.fps, self.i, self.noise = fps, 0, noise_px
        self.rng = np.random.default_rng(3)

    def detect(self, frames):
        out = []
        for _ in frames:
            H = camera(self.i / self.fps)
            xy = apply(H, keypoint_template())
            xy = xy + self.rng.normal(0, self.noise, xy.shape) if self.noise else xy
            inside = (xy[:, 0] > 0) & (xy[:, 0] < W_IMG) & (xy[:, 1] > 0) & (xy[:, 1] < H_IMG)
            out.append(Keypoints(xy, np.where(inside, 0.95, 0.05)))
            self.i += 1
        return out
