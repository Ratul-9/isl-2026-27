"""Video probing and frame decoding with OpenCV (FFmpeg backend bundled in the opencv-python wheel)."""
from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .config import Settings


class VideoError(Exception):
    """A user-presentable problem with the video. `code` is stable for the API."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class VideoMeta:
    fps: float
    frame_count: int
    width: int
    height: int
    duration_s: float
    codec: str


def _fourcc(value: float) -> str:
    v = int(value)
    return "".join(chr((v >> (8 * i)) & 0xFF) for i in range(4)).strip("\x00 ") or "unknown"


def sniff_container(head: bytes) -> str | None:
    """Container from the first bytes; None when it is not one we accept."""
    if len(head) >= 12 and head[4:8] == b"ftyp":
        return "quicktime" if head[8:12] == b"qt  " else "mp4"
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return "webm" if b"webm" in head[:64] else "matroska"
    return None


def probe(path: str | Path) -> VideoMeta:
    cap = cv2.VideoCapture(str(path))
    try:
        if not cap.isOpened():
            raise VideoError("unreadable_video", "The video could not be opened. It may be corrupt or use an unsupported codec.")
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0)
        count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        ok, _ = cap.read()
        if not ok:
            raise VideoError("unreadable_video", "No frame could be decoded from the video. The codec may be unsupported.")
        return VideoMeta(fps, count, width, height, count / fps if fps > 0 else 0.0, _fourcc(cap.get(cv2.CAP_PROP_FOURCC)))
    finally:
        cap.release()


def validate(meta: VideoMeta, settings: Settings, start_s: float, duration_s: float) -> None:
    """Raises VideoError when the video or the requested segment is outside the configured limits."""
    if not (settings.min_fps <= meta.fps <= settings.max_fps):
        raise VideoError("unsupported_video", f"The frame rate ({meta.fps:.2f} fps) is outside {settings.min_fps:g}-{settings.max_fps:g} fps.")
    if meta.width < settings.min_width or meta.height < settings.min_height:
        raise VideoError("unsupported_video", f"The video is {meta.width}x{meta.height}; at least {settings.min_width}x{settings.min_height} is needed.")
    if meta.width > settings.max_width or meta.height > settings.max_height:
        raise VideoError("unsupported_video", f"The video is {meta.width}x{meta.height}; the limit is {settings.max_width}x{settings.max_height}.")
    if meta.duration_s > settings.max_source_seconds:
        raise VideoError("video_too_long", f"The video is {meta.duration_s:.0f} s long; the limit is {settings.max_source_seconds:.0f} s.")
    if duration_s <= 0:
        raise VideoError("invalid_segment", "The segment length must be greater than zero.")
    if duration_s > settings.max_segment_seconds + 1e-6:
        raise VideoError("segment_too_long", f"The segment is {duration_s:.1f} s; at most {settings.max_segment_seconds:g} s can be analysed at once.")
    if start_s < 0 or start_s >= meta.duration_s:
        raise VideoError("invalid_segment", f"The segment starts at {start_s:.1f} s, outside the video (0-{meta.duration_s:.1f} s).")


@dataclass(frozen=True)
class Frame:
    source_index: int  # index of the frame in the source video
    timestamp_ms: float  # presentation timestamp in the source
    image: np.ndarray


def iter_frames(path: str | Path, start_s: float, end_s: float, stride: int = 1) -> Iterator[Frame]:
    """Decodes frames whose presentation timestamp lies in [start_s, end_s), using the decoder's own timestamps."""
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise VideoError("unreadable_video", "The video could not be opened.")
    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
        if start_s > 0:
            cap.set(cv2.CAP_PROP_POS_MSEC, start_s * 1000.0)
        n = 0
        while True:
            ok = cap.grab()
            if not ok:
                break
            ts = float(cap.get(cv2.CAP_PROP_POS_MSEC))
            index = int(round(ts * fps / 1000.0))
            if ts < start_s * 1000.0 - 0.5:  # imprecise seek: decode forward to the start
                continue
            if ts >= end_s * 1000.0 - 0.5:
                break
            if n % stride == 0:
                ok, image = cap.retrieve()
                if not ok:
                    break
                yield Frame(index, ts, image)
            n += 1
    finally:
        cap.release()
