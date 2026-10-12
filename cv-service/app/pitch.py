"""Standard pitch template shared by calibration, projection and diagnostics.

Coordinates are metres on a 105 x 68 m pitch, the same template DizPitch draws
(`src/domain/geometry.ts`): x along the length from the LEFT goal line (as seen
from the main broadcast camera), y across from the FAR touchline (the top of
DizPitch's pitch). DizPitch's normalised 0-100 frame is x/105*100, y/68*100.

The 32 keypoints follow the order of the Roboflow `sports` pitch-keypoint model
(github.com/roboflow/sports, `sports/configs/soccer.py`, MIT licence): index i of
the model output is vertex i+1 below. Their template uses an approximate 120 x 70
m pitch with a 20.15 m penalty box; we keep the *semantics* of each point but use
the Laws of the Game dimensions so projected positions line up with DizPitch's
markings. Points 11/12/19/20 are where the penalty arc meets the box line.
"""
from __future__ import annotations

import math

import numpy as np

LENGTH = 105.0
WIDTH = 68.0
PENALTY_BOX_LENGTH = 16.5
PENALTY_BOX_WIDTH = 40.32
GOAL_BOX_LENGTH = 5.5
GOAL_BOX_WIDTH = 18.32
CENTRE_CIRCLE_RADIUS = 9.15
PENALTY_SPOT = 11.0

_ARC_HALF = math.sqrt(CENTRE_CIRCLE_RADIUS**2 - (PENALTY_BOX_LENGTH - PENALTY_SPOT) ** 2)  # 7.31 m


def keypoint_template(arc_semantics: str = "arc") -> np.ndarray:
    """(32, 2) array of keypoint positions in metres.

    `arc_semantics="arc"`: points 11/12/19/20 where the penalty arc meets the box line (a visible feature).
    `arc_semantics="roboflow"`: Roboflow's approximation (the goal-area width), kept for comparison.
    """
    W, L = WIDTH, LENGTH
    pb_lo, pb_hi = (W - PENALTY_BOX_WIDTH) / 2, (W + PENALTY_BOX_WIDTH) / 2
    gb_lo, gb_hi = (W - GOAL_BOX_WIDTH) / 2, (W + GOAL_BOX_WIDTH) / 2
    if arc_semantics == "arc":
        d_lo, d_hi = W / 2 - _ARC_HALF, W / 2 + _ARC_HALF
    else:
        d_lo, d_hi = gb_lo, gb_hi
    pbl, gbl, r = PENALTY_BOX_LENGTH, GOAL_BOX_LENGTH, CENTRE_CIRCLE_RADIUS
    pts = [
        (0, 0), (0, pb_lo), (0, gb_lo), (0, gb_hi), (0, pb_hi), (0, W),  # 1-6 left goal line
        (gbl, gb_lo), (gbl, gb_hi),  # 7-8 left goal area
        (PENALTY_SPOT, W / 2),  # 9 left penalty spot
        (pbl, pb_lo), (pbl, d_lo), (pbl, d_hi), (pbl, pb_hi),  # 10-13 left box line
        (L / 2, 0), (L / 2, W / 2 - r), (L / 2, W / 2 + r), (L / 2, W),  # 14-17 halfway line
        (L - pbl, pb_lo), (L - pbl, d_lo), (L - pbl, d_hi), (L - pbl, pb_hi),  # 18-21 right box line
        (L - PENALTY_SPOT, W / 2),  # 22 right penalty spot
        (L - gbl, gb_lo), (L - gbl, gb_hi),  # 23-24 right goal area
        (L, 0), (L, pb_lo), (L, gb_lo), (L, gb_hi), (L, pb_hi), (L, W),  # 25-30 right goal line
        (L / 2 - r, W / 2), (L / 2 + r, W / 2),  # 31-32 centre circle on the centre line
    ]
    return np.asarray(pts, dtype=np.float64)


def pitch_lines(samples_per_arc: int = 32) -> list[np.ndarray]:
    """Polylines (metres) of the pitch markings, for drawing projected overlays."""
    W, L = WIDTH, LENGTH
    lines: list[np.ndarray] = [
        np.array([(0, 0), (L, 0), (L, W), (0, W), (0, 0)]),
        np.array([(L / 2, 0), (L / 2, W)]),
    ]
    for x0, sign in ((0.0, 1.0), (L, -1.0)):
        pb = [(x0, (W - PENALTY_BOX_WIDTH) / 2), (x0 + sign * PENALTY_BOX_LENGTH, (W - PENALTY_BOX_WIDTH) / 2),
              (x0 + sign * PENALTY_BOX_LENGTH, (W + PENALTY_BOX_WIDTH) / 2), (x0, (W + PENALTY_BOX_WIDTH) / 2)]
        gb = [(x0, (W - GOAL_BOX_WIDTH) / 2), (x0 + sign * GOAL_BOX_LENGTH, (W - GOAL_BOX_WIDTH) / 2),
              (x0 + sign * GOAL_BOX_LENGTH, (W + GOAL_BOX_WIDTH) / 2), (x0, (W + GOAL_BOX_WIDTH) / 2)]
        lines += [np.array(pb), np.array(gb)]
        # Penalty arc: the part of the circle around the spot that lies outside the box.
        spot = x0 + sign * PENALTY_SPOT
        a = math.acos((PENALTY_BOX_LENGTH - PENALTY_SPOT) / CENTRE_CIRCLE_RADIUS)
        ts = np.linspace(-a, a, samples_per_arc)
        lines.append(np.stack([spot + sign * CENTRE_CIRCLE_RADIUS * np.cos(ts), W / 2 + CENTRE_CIRCLE_RADIUS * np.sin(ts)], 1))
    ts = np.linspace(0, 2 * math.pi, samples_per_arc * 2)
    lines.append(np.stack([L / 2 + CENTRE_CIRCLE_RADIUS * np.cos(ts), W / 2 + CENTRE_CIRCLE_RADIUS * np.sin(ts)], 1))
    return [l.astype(np.float64) for l in lines]


def metres_to_dizpitch(x_m: float, y_m: float) -> tuple[float, float]:
    """Metres on the template -> DizPitch's normalised 0-100 frame (unclamped)."""
    return x_m / LENGTH * 100.0, y_m / WIDTH * 100.0
