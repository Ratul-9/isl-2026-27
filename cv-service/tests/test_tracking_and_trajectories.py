import numpy as np

from app.detector import Detections, iou, merge_ball_candidates
from app.pitch_calibration import FrameCalibration
from app.team_assignment import cluster_teams, shirt_colour
from app.tracker import BallTracker, PeopleTracker, majority_class, stabilise_boxes, stitch_tracklets
from app.trajectory import PersonObservation, TrackBuilder, ball_track, person_track


def dets(boxes, cls="player", conf=0.9):
    boxes = np.array(boxes, np.float32).reshape(-1, 4)
    return Detections(boxes, np.full(len(boxes), conf, np.float32), np.array([cls] * len(boxes), object))


def test_iou_and_ball_merge():
    a = np.array([[0, 0, 10, 10]], np.float32)
    assert iou(a, a)[0, 0] == 1.0
    assert iou(a, np.array([[20, 20, 30, 30]], np.float32))[0, 0] == 0.0
    people = Detections(np.array([[0, 0, 4, 4], [50, 50, 60, 80]], np.float32), np.array([0.5, 0.9], np.float32), np.array(["ball", "player"], object))
    balls = Detections(np.array([[0.5, 0.5, 4.5, 4.5], [100, 100, 104, 104]], np.float32), np.array([0.7, 0.3], np.float32), np.array(["ball", "ball"], object))
    merged = merge_ball_candidates(people, balls)
    assert len(merged) == 2 and merged.confidence.max() == np.float32(0.7)  # duplicate removed, best kept


def test_people_tracker_keeps_ids_for_moving_boxes_and_after_a_short_miss():
    tracker = PeopleTracker(25, 0.3, 30, -0.5, 2, True)
    ids_seen = []
    for f in range(30):
        boxes = [[10 + 2 * f, 100, 30 + 2 * f, 150], [300 - f, 100, 320 - f, 150]]
        if f == 15:
            boxes = boxes[:1]  # second player missed for one frame
        _, _, _, ids = tracker.update(dets(boxes))
        ids_seen.append(tuple(sorted(ids.tolist())))
    confirmed = [s for s in ids_seen if len(s) == 2]
    assert len(set(confirmed)) == 1  # same two ids throughout


def test_motion_compensated_tracking_survives_a_fast_pan():
    tracker = PeopleTracker(25, 0.3, 30, -0.5, 2, True)
    stable = np.eye(3)
    ids = set()
    for f in range(20):
        pan = 30.0 * f  # the camera pans 30 px per frame: boxes jump in the image but not on the pitch
        boxes = [[200 - pan, 100, 220 - pan, 150]]
        stable_f = np.array([[1, 0, pan], [0, 1, 0], [0, 0, 1.0]])
        _, _, _, out = tracker.update(dets(boxes), stable_f)
        ids.update(out.tolist())
    assert len(ids) == 1


def test_stabilise_boxes():
    H = np.array([[2, 0, 10], [0, 2, 0], [0, 0, 1.0]])
    assert np.allclose(stabilise_boxes(np.array([[0, 0, 5, 5]], np.float32), H), [[10, 0, 20, 10]])


def test_ball_tracker_gates_jumps_and_reports_misses():
    bt = BallTracker(max_jump_px_per_frame=20)
    assert bt.update(dets([[100, 100, 104, 104]], "ball", 0.5))[0] is not None
    box, _ = bt.update(dets([[105, 100, 109, 104], [400, 300, 404, 304]], "ball", 0.5))
    assert box[0] == 105  # the far-away weak candidate is ignored
    assert bt.update(Detections.empty()) == (None, None)  # missing stays missing
    box, _ = bt.update(dets([[600, 400, 604, 404]], "ball", 0.3))
    assert box is None  # implausible jump with low confidence


def test_majority_class_is_deterministic():
    assert majority_class(["player", "referee", "player"])[0] == "player"
    assert majority_class(["referee", "player"])[0] == "player"  # tie -> fixed class order


def _obs(frames, x0, dx, cls="player"):
    return [PersonObservation(f, np.array([x0 + dx * (f - frames[0]), 100, x0 + dx * (f - frames[0]) + 20, 160], float), 0.9, cls) for f in frames]


def test_stitching_joins_a_fragment_where_the_player_was_heading():
    stable = [np.eye(3)] * 60
    tracks = {1: _obs(range(0, 20), 100, 3), 2: _obs(range(26, 50), 100 + 3 * 26, 3), 3: _obs(range(26, 50), 400, 0)}
    chains = stitch_tracklets(tracks, stable, [0] * 60, {})
    assert chains == {1: [2]}


def test_stitching_refuses_referee_player_mixes_cuts_and_far_jumps():
    stable = [np.eye(3)] * 60
    ref = {1: _obs(range(0, 20), 100, 3), 2: _obs(range(24, 40), 172, 3, cls="referee")}
    assert stitch_tracklets(ref, stable, [0] * 60, {}) == {}
    cut = {1: _obs(range(0, 20), 100, 3), 2: _obs(range(24, 40), 172, 3)}
    assert stitch_tracklets(cut, stable, [0] * 22 + [1] * 38, {}) == {}
    far = {1: _obs(range(0, 20), 100, 3), 2: _obs(range(24, 40), 600, 3)}
    assert stitch_tracklets(far, stable, [0] * 60, {}) == {}
    colours = {1: [np.array([250, 128, 128])] * 5, 2: [np.array([60, 170, 160])] * 5}
    near = {1: _obs(range(0, 20), 100, 3), 2: _obs(range(24, 40), 172, 3)}
    assert stitch_tracklets(near, stable, [0] * 60, colours) == {}  # different shirts


def test_person_track_projects_the_foot_point_and_keeps_image_coordinates():
    b = TrackBuilder(7, [PersonObservation(0, np.array([10, 20, 30, 66.0]), 0.8, "player")])
    calib = [FrameCalibration(np.eye(3), "keypoints", 0.2, 8, 0)]
    t = person_track(b, calib, "A", 0.6)
    assert t["observations"]["foot"] == [[20.0, 66.0]]  # bottom centre, not the box centre
    assert t["observations"]["pitch"][0] == [round(20 / 105 * 100, 2), round(66 / 68 * 100, 2)]
    assert t["observations"]["bbox"][0] == [10.0, 20.0, 30.0, 66.0]  # image coordinates kept separately
    assert t["team"] == "A" and t["trackId"] == "t7"


def test_ball_gaps_are_bridged_only_when_short_and_within_a_shot():
    n = 20
    calib = [FrameCalibration(np.eye(3), "keypoints", 0.2, 8, 0) for _ in range(n)]
    T = [np.eye(3)] * n
    balls = [(None, None)] * n
    for f in (0, 3, 13, 15):
        balls[f] = (np.array([f, 10, f + 2, 12.0]), 0.7)
    shots = [0] * 14 + [1] * 6
    track, detected, interp = ball_track(balls, calib, T, shots, max_gap=4)
    src = dict(zip(track["observations"]["frame"], track["observations"]["source"]))
    assert detected == 4 and interp == 2  # 0->3 bridged (2 frames); 3->13 too long; 13->15 crosses a cut
    assert src[1] == "interpolated" and src[2] == "interpolated" and 8 not in src and 14 not in src
    assert all(c is None for c, s in zip(track["observations"]["confidence"], track["observations"]["source"]) if s == "interpolated")


def test_team_clustering_from_shirt_colours():
    rng = np.random.default_rng(0)
    img = np.full((200, 400, 3), (40, 130, 40), np.uint8)
    samples = {}
    for i in range(8):
        colour = (240, 240, 240) if i < 4 else (40, 40, 210)
        x = 20 + 45 * i
        img[60:140, x:x + 30] = colour
        box = np.array([x, 60, x + 30, 140], float)
        samples[i] = [shirt_colour(img, box) + rng.normal(0, 2, 3) for _ in range(4)]
    result = cluster_teams(samples)
    assert {result.assignments[i] for i in range(4)} == {"A"}  # lighter kit is A
    assert {result.assignments[i] for i in range(4, 8)} == {"B"}
    assert [c["id"] for c in result.clusters] == ["A", "B"]
    assert cluster_teams({1: [np.zeros(3)] * 3}).assignments == {1: "unknown"}  # too few tracks: no guessing



def test_backfill_recovers_the_detection_a_new_track_started_from():
    from app.tracker import backfill_match

    track = np.array([100, 100, 120, 150], float)
    candidates = np.array([[300, 100, 320, 150], [102, 101, 122, 152], [101, 99, 119, 149]], float)
    assert backfill_match(track, candidates) == 2  # best overlap wins
    assert backfill_match(track, np.array([[300, 100, 320, 150]], float)) is None  # nothing plausible: no guess
    assert backfill_match(track, np.zeros((0, 4))) is None
