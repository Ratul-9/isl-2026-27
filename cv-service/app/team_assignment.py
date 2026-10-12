"""Team grouping from shirt colours, aggregated per track over many frames. Ambiguous tracks stay 'unknown'."""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


def shirt_colour(image: np.ndarray, xyxy: np.ndarray) -> np.ndarray | None:
    """Median Lab colour of the torso (rows 15-50% of the box, central half), grass pixels removed."""
    h, w = image.shape[:2]
    x1, y1, x2, y2 = xyxy
    bh, bw = y2 - y1, x2 - x1
    if bh < 12 or bw < 5:
        return None
    r1, r2 = int(max(0, y1 + 0.15 * bh)), int(min(h, y1 + 0.5 * bh))
    c1, c2 = int(max(0, x1 + 0.25 * bw)), int(min(w, x2 - 0.25 * bw))
    if r2 - r1 < 3 or c2 - c1 < 2:
        return None
    crop = image[r1:r2, c1:c2]
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV).reshape(-1, 3)
    lab = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)
    grass = (hsv[:, 0] >= 35) & (hsv[:, 0] <= 85) & (hsv[:, 1] >= 60)
    keep = lab[~grass]
    if len(keep) < 8:
        return None
    return np.median(keep, axis=0)


@dataclass
class TeamResult:
    assignments: dict[int, str]  # tracker id -> "A" | "B" | "unknown"
    confidence: dict[int, float]  # tracker id -> margin in [0, 1]
    clusters: list[dict]  # [{id, colorHex, trackCount}]


def lab_to_hex(lab: np.ndarray) -> str:
    bgr = cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8).reshape(1, 1, 3), cv2.COLOR_LAB2BGR)[0, 0]
    return "#{:02x}{:02x}{:02x}".format(int(bgr[2]), int(bgr[1]), int(bgr[0]))


def cluster_teams(samples: dict[int, list[np.ndarray]], min_samples: int = 3, min_margin: float = 0.15) -> TeamResult:
    """k-means (k=2) over per-track median colours. Cluster A is the lighter kit, B the darker (deterministic)."""
    tracks = [t for t, s in samples.items() if len(s) >= min_samples]
    if len(tracks) < 4:
        return TeamResult({t: "unknown" for t in samples}, {t: 0.0 for t in samples}, [])
    feats = np.array([np.median(np.array(samples[t]), axis=0) for t in tracks], np.float32)
    cv2.setRNGSeed(12345)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 100, 0.1)
    _, labels, centres = cv2.kmeans(feats, 2, None, criteria, 10, cv2.KMEANS_PP_CENTERS)
    labels = labels.ravel()
    order = np.argsort(-centres[:, 0])  # lighter (higher L) first
    name = {int(order[0]): "A", int(order[1]): "B"}
    assignments: dict[int, str] = {t: "unknown" for t in samples}
    confidence: dict[int, float] = {t: 0.0 for t in samples}
    for t, f, lab in zip(tracks, feats, labels):
        d = np.linalg.norm(centres - f, axis=1)
        own, other = d[lab], d[1 - lab]
        margin = float((other - own) / max(other + own, 1e-6))
        confidence[t] = round(margin, 3)
        assignments[t] = name[int(lab)] if margin >= min_margin else "unknown"
    clusters = [
        {"id": name[int(k)], "colorHex": lab_to_hex(centres[k]), "trackCount": int(sum(1 for t in tracks if assignments[t] == name[int(k)]))}
        for k in order
    ]
    return TeamResult(assignments, confidence, clusters)
