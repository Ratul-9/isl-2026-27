"""Object detection behind a small interface, so another detector can be swapped in later."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np

from .config import Settings

PERSON_CLASSES = ("player", "goalkeeper", "referee")
CLASSES = ("ball",) + PERSON_CLASSES


@dataclass
class Detections:
    """Detections for one frame. `cls` holds class names from CLASSES."""

    xyxy: np.ndarray  # (N, 4) float32, image pixels
    confidence: np.ndarray  # (N,) float32
    cls: np.ndarray  # (N,) object array of class names

    @staticmethod
    def empty() -> "Detections":
        return Detections(np.zeros((0, 4), np.float32), np.zeros((0,), np.float32), np.zeros((0,), object))

    def __len__(self) -> int:
        return len(self.confidence)

    def subset(self, mask: np.ndarray) -> "Detections":
        return Detections(self.xyxy[mask], self.confidence[mask], self.cls[mask])


@dataclass
class Keypoints:
    """Pitch keypoints for one frame (32 points in the order of app.pitch.keypoint_template)."""

    xy: np.ndarray  # (32, 2) image pixels
    confidence: np.ndarray  # (32,)


class Detector(Protocol):
    def detect(self, frames: list[np.ndarray]) -> list[Detections]: ...


class KeypointDetector(Protocol):
    def detect(self, frames: list[np.ndarray]) -> list[Keypoints | None]: ...


def iou(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Pairwise IoU between (N,4) and (M,4) boxes."""
    if len(a) == 0 or len(b) == 0:
        return np.zeros((len(a), len(b)), np.float32)
    x1 = np.maximum(a[:, None, 0], b[None, :, 0])
    y1 = np.maximum(a[:, None, 1], b[None, :, 1])
    x2 = np.minimum(a[:, None, 2], b[None, :, 2])
    y2 = np.minimum(a[:, None, 3], b[None, :, 3])
    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    area_a = (a[:, 2] - a[:, 0]) * (a[:, 3] - a[:, 1])
    area_b = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
    return inter / np.maximum(area_a[:, None] + area_b[None, :] - inter, 1e-9)


def merge_ball_candidates(people_model: Detections, ball_model: Detections | None, iou_threshold: float = 0.3) -> Detections:
    """Ball boxes from the general model plus the dedicated ball model, duplicates removed (higher confidence wins)."""
    balls = people_model.subset(people_model.cls == "ball")
    if ball_model is None or len(ball_model) == 0:
        return balls
    all_xyxy = np.concatenate([balls.xyxy, ball_model.xyxy])
    all_conf = np.concatenate([balls.confidence, ball_model.confidence])
    order = np.argsort(-all_conf)
    keep: list[int] = []
    for i in order:
        if not keep or iou(all_xyxy[i : i + 1], all_xyxy[keep]).max() < iou_threshold:
            keep.append(int(i))
    return Detections(all_xyxy[keep], all_conf[keep], np.array(["ball"] * len(keep), object))


class UltralyticsFootballDetector:
    """Roboflow's football models (YOLOv8, run with Ultralytics). Classes: ball, goalkeeper, player, referee."""

    def __init__(self, settings: Settings, device: str):
        from ultralytics import YOLO  # imported lazily: heavy, and only needed when models exist

        self.settings = settings
        self.device = device
        self.people = YOLO(str(settings.model_path(settings.player_model)))
        self.ball = YOLO(str(settings.model_path(settings.ball_model))) if settings.use_ball_model else None
        names = {int(k): v for k, v in self.people.names.items()}
        if set(names.values()) != set(CLASSES):
            raise RuntimeError(f"Unexpected classes in {settings.player_model}: {names}")
        self.names = names

    def _run(self, model, frames: list[np.ndarray], imgsz: int, conf: float) -> list[Detections]:
        results = model(frames, imgsz=imgsz, conf=conf, device=self.device, verbose=False)
        out = []
        for r in results:
            b = r.boxes
            cls = np.array([model.names[int(c)] for c in b.cls.cpu().numpy()], object)
            out.append(Detections(b.xyxy.cpu().numpy().astype(np.float32), b.conf.cpu().numpy().astype(np.float32), cls))
        return out

    def detect(self, frames: list[np.ndarray]) -> list[Detections]:
        s = self.settings
        people = self._run(self.people, frames, s.player_imgsz, min(s.person_conf, s.ball_conf))
        balls = self._run(self.ball, frames, s.ball_imgsz, s.ball_conf) if self.ball is not None else [None] * len(frames)
        out = []
        for p, b in zip(people, balls):
            persons = p.subset(np.isin(p.cls, PERSON_CLASSES) & (p.confidence >= s.person_conf))
            ball = merge_ball_candidates(p.subset(p.confidence >= s.ball_conf), b)
            out.append(Detections(np.concatenate([persons.xyxy, ball.xyxy]), np.concatenate([persons.confidence, ball.confidence]),
                                  np.concatenate([persons.cls, ball.cls])))
        return out


class UltralyticsPitchKeypointDetector:
    def __init__(self, settings: Settings, device: str):
        from ultralytics import YOLO

        self.settings = settings
        self.device = device
        self.model = YOLO(str(settings.model_path(settings.pitch_model)))
        shape = self.model.model.yaml.get("kpt_shape") if hasattr(self.model.model, "yaml") else None
        if shape and list(shape)[:1] != [32]:
            raise RuntimeError(f"Unexpected keypoint layout in {settings.pitch_model}: {shape}")

    def detect(self, frames: list[np.ndarray]) -> list[Keypoints | None]:
        results = self.model(frames, imgsz=self.settings.pitch_imgsz, conf=0.25, device=self.device, verbose=False)
        out: list[Keypoints | None] = []
        for r in results:
            kp = r.keypoints
            if kp is None or kp.conf is None or len(kp.xy) == 0:
                out.append(None)
                continue
            best = int(np.argmax(r.boxes.conf.cpu().numpy())) if len(r.boxes) else 0
            out.append(Keypoints(kp.xy[best].cpu().numpy().astype(np.float64), kp.conf[best].cpu().numpy().astype(np.float64)))
        return out
