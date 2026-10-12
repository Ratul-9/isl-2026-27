"""Service configuration from environment variables (never machine-specific paths in code)."""
from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent.parent


def _env(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value.strip() if value and value.strip() else default


def _float(name: str, default: float) -> float:
    try:
        return float(_env(name, str(default)))
    except ValueError:
        return default


def _int(name: str, default: int) -> int:
    try:
        return int(float(_env(name, str(default))))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    # Models (Roboflow "sports" football models; see README for sources and licences).
    models_dir: Path = field(default_factory=lambda: Path(_env("CV_MODELS_DIR", str(SERVICE_DIR / "models"))))
    player_model: str = field(default_factory=lambda: _env("CV_PLAYER_MODEL", "football-player-detection.pt"))
    ball_model: str = field(default_factory=lambda: _env("CV_BALL_MODEL", "football-ball-detection.pt"))
    pitch_model: str = field(default_factory=lambda: _env("CV_PITCH_MODEL", "football-pitch-detection.pt"))
    use_ball_model: bool = field(default_factory=lambda: _env("CV_USE_BALL_MODEL", "1") not in ("0", "false", "no"))
    device: str = field(default_factory=lambda: _env("CV_DEVICE", "auto"))  # auto | mps | cuda | cpu
    batch_size: int = field(default_factory=lambda: max(1, _int("CV_BATCH_SIZE", 4)))

    # Detection.
    player_imgsz: int = field(default_factory=lambda: _int("CV_PLAYER_IMGSZ", 1280))
    ball_imgsz: int = field(default_factory=lambda: _int("CV_BALL_IMGSZ", 1280))
    pitch_imgsz: int = field(default_factory=lambda: _int("CV_PITCH_IMGSZ", 640))
    person_conf: float = field(default_factory=lambda: _float("CV_PERSON_CONF", 0.3))
    ball_conf: float = field(default_factory=lambda: _float("CV_BALL_CONF", 0.2))
    keypoint_conf: float = field(default_factory=lambda: _float("CV_KEYPOINT_CONF", 0.5))

    # Tracking (ByteTrack via supervision).
    track_activation: float = field(default_factory=lambda: _float("CV_TRACK_ACTIVATION", 0.35))
    track_buffer_frames: int = field(default_factory=lambda: _int("CV_TRACK_BUFFER", 30))
    # GIoU (distance-aware) association; negative thresholds allow near-miss boxes during fast pans.
    track_similarity: str = field(default_factory=lambda: _env("CV_TRACK_SIMILARITY", "giou"))  # iou | giou | diou
    track_min_iou: float = field(default_factory=lambda: _float("CV_TRACK_MIN_IOU", -0.5))
    stitch_max_gap_frames: int = field(default_factory=lambda: _int("CV_STITCH_MAX_GAP_FRAMES", 25))
    track_motion_compensation: bool = field(default_factory=lambda: _env("CV_TRACK_MOTION_COMPENSATION", "1") not in ("0", "false", "no"))
    track_min_frames: int = field(default_factory=lambda: _int("CV_TRACK_MIN_FRAMES", 3))
    ball_max_gap_frames: int = field(default_factory=lambda: _int("CV_BALL_MAX_GAP_FRAMES", 6))
    ball_max_jump_px_per_frame: float = field(default_factory=lambda: _float("CV_BALL_MAX_JUMP", 60.0))

    # Calibration.
    calib_window_frames: int = field(default_factory=lambda: _int("CV_CALIB_WINDOW", 12))
    calib_ransac_m: float = field(default_factory=lambda: _float("CV_CALIB_RANSAC_M", 1.5))
    calib_max_error_m: float = field(default_factory=lambda: _float("CV_CALIB_MAX_ERROR_M", 0.8))
    calib_min_inliers: int = field(default_factory=lambda: _int("CV_CALIB_MIN_INLIERS", 6))
    calib_propagate_frames: int = field(default_factory=lambda: _int("CV_CALIB_PROPAGATE_FRAMES", 50))
    calib_propagate_check_m: float = field(default_factory=lambda: _float("CV_CALIB_PROPAGATE_CHECK_M", 1.5))

    # Limits and processing.
    frame_stride: int = field(default_factory=lambda: max(1, _int("CV_FRAME_STRIDE", 1)))
    max_upload_mb: float = field(default_factory=lambda: _float("CV_MAX_UPLOAD_MB", 300))
    max_source_seconds: float = field(default_factory=lambda: _float("CV_MAX_SOURCE_SECONDS", 1800))
    max_segment_seconds: float = field(default_factory=lambda: _float("CV_MAX_SEGMENT_SECONDS", 15))
    min_width: int = 320
    min_height: int = 180
    max_width: int = 3840
    max_height: int = 2160
    min_fps: float = 5.0
    max_fps: float = 120.0

    # Jobs and files.
    work_dir: Path = field(default_factory=lambda: Path(_env("CV_WORK_DIR", str(Path(tempfile.gettempdir()) / "dizpitch-cv"))))
    result_ttl_seconds: int = field(default_factory=lambda: _int("CV_RESULT_TTL_SECONDS", 3600))
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(o.strip() for o in _env("CV_CORS_ORIGINS", "").split(",") if o.strip())
    )

    @property
    def max_upload_bytes(self) -> int:
        return int(self.max_upload_mb * 1024 * 1024)

    def model_path(self, name: str) -> Path:
        return self.models_dir / name

    def missing_models(self) -> list[str]:
        names = [self.player_model, self.pitch_model] + ([self.ball_model] if self.use_ball_model else [])
        return [n for n in names if not self.model_path(n).is_file()]

    def resolve_device(self) -> str:
        if self.device != "auto":
            return self.device
        import torch

        if torch.cuda.is_available():
            return "cuda"
        if torch.backends.mps.is_available():
            return "mps"
        return "cpu"
