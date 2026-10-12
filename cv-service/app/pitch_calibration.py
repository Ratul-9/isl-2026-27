"""Broadcast image <-> pitch calibration.

Per frame we want H (3x3) mapping image pixels to pitch metres (app.pitch template). Sources:

1. Pitch keypoints from the keypoint model, POOLED over a short window of neighbouring frames of the same
   shot. Neighbouring keypoints are carried into the current frame with the camera's frame-to-frame motion,
   which for a broadcast camera (pan/tilt/zoom about a fixed point) is itself a homography.
2. Manual landmark correspondences on one reference frame, carried to the other frames of the shot by the same
   camera motion.

Every fit is checked: enough distinct landmarks that are not collinear, a leave-one-landmark-out error below a
threshold, and a plausible geometry (the horizon does not cut through the lower image). Frames that fail stay
UNCALIBRATED; nothing is guessed.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .detector import Keypoints
from .pitch import LENGTH, WIDTH, keypoint_template

_TEMPLATE = keypoint_template("arc")


# --- camera motion -----------------------------------------------------------------------------

def to_gray_small(image: np.ndarray, max_width: int = 640) -> tuple[np.ndarray, float]:
    """Grayscale, downscaled copy used for motion estimation; returns (gray, scale)."""
    h, w = image.shape[:2]
    scale = min(1.0, max_width / float(w))
    small = cv2.resize(image, (int(round(w * scale)), int(round(h * scale))), interpolation=cv2.INTER_AREA) if scale < 1 else image
    return cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), scale


def colour_signature(image: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(cv2.resize(image, (160, 90), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, [16, 8], [0, 180, 0, 256])  # coarse bins: robust to codec colour shifts
    return cv2.normalize(hist, hist).flatten()


def is_scene_cut(prev_sig: np.ndarray, sig: np.ndarray, threshold: float = 0.55) -> bool:
    return float(cv2.compareHist(prev_sig.astype(np.float32), sig.astype(np.float32), cv2.HISTCMP_CORREL)) < threshold


class CutDetector:
    """Hard cuts between camera shots.

    A cut is a colour change (histogram correlation below `hist_threshold`), or a SUDDEN jump in the mean grey
    difference of a 64x36 thumbnail that the previous frame did not have. Grass-dominated cuts barely change the
    colour histogram; fast pans raise the difference for many frames in a row and are not cuts.
    """

    def __init__(self, hist_threshold: float = 0.55, diff_threshold: float = 28.0, calm_threshold: float = 15.0):
        self.hist_threshold, self.diff_threshold, self.calm_threshold = hist_threshold, diff_threshold, calm_threshold
        self._sig = self._small = None
        self._diff = 0.0

    def update(self, image: np.ndarray) -> bool:
        sig = colour_signature(image)
        small = cv2.resize(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), (64, 36), interpolation=cv2.INTER_AREA).astype(np.float32)
        cut = False
        diff = 0.0
        if self._sig is not None:
            diff = float(np.abs(small - self._small).mean())
            cut = is_scene_cut(self._sig, sig, self.hist_threshold) or (diff > self.diff_threshold and self._diff < self.calm_threshold)
        self._sig, self._small, self._diff = sig, small, diff
        return cut


def estimate_motion(
    prev_gray: np.ndarray,
    gray: np.ndarray,
    exclude_boxes: np.ndarray | None = None,
    scale: float = 1.0,
    min_inliers: int = 25,
) -> tuple[np.ndarray | None, int]:
    """Homography mapping PREVIOUS-frame pixels to CURRENT-frame pixels (full resolution), or None.

    Players are masked out (they move on their own); RANSAC rejects the rest of the independent motion
    (e.g. static broadcast graphics when the camera pans).
    """
    mask = np.full(prev_gray.shape, 255, np.uint8)
    if exclude_boxes is not None:
        for x1, y1, x2, y2 in exclude_boxes:
            pad = 0.15 * (y2 - y1)
            cv2.rectangle(mask, (int((x1 - pad) * scale), int((y1 - pad) * scale)), (int((x2 + pad) * scale), int((y2 + pad) * scale)), 0, -1)
    pts = cv2.goodFeaturesToTrack(prev_gray, maxCorners=500, qualityLevel=0.01, minDistance=7, mask=mask)
    if pts is None or len(pts) < min_inliers:
        return None, 0
    nxt, st, _ = cv2.calcOpticalFlowPyrLK(prev_gray, gray, pts, None, winSize=(21, 21), maxLevel=3)
    back, st2, _ = cv2.calcOpticalFlowPyrLK(gray, prev_gray, nxt, None, winSize=(21, 21), maxLevel=3)
    good = (st.ravel() == 1) & (st2.ravel() == 1) & (np.linalg.norm((back - pts).reshape(-1, 2), axis=1) < 1.0)
    p0, p1 = pts.reshape(-1, 2)[good], nxt.reshape(-1, 2)[good]
    if len(p0) < min_inliers:
        return None, int(len(p0))
    M, inl = cv2.findHomography(p0, p1, cv2.RANSAC, 1.5)
    if M is None or inl is None or int(inl.sum()) < min_inliers:
        return None, 0 if inl is None else int(inl.sum())
    S = np.diag([scale, scale, 1.0])
    return np.linalg.inv(S) @ M @ S, int(inl.sum())


def chain_to_reference(motions: list[np.ndarray | None], cuts: list[bool]) -> tuple[list[np.ndarray], list[int]]:
    """Per frame: T_f mapping frame-f pixels to the pixels of its shot's FIRST frame, and the shot index.

    `motions[f]` maps frame f-1 -> f (None when unknown). A cut or an unknown motion starts a new shot.
    """
    T: list[np.ndarray] = []
    shots: list[int] = []
    shot = -1
    for f, (m, cut) in enumerate(zip(motions, cuts)):
        if f == 0 or cut or m is None:
            shot += 1
            T.append(np.eye(3))
        else:
            T.append(T[-1] @ np.linalg.inv(m))
        shots.append(shot)
    return T, shots


# --- homography fitting and checks ------------------------------------------------------------

def _apply(H: np.ndarray, pts: np.ndarray) -> np.ndarray:
    p = np.c_[pts, np.ones(len(pts))] @ H.T
    return p[:, :2] / p[:, 2:3]


def _non_collinear(points: np.ndarray, min_area_m2: float = 40.0) -> bool:
    uniq = np.unique(np.round(points, 3), axis=0)
    if len(uniq) < 4:
        return False
    hull = cv2.convexHull(uniq.astype(np.float32))
    return float(cv2.contourArea(hull)) >= min_area_m2


def plausible(H: np.ndarray, width: int, height: int) -> bool:
    """Camera-geometry sanity check for an image->pitch homography.

    The whole pitch plane must lie in front of the camera: mapping a grid over the pitch back into the image,
    the projective denominator must keep one sign (the horizon does not cross the pitch). We also require the
    visible image to cover a sensible part of the pitch: the image centre must map near the pitch.
    """
    try:
        Hinv = np.linalg.inv(H)
    except np.linalg.LinAlgError:
        return False
    xs, ys = np.meshgrid(np.linspace(0, LENGTH, 11), np.linspace(0, WIDTH, 7))
    pts = np.c_[xs.ravel(), ys.ravel(), np.ones(xs.size)]
    w = pts @ Hinv[2]
    if not (np.all(w > 0) or np.all(w < 0)):
        return False
    c = H @ np.array([width / 2.0, height / 2.0, 1.0])
    if abs(c[2]) < 1e-12:
        return False
    cx, cy = c[0] / c[2], c[1] / c[2]
    return bool(-0.5 * LENGTH < cx < 1.5 * LENGTH and -0.5 * WIDTH < cy < 1.5 * WIDTH)


@dataclass
class Fit:
    H: np.ndarray
    error_m: float  # median leave-one-landmark-out error, metres
    landmarks: int  # distinct landmarks among the inliers
    observations: int


def fit_landmarks(img_pts: np.ndarray, pitch_pts: np.ndarray, landmark_ids: np.ndarray, ransac_m: float) -> Fit | None:
    """Robust homography image->pitch from (possibly repeated) landmark observations, with honest error."""
    if len(img_pts) < 4 or len(np.unique(landmark_ids)) < 4:
        return None
    H, inl = cv2.findHomography(img_pts.astype(np.float64), pitch_pts.astype(np.float64), cv2.RANSAC, ransac_m)
    if H is None or inl is None:
        return None
    inl = inl.ravel().astype(bool)
    ids = np.unique(landmark_ids[inl])
    if len(ids) < 4 or not _non_collinear(pitch_pts[inl]):
        return None
    H, _ = cv2.findHomography(img_pts[inl], pitch_pts[inl], 0)  # refit on the inliers
    if H is None:
        return None
    errors = []
    for lid in ids:  # leave each LANDMARK out entirely and predict it from the others
        keep = inl & (landmark_ids != lid)
        held = inl & (landmark_ids == lid)
        if len(np.unique(landmark_ids[keep])) < 4 or not _non_collinear(pitch_pts[keep]):
            continue
        H_loo, _ = cv2.findHomography(img_pts[keep], pitch_pts[keep], 0)
        if H_loo is None:
            continue
        errors.append(float(np.median(np.linalg.norm(_apply(H_loo, img_pts[held]) - pitch_pts[held], axis=1))))
    if len(errors) < 3:
        return None
    return Fit(H, float(np.median(errors)), int(len(ids)), int(inl.sum()))


@dataclass
class FrameCalibration:
    H: np.ndarray | None  # image pixels -> pitch metres
    source: str  # "keypoints" | "propagated" | "manual" | "none"
    error_m: float | None
    landmarks: int
    shot: int


def calibrate_from_keypoints(
    keypoints: list[Keypoints | None],
    T: list[np.ndarray],
    shots: list[int],
    width: int,
    height: int,
    keypoint_conf: float,
    window: int,
    ransac_m: float,
    max_error_m: float,
    min_landmarks: int,
) -> list[FrameCalibration]:
    n = len(keypoints)
    out: list[FrameCalibration] = []
    for f in range(n):
        lo, hi = max(0, f - window), min(n, f + window + 1)
        T_f_inv = np.linalg.inv(T[f])
        src, dst, ids = [], [], []
        for g in range(lo, hi):
            kp = keypoints[g]
            if kp is None or shots[g] != shots[f]:
                continue
            good = np.where(kp.confidence > keypoint_conf)[0]
            if len(good) == 0:
                continue
            carry = T_f_inv @ T[g]  # frame g pixels -> frame f pixels
            src.append(_apply(carry, kp.xy[good]))
            dst.append(_TEMPLATE[good])
            ids.append(good)
        fit = None
        if src:
            fit = fit_landmarks(np.concatenate(src), np.concatenate(dst), np.concatenate(ids), ransac_m)
        if fit and fit.landmarks >= min_landmarks and fit.error_m <= max_error_m and plausible(fit.H, width, height):
            out.append(FrameCalibration(fit.H, "keypoints", fit.error_m, fit.landmarks, shots[f]))
        else:
            out.append(FrameCalibration(None, "none", fit.error_m if fit else None, fit.landmarks if fit else 0, shots[f]))
    return out


def calibrate_from_manual(
    image_points: np.ndarray, pitch_points_m: np.ndarray, reference_frame: int, T: list[np.ndarray], shots: list[int], width: int, height: int
) -> tuple[list[FrameCalibration], float | None]:
    """Manual correspondences (>= 4, non-collinear) on one frame, carried through its shot by camera motion."""
    if len(image_points) < 4:
        raise ValueError("At least 4 landmark correspondences are needed.")
    if not _non_collinear(pitch_points_m, min_area_m2=10.0):
        raise ValueError("The landmarks are (nearly) on one line; choose points spread over the visible pitch.")
    H_ref, _ = cv2.findHomography(image_points.astype(np.float64), pitch_points_m.astype(np.float64), 0)
    if H_ref is None:
        raise ValueError("No homography fits these correspondences.")
    error = None
    if len(image_points) >= 5:
        errs = []
        for i in range(len(image_points)):
            keep = np.arange(len(image_points)) != i
            H_i, _ = cv2.findHomography(image_points[keep], pitch_points_m[keep], 0)
            if H_i is not None:
                errs.append(float(np.linalg.norm(_apply(H_i, image_points[i : i + 1])[0] - pitch_points_m[i])))
        error = float(np.median(errs)) if errs else None
    ref_shot = shots[reference_frame]
    T_ref_inv = np.linalg.inv(T[reference_frame])
    out = []
    for f in range(len(T)):
        if shots[f] != ref_shot:
            out.append(FrameCalibration(None, "none", None, 0, shots[f]))
            continue
        H = H_ref @ T_ref_inv @ T[f]
        out.append(FrameCalibration(H if plausible(H, width, height) else None, "manual" if plausible(H, width, height) else "none", error, len(image_points), shots[f]))
    return out, error


def project(H: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """Image pixels -> pitch metres."""
    return _apply(H, np.asarray(pts, np.float64).reshape(-1, 2))


def propagate(
    calib: list[FrameCalibration],
    T: list[np.ndarray],
    shots: list[int],
    keypoints: list[Keypoints | None],
    width: int,
    height: int,
    keypoint_conf: float,
    max_gap_frames: int,
    max_check_error_m: float,
) -> list[FrameCalibration]:
    """Fills short uncalibrated stretches from the nearest calibrated frame of the same shot via camera motion.

    Propagated frames are labelled "propagated" with the distance in frames; a propagated homography is rejected
    when the frame's own confident keypoints disagree with it by more than `max_check_error_m` (median).
    """
    out = list(calib)
    n = len(calib)
    anchors = [i for i, c in enumerate(calib) if c.H is not None]
    if not anchors:
        return out
    for f in range(n):
        if calib[f].H is not None:
            continue
        best = None
        for a in anchors:
            if shots[a] != shots[f] or abs(a - f) > max_gap_frames:
                continue
            if best is None or abs(a - f) < abs(best - f):
                best = a
        if best is None:
            continue
        H = calib[best].H @ np.linalg.inv(T[best]) @ T[f]
        if not plausible(H, width, height):
            continue
        kp = keypoints[f]
        check = None
        if kp is not None:
            good = np.where(kp.confidence > keypoint_conf)[0]
            if len(good) >= 3:
                check = float(np.median(np.linalg.norm(_apply(H, kp.xy[good]) - _TEMPLATE[good], axis=1)))
                if check > max_check_error_m:
                    continue
        err = calib[best].error_m
        out[f] = FrameCalibration(H, "propagated", err if check is None else max(err or 0.0, check), calib[best].landmarks, shots[f])
        out[f].from_frame = best  # type: ignore[attr-defined]
    return out
