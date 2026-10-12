"""Turns per-frame tracking into tracks with image and pitch coordinates, and bridges short ball gaps."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .pitch import LENGTH, WIDTH
from .pitch_calibration import FrameCalibration, project
from .tracker import majority_class

# Points a little outside the lines are clamped onto the pitch (players do step over the line);
# anything further out is treated as unmappable for that frame.
PITCH_MARGIN_M = 3.0


def to_dizpitch(H: np.ndarray | None, point: np.ndarray) -> list[float] | None:
    if H is None:
        return None
    x, y = project(H, point)[0]
    if not (-PITCH_MARGIN_M <= x <= LENGTH + PITCH_MARGIN_M and -PITCH_MARGIN_M <= y <= WIDTH + PITCH_MARGIN_M):
        return None
    x, y = min(max(x, 0.0), LENGTH), min(max(y, 0.0), WIDTH)
    return [round(x / LENGTH * 100.0, 2), round(y / WIDTH * 100.0, 2)]


@dataclass
class PersonObservation:
    frame: int
    xyxy: np.ndarray
    confidence: float
    cls: str


@dataclass
class TrackBuilder:
    tracker_id: int
    observations: list[PersonObservation] = field(default_factory=list)


def foot_point(xyxy: np.ndarray) -> np.ndarray:
    """Ground contact approximated by the bottom-centre of the box."""
    return np.array([(xyxy[0] + xyxy[2]) / 2.0, xyxy[3]], np.float64)


def _r(values, n=1):
    return [round(float(v), n) for v in values]


def person_track(builder: TrackBuilder, calib: list[FrameCalibration], team: str, team_conf: float) -> dict:
    cls, votes = majority_class([o.cls for o in builder.observations])
    obs = {"frame": [], "bbox": [], "foot": [], "pitch": [], "confidence": [], "source": []}
    for o in builder.observations:
        foot = foot_point(o.xyxy)
        obs["frame"].append(o.frame)
        obs["bbox"].append(_r(o.xyxy))
        obs["foot"].append(_r(foot))
        obs["pitch"].append(to_dizpitch(calib[o.frame].H, foot))
        obs["confidence"].append(round(o.confidence, 3))
        obs["source"].append("detected")
    return {
        "trackId": f"t{builder.tracker_id}",
        "trackerId": builder.tracker_id,
        "objectType": cls,
        "team": (team if cls == "player" else ("unknown" if cls == "goalkeeper" else None)),
        "teamConfidence": (team_conf if cls == "player" else None),
        "classVotes": votes,
        "observations": obs,
    }


def ball_track(
    balls: list[tuple[np.ndarray | None, float | None]],
    calib: list[FrameCalibration],
    T: list[np.ndarray],
    shots: list[int],
    max_gap: int,
) -> tuple[dict | None, int, int]:
    """Ball observations; gaps of at most `max_gap` frames inside one shot are bridged and marked 'interpolated'.

    Returns (track or None, detected count, interpolated count). The ball is projected through its CENTRE, i.e.
    assumed to be on the ground; a ball in the air will appear further from the camera than it really is.
    """
    detected = [i for i, (b, _) in enumerate(balls) if b is not None]
    if not detected:
        return None, 0, 0
    obs = {"frame": [], "bbox": [], "foot": [], "pitch": [], "confidence": [], "source": []}
    interpolated = 0

    def centre(b):
        return np.array([(b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0])

    for k, f in enumerate(detected):
        b, conf = balls[f]
        c = centre(b)
        obs["frame"].append(f)
        obs["bbox"].append(_r(b))
        obs["foot"].append(_r(c))
        obs["pitch"].append(to_dizpitch(calib[f].H, c))
        obs["confidence"].append(round(float(conf), 3))
        obs["source"].append("detected")
        if k + 1 < len(detected):
            g = detected[k + 1]
            gap = g - f - 1
            if 0 < gap <= max_gap and shots[f] == shots[g]:
                # Interpolate in the shot's reference image (removes camera motion), then map back to each frame.
                c_ref_f = (T[f] @ np.array([*c, 1.0]))
                c_ref_f = c_ref_f[:2] / c_ref_f[2]
                cg = centre(balls[g][0])
                c_ref_g = (T[g] @ np.array([*cg, 1.0]))
                c_ref_g = c_ref_g[:2] / c_ref_g[2]
                half = (b[2] - b[0]) / 2.0
                for j in range(1, gap + 1):
                    h = f + j
                    a = j / (gap + 1)
                    ref = (1 - a) * c_ref_f + a * c_ref_g
                    p = np.linalg.inv(T[h]) @ np.array([*ref, 1.0])
                    ci = p[:2] / p[2]
                    obs["frame"].append(h)
                    obs["bbox"].append(_r([ci[0] - half, ci[1] - half, ci[0] + half, ci[1] + half]))
                    obs["foot"].append(_r(ci))
                    obs["pitch"].append(to_dizpitch(calib[h].H, ci))
                    obs["confidence"].append(None)
                    obs["source"].append("interpolated")
                    interpolated += 1
    order = np.argsort(obs["frame"], kind="stable")
    obs = {k: [v[i] for i in order] for k, v in obs.items()}
    track = {
        "trackId": "ball",
        "trackerId": None,
        "objectType": "ball",
        "team": None,
        "teamConfidence": None,
        "classVotes": {"ball": len(detected)},
        "observations": obs,
    }
    return track, len(detected), interpolated
