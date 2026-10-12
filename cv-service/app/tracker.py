"""Multi-object tracking: ByteTrack (Roboflow `trackers`, Apache-2.0) for people, a gated nearest-candidate tracker for the ball."""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

import numpy as np

from .detector import PERSON_CLASSES, Detections, iou


@dataclass
class TrackedFrame:
    """People with tracker ids, and at most one ball, for one processed frame."""

    xyxy: np.ndarray  # (N, 4)
    confidence: np.ndarray  # (N,)
    cls: np.ndarray  # (N,) class names
    tracker_id: np.ndarray  # (N,) int
    ball_xyxy: np.ndarray | None = None
    ball_confidence: float | None = None


class PeopleTracker:
    """Associates player/goalkeeper/referee detections across frames. Tracker ids are NOT shirt numbers."""

    def __init__(self, fps: float, activation: float, buffer_frames: int, min_iou: float, min_frames: int, motion_compensated: bool,
                 similarity: str = "giou"):
        import supervision as sv
        from trackers import DIoU, GIoU, ByteTrackTracker

        metric = {"giou": GIoU(), "diou": DIoU()}.get(similarity)
        self._sv = sv
        self._class_ids = {name: i for i, name in enumerate(PERSON_CLASSES)}
        self.last_assigned = np.zeros((0,), int)  # indices of the input detections the last update assigned to tracks
        self.tracker = ByteTrackTracker(
            lost_track_buffer=buffer_frames,
            frame_rate=fps,
            track_activation_threshold=activation,
            minimum_consecutive_frames=min_frames,
            minimum_iou_threshold=min_iou,
            iou=metric,
        )
        self.params = {
            "algorithm": "ByteTrack",
            "implementation": "trackers (Roboflow, Apache-2.0)",
            "lostTrackBufferFrames": buffer_frames,
            "activationThreshold": activation,
            "minimumConsecutiveFrames": min_frames,
            "similarity": similarity if metric is not None else "iou",
            "minimumSimilarity": min_iou,
            "cameraMotionCompensation": motion_compensated,
        }

    def update(self, people: Detections, to_stable: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """Assigns ids. With `to_stable` (3x3, frame -> stabilised image) association runs in camera-motion-
        compensated coordinates, so pans and zooms do not break IoU matching; returned boxes are the originals."""
        sv = self._sv
        boxes = people.xyxy.astype(np.float32)
        if to_stable is not None and len(people):
            boxes = stabilise_boxes(boxes, to_stable)
        if len(people) == 0:
            det = sv.Detections.empty()
        else:
            det = sv.Detections(
                xyxy=boxes,
                confidence=people.confidence.astype(np.float32),
                class_id=np.array([self._class_ids[c] for c in people.cls], int),
            )
        out = self.tracker.update(det)
        if out.tracker_id is None or len(out) == 0:
            self.last_assigned = np.zeros((0,), int)
            return np.zeros((0, 4), np.float32), np.zeros((0,), np.float32), np.zeros((0,), object), np.zeros((0,), int)
        keep = out.tracker_id >= 0  # unconfirmed tracks carry -1
        # The tracker returns (a subset of) our input boxes; map each back to the original detection.
        idx = [int(np.argmin(np.abs(boxes - row).sum(axis=1))) for row in out.xyxy[keep]]
        self.last_assigned = np.array(idx, int)
        names = people.cls[idx] if idx else np.zeros((0,), object)
        return people.xyxy[idx].astype(np.float32), people.confidence[idx].astype(np.float32), names, out.tracker_id[keep].astype(int)


def backfill_match(track_box: np.ndarray, candidates: np.ndarray, min_iou: float = 0.3) -> int | None:
    """Which of a previous frame's unassigned detections (motion-compensated boxes) started a newly confirmed track.

    ByteTrack confirms a track only after `minimum_consecutive_frames`; the detections it was built from are real but
    were reported as unconfirmed. They are recovered by best IoU with the track's box (same shot, stabilised
    coordinates), and only when that IoU is clearly sufficient. Deterministic; returns None when nothing matches."""
    if len(candidates) == 0:
        return None
    overlaps = iou(track_box[None, :].astype(np.float32), candidates.astype(np.float32))[0]
    best = int(np.argmax(overlaps))
    return best if overlaps[best] >= min_iou else None


@dataclass
class BallTracker:
    """Picks at most one ball per frame: the most confident candidate that is consistent with recent motion.

    Deterministic and deliberately conservative: when nothing plausible is detected the ball is MISSING for that
    frame (no prediction is invented here; short gaps are bridged later and marked as interpolated).
    """

    max_jump_px_per_frame: float
    max_coast_frames: int = 10
    _last: np.ndarray | None = field(default=None, init=False)
    _velocity: np.ndarray = field(default_factory=lambda: np.zeros(2), init=False)
    _since_seen: int = field(default=0, init=False)

    def update(self, balls: Detections) -> tuple[np.ndarray | None, float | None]:
        if len(balls) == 0:
            self._since_seen += 1
            if self._since_seen > self.max_coast_frames:
                self._last = None
            return None, None
        centres = (balls.xyxy[:, :2] + balls.xyxy[:, 2:]) / 2
        if self._last is None:
            i = int(np.argmax(balls.confidence))
        else:
            predicted = self._last + self._velocity * (self._since_seen + 1)
            dist = np.linalg.norm(centres - predicted, axis=1)
            allowed = self.max_jump_px_per_frame * (self._since_seen + 1)
            ok = np.where(dist <= allowed)[0]
            if len(ok) == 0:
                # Nothing near the predicted path: accept only a very confident detection (a real long pass), else miss.
                strong = np.where(balls.confidence >= 0.6)[0]
                if len(strong) == 0:
                    self._since_seen += 1
                    return None, None
                i = int(strong[np.argmax(balls.confidence[strong])])
            else:
                score = balls.confidence[ok] - 0.1 * dist[ok] / max(allowed, 1e-6)
                i = int(ok[np.argmax(score)])
        c = centres[i]
        if self._last is not None:
            self._velocity = (c - self._last) / (self._since_seen + 1)
        self._last = c
        self._since_seen = 0
        return balls.xyxy[i].copy(), float(balls.confidence[i])


def stabilise_boxes(xyxy: np.ndarray, H: np.ndarray) -> np.ndarray:
    """Axis-aligned boxes after mapping their corners through a homography."""
    corners = np.stack([xyxy[:, [0, 1]], xyxy[:, [2, 1]], xyxy[:, [2, 3]], xyxy[:, [0, 3]]], axis=1).reshape(-1, 2)
    p = np.c_[corners, np.ones(len(corners))] @ H.T
    p = (p[:, :2] / p[:, 2:3]).reshape(-1, 4, 2)
    return np.c_[p[:, :, 0].min(1), p[:, :, 1].min(1), p[:, :, 0].max(1), p[:, :, 1].max(1)].astype(np.float32)


def majority_class(votes: list[str]) -> tuple[str, dict[str, int]]:
    counts = Counter(votes)
    # Ties are broken by the fixed class order so results are deterministic.
    best = sorted(counts.items(), key=lambda kv: (-kv[1], PERSON_CLASSES.index(kv[0])))[0][0]
    return best, dict(counts)


def _apply_point(H: np.ndarray, p: np.ndarray) -> np.ndarray:
    q = H @ np.array([p[0], p[1], 1.0])
    return q[:2] / q[2]


def stitch_tracklets(
    tracks: dict[int, list],  # tracker id -> list of observations with .frame, .xyxy, .cls (time ordered)
    stable: list[np.ndarray],  # per frame: frame pixels -> stabilised image of the shot
    shot_of_frame: list[int],
    colours: dict[int, list[np.ndarray]],
    max_gap_frames: int = 25,
    max_cost: float = 1.2,
    max_colour_distance: float = 30.0,
) -> dict[int, list[int]]:
    """Links fragments of the same person: track B starts shortly after track A ends, close to where A was heading.

    Positions are compared in the stabilised (camera-motion-compensated) image and normalised by the person's box
    height, so the test does not depend on zoom. Both must be in the same shot, have compatible classes (a referee
    never joins a player), and similar shirt colours. Greedy one-to-one matching by increasing cost. Returns
    {surviving id: [ids merged into it, in time order]} for every merge made; ids that were not merged are absent.
    """
    def foot(o):
        return np.array([(o.xyxy[0] + o.xyxy[2]) / 2.0, o.xyxy[3]])

    info = {}
    for tid, obs in tracks.items():
        if not obs:
            continue
        first, last = obs[0], obs[-1]
        tail = obs[-6:]
        p_end = _apply_point(stable[last.frame], foot(last))
        v = np.zeros(2)
        if len(tail) >= 2 and tail[-1].frame > tail[0].frame:
            p0 = _apply_point(stable[tail[0].frame], foot(tail[0]))
            v = (p_end - p0) / (tail[-1].frame - tail[0].frame)
        majority, _ = majority_class([o.cls for o in obs])
        col = np.median(np.array(colours[tid]), axis=0) if colours.get(tid) else None
        info[tid] = {
            "start": first.frame, "end": last.frame, "cls": majority, "colour": col, "v": v, "p_end": p_end,
            "p_start": _apply_point(stable[first.frame], foot(first)),
            "h_end": float(last.xyxy[3] - last.xyxy[1]), "h_start": float(first.xyxy[3] - first.xyxy[1]),
        }
    candidates = []
    for a, A in info.items():
        for b, B in info.items():
            gap = B["start"] - A["end"]
            if a == b or gap <= 0 or gap > max_gap_frames or shot_of_frame[A["end"]] != shot_of_frame[B["start"]]:
                continue
            if (A["cls"] == "referee") != (B["cls"] == "referee"):
                continue
            if A["colour"] is not None and B["colour"] is not None and np.linalg.norm(A["colour"] - B["colour"]) > max_colour_distance:
                continue
            speed = float(np.linalg.norm(A["v"]))
            cap = 0.25 * max(A["h_end"], 1.0)  # at most a quarter of a body height per frame
            v = A["v"] if speed <= cap else A["v"] * cap / speed
            predicted = A["p_end"] + v * gap
            scale = max((A["h_end"] + B["h_start"]) / 2.0, 1.0)
            cost = float(np.linalg.norm(B["p_start"] - predicted)) / scale / (1.0 + 0.04 * gap)
            if cost <= max_cost:
                candidates.append((cost, a, b))
    candidates.sort()
    successor: dict[int, int] = {}
    predecessor: dict[int, int] = {}
    for cost, a, b in candidates:
        if a in successor or b in predecessor:
            continue
        # Never create overlaps: b must start after the WHOLE chain ending in a.
        successor[a] = b
        predecessor[b] = a
    chains: dict[int, list[int]] = {}
    for tid in info:
        if tid in predecessor:
            continue
        chain = [tid]
        while chain[-1] in successor:
            chain.append(successor[chain[-1]])
        if len(chain) > 1:
            chains[tid] = chain[1:]
    return chains
