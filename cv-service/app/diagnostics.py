"""Inspectable output: annotated source frames (boxes, tracker ids, ball, projected pitch lines) and a minimap."""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from .pitch import LENGTH, WIDTH, pitch_lines
from .video_io import iter_frames

UNKNOWN = (160, 160, 160)
REFEREE = (0, 215, 255)
GOALKEEPER = (255, 0, 255)
BALL = (0, 140, 255)


def _hex_bgr(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[4:6], 16), int(h[2:4], 16), int(h[0:2], 16)


def _colour(track: dict, cluster_colours: dict[str, tuple[int, int, int]]) -> tuple[int, int, int]:
    if track["objectType"] == "referee":
        return REFEREE
    if track["objectType"] == "goalkeeper":
        return GOALKEEPER
    return cluster_colours.get(track.get("team") or "", UNKNOWN)


def per_frame_index(result: dict) -> list[list[tuple[dict, int]]]:
    """For each processed frame: (track, observation index) pairs present in it."""
    n = result["segment"]["processedFrames"]
    index: list[list[tuple[dict, int]]] = [[] for _ in range(n)]
    for t in result["tracks"]:
        for i, f in enumerate(t["observations"]["frame"]):
            index[f].append((t, i))
    return index


def draw_frame(image: np.ndarray, result: dict, f: int, items: list[tuple[dict, int]]) -> np.ndarray:
    vis = image.copy()
    colours = {c["id"]: _hex_bgr(c["colorHex"]) for c in result["teams"]["clusters"]}
    H = result["calibration"]["homography"][f]
    if H is not None:
        Hinv = np.linalg.inv(np.array(H).reshape(3, 3))
        for line in pitch_lines():
            pts = cv2.perspectiveTransform(line[None].astype(np.float32), Hinv)[0]
            if np.isfinite(pts).all():
                cv2.polylines(vis, [pts.astype(np.int32)], False, (255, 0, 255), 1, cv2.LINE_AA)
    for t, i in items:
        x1, y1, x2, y2 = (int(v) for v in t["observations"]["bbox"][i])
        if t["objectType"] == "ball":
            interp = t["observations"]["source"][i] == "interpolated"
            cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
            cv2.circle(vis, (cx, cy), 7, BALL, 1 if interp else 2, cv2.LINE_AA)
            cv2.putText(vis, "ball?" if interp else "ball", (cx + 8, cy - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.35, BALL, 1, cv2.LINE_AA)
            continue
        col = _colour(t, colours)
        cv2.rectangle(vis, (x1, y1), (x2, y2), col, 1)
        cv2.putText(vis, f"#{t['trackerId']}", (x1, max(10, y1 - 3)), cv2.FONT_HERSHEY_SIMPLEX, 0.38, col, 1, cv2.LINE_AA)
    cal = result["calibration"]["perFrame"]
    label = (f"frame {f}  t={result['frames']['tMs'][f] / 1000:.2f}s  calib: "
             + (f"{cal['source'][f]} err {cal['errorM'][f]:.2f} m" if cal["source"][f] != "none" else "UNCALIBRATED"))
    cv2.rectangle(vis, (0, vis.shape[0] - 22), (vis.shape[1], vis.shape[0]), (0, 0, 0), -1)
    cv2.putText(vis, label, (6, vis.shape[0] - 7), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
    return vis


def draw_minimap(result: dict, f: int, items: list[tuple[dict, int]], height: int) -> np.ndarray:
    scale = height / (WIDTH + 8)
    w = int((LENGTH + 8) * scale)
    img = np.full((height, w, 3), (43, 89, 23), np.uint8)
    off = 4 * scale
    for line in pitch_lines():
        pts = (line * scale + off).astype(np.int32)
        cv2.polylines(img, [pts], False, (245, 247, 245), 1, cv2.LINE_AA)
    colours = {c["id"]: _hex_bgr(c["colorHex"]) for c in result["teams"]["clusters"]}
    for t, i in items:
        p = t["observations"]["pitch"][i]
        if p is None:
            continue
        x, y = p[0] / 100 * LENGTH * scale + off, p[1] / 100 * WIDTH * scale + off
        if t["objectType"] == "ball":
            cv2.circle(img, (int(x), int(y)), 4, (255, 255, 255), -1, cv2.LINE_AA)
            cv2.circle(img, (int(x), int(y)), 4, (0, 0, 0), 1, cv2.LINE_AA)
            continue
        col = _colour(t, colours)
        cv2.circle(img, (int(x), int(y)), 6, col, -1, cv2.LINE_AA)
        cv2.putText(img, str(t["trackerId"]), (int(x) + 6, int(y) - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.33, (255, 255, 255), 1, cv2.LINE_AA)
    if result["calibration"]["perFrame"]["source"][f] == "none":
        cv2.putText(img, "no calibration in this frame", (8, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 255), 1, cv2.LINE_AA)
    return img


def render(video_path: Path, result: dict, out_dir: Path, video: bool = True, sample_every_s: float = 1.0) -> list[Path]:
    """Writes diagnostic.mp4 (side-by-side annotated frame + minimap) and sample JPEGs. Returns written paths."""
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "frames").mkdir(exist_ok=True)
    index = per_frame_index(result)
    start = result["segment"]["startMs"] / 1000.0
    end = result["segment"]["endMs"] / 1000.0
    writer = None
    written: list[Path] = []
    next_sample = 0.0
    for f, fr in enumerate(iter_frames(video_path, start, end, result["segment"]["frameStride"])):
        if f >= len(index):
            break
        left = draw_frame(fr.image, result, f, index[f])
        right = draw_minimap(result, f, index[f], left.shape[0])
        combo = np.hstack([left, right])
        if video:
            if writer is None:
                path = out_dir / "diagnostic.mp4"
                fps = result["source"]["fps"] / result["segment"]["frameStride"]
                writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (combo.shape[1], combo.shape[0]))
                written.append(path)
            writer.write(combo)
        t = result["frames"]["tMs"][f] / 1000.0
        if t + 1e-6 >= next_sample:
            p = out_dir / "frames" / f"frame_{f:04d}.jpg"
            cv2.imwrite(str(p), combo, [cv2.IMWRITE_JPEG_QUALITY, 88])
            written.append(p)
            next_sample += sample_every_s
    if writer is not None:
        writer.release()
    return written
