import cv2
import numpy as np
import pytest

from app import pitch_calibration as pc
from app.detector import Keypoints
from app.pitch import LENGTH, WIDTH, keypoint_template, metres_to_dizpitch
from app.trajectory import to_dizpitch
from tests.synthetic import H_IMG, W_IMG, apply, camera


def test_template_matches_dizpitch_frame():
    t = keypoint_template()
    assert t.shape == (32, 2)
    assert tuple(t[0]) == (0, 0) and tuple(t[29]) == (LENGTH, WIDTH)  # corners 1 and 30
    assert tuple(t[8]) == (11.0, WIDTH / 2)  # left penalty spot
    assert t[10][1] == pytest.approx(WIDTH / 2 - 7.312, abs=1e-3)  # penalty arc meets the box line
    assert metres_to_dizpitch(52.5, 34) == (50.0, 50.0)


def test_to_dizpitch_converts_clamps_and_rejects():
    H = np.eye(3)  # "image" already in metres
    assert to_dizpitch(H, np.array([52.5, 34.0])) == [50.0, 50.0]
    assert to_dizpitch(H, np.array([-2.0, 70.0])) == [0.0, 100.0]  # just over the lines: clamped
    assert to_dizpitch(H, np.array([-10.0, 34.0])) is None  # clearly off the pitch: unmappable
    assert to_dizpitch(None, np.array([1.0, 1.0])) is None


def test_fit_recovers_known_camera_and_reports_small_error():
    H_true = camera(0.0)
    tpl = keypoint_template()
    img = apply(H_true, tpl)
    inside = (img[:, 0] > 0) & (img[:, 0] < W_IMG) & (img[:, 1] > 0) & (img[:, 1] < H_IMG)
    fit = pc.fit_landmarks(img[inside], tpl[inside], np.where(inside)[0], ransac_m=1.5)
    assert fit is not None and fit.landmarks >= 6
    assert fit.error_m < 0.01
    probe = np.array([[320.0, 300.0]])
    assert np.allclose(pc.project(fit.H, probe), apply(np.linalg.inv(H_true), probe), atol=1e-3)
    assert pc.plausible(fit.H, W_IMG, H_IMG)


def test_fit_rejects_collinear_landmarks():
    tpl = keypoint_template()
    on_goal_line = [0, 1, 2, 3, 4, 5]  # all on x = 0
    img = apply(camera(0), tpl[on_goal_line])
    assert pc.fit_landmarks(img, tpl[on_goal_line], np.array(on_goal_line), 1.5) is None


def test_outlier_landmark_is_rejected_by_ransac():
    H_true = camera(0.0)
    tpl = keypoint_template()
    img = apply(H_true, tpl)
    ids = np.where((img[:, 0] > 0) & (img[:, 0] < W_IMG) & (img[:, 1] > 0) & (img[:, 1] < H_IMG))[0]
    pts = img[ids].copy()
    pts[0] += [40, -30]  # one badly placed keypoint
    fit = pc.fit_landmarks(pts, tpl[ids], ids, 1.5)
    assert fit is not None and fit.error_m < 0.05


def test_plausibility_rejects_a_horizon_through_the_pitch():
    # Maps the image so that the pitch's far half lies "behind" the camera.
    H_bad = np.array([[1, 0, 0], [0, 1, 0], [0, 0.02, -0.5]], float)
    assert not pc.plausible(H_bad, W_IMG, H_IMG)


def test_camera_motion_is_recovered_from_texture():
    rng = np.random.default_rng(1)
    base = cv2.GaussianBlur(rng.integers(0, 255, (360, 640)).astype(np.uint8), (5, 5), 0)
    M_true = np.array([[1.01, 0.002, 6.0], [-0.001, 1.01, -3.0], [0, 0, 1]])
    moved = cv2.warpPerspective(base, M_true, (640, 360))
    M, inliers = pc.estimate_motion(base, moved)
    assert M is not None and inliers > 100
    probe = np.array([[320.0, 180.0], [100.0, 300.0]])
    assert np.allclose(apply(M, probe), apply(M_true, probe), atol=0.5)


def test_motion_ignores_masked_players():
    rng = np.random.default_rng(2)
    base = cv2.GaussianBlur(rng.integers(0, 255, (360, 640)).astype(np.uint8), (5, 5), 0)
    moved = np.roll(base, 4, axis=1)  # camera pan of 4 px
    # A large textured "player" that moves the other way, inside a box we exclude.
    patch = rng.integers(0, 255, (120, 80)).astype(np.uint8)
    base[100:220, 300:380] = patch
    moved[100:220, 290:370] = patch
    M, _ = pc.estimate_motion(base, moved, exclude_boxes=np.array([[280, 90, 390, 230]]))
    assert M is not None
    assert apply(M, [[50, 50]])[0][0] == pytest.approx(54, abs=0.6)


def test_chain_to_reference_breaks_on_cuts_and_unknown_motion():
    shift = np.array([[1, 0, 5], [0, 1, 0], [0, 0, 1.0]])
    T, shots = pc.chain_to_reference([None, shift, shift, None, shift], [False, False, False, False, True])
    assert shots == [0, 0, 0, 1, 2]
    assert np.allclose(apply(T[2], [[100, 100]]), [[90, 100]])  # frame 2 -> frame 0 undoes two pans


def test_calibration_from_keypoints_pools_and_follows_a_pan():
    fps = 25.0
    n = 20
    Ts, shots, kps = [], [], []
    for i in range(n):
        H_i = camera(i / fps)
        Ts.append(camera(0) @ np.linalg.inv(H_i))  # frame i pixels -> frame 0 pixels (via the pitch)
        shots.append(0)
        xy = apply(H_i, keypoint_template())
        inside = (xy[:, 0] > 0) & (xy[:, 0] < W_IMG) & (xy[:, 1] > 0) & (xy[:, 1] < H_IMG)
        conf = np.where(inside, 0.9, 0.0)
        if i % 3:  # most frames see only 3 keypoints: pooling must fill in
            keep = np.where(inside)[0][:3]
            conf = np.zeros(32)
            conf[keep] = 0.9
        kps.append(Keypoints(xy, conf))
    calib = pc.calibrate_from_keypoints(kps, Ts, shots, W_IMG, H_IMG, 0.5, 6, 1.5, 0.8, 6)
    assert all(c.H is not None for c in calib)
    for i in (0, 7, 19):
        probe = np.array([[320.0, 330.0]])
        assert np.allclose(pc.project(calib[i].H, probe), apply(np.linalg.inv(camera(i / fps)), probe), atol=0.05)


def test_manual_calibration_with_four_points_and_errors():
    H_true = camera(0)
    pitch_pts = np.array([[52.5, 34 - 9.15], [52.5, 34 + 9.15], [43.35, 34], [61.65, 34], [52.5, 68]])
    img = apply(H_true, pitch_pts)
    T = [np.eye(3)] * 3
    calib, err = pc.calibrate_from_manual(img, pitch_pts, 0, T, [0, 0, 1], W_IMG, H_IMG)
    assert err is not None and err < 0.01
    assert calib[0].source == "manual" and calib[1].source == "manual"
    assert calib[2].H is None  # another shot: not carried across a cut
    with pytest.raises(ValueError):
        pc.calibrate_from_manual(img[:3], pitch_pts[:3], 0, T, [0, 0, 1], W_IMG, H_IMG)
    with pytest.raises(ValueError):
        line = np.array([[0, 10], [0, 20], [0, 30], [0, 40.0]])
        pc.calibrate_from_manual(apply(H_true, line), line, 0, T, [0, 0, 1], W_IMG, H_IMG)


def test_propagation_fills_short_gaps_and_is_checked():
    H0 = np.linalg.inv(camera(0))
    T = [np.eye(3)] * 4
    calib = [pc.FrameCalibration(H0, "keypoints", 0.3, 8, 0)] + [pc.FrameCalibration(None, "none", None, 0, 0)] * 3
    kp_wrong = Keypoints(apply(camera(0), keypoint_template()) + 50, np.full(32, 0.9))  # disagrees strongly
    out = pc.propagate(calib, T, [0, 0, 0, 0], [None, None, kp_wrong, None], W_IMG, H_IMG, 0.5, 2, 1.5)
    assert [c.source for c in out] == ["keypoints", "propagated", "none", "none"]  # frame 2 rejected, frame 3 too far
    assert getattr(out[1], "from_frame") == 0


def test_cut_detector_flags_hard_cuts_not_pans():
    rng = np.random.default_rng(4)
    a = cv2.GaussianBlur(rng.integers(0, 255, (360, 640, 3)).astype(np.uint8), (9, 9), 0)
    b = np.full_like(a, (30, 140, 30))
    d = pc.CutDetector()
    assert d.update(a) is False
    assert d.update(np.roll(a, 3, axis=1)) is False  # small pan
    assert d.update(b) is True  # hard cut to a very different picture
