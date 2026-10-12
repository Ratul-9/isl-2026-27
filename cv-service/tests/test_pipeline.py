"""End-to-end pipeline on SYNTHETIC footage with fake models reporting the ground truth.

Proves decoding, timestamps, tracking, camera motion, calibration, projection, interpolation and the result
schema fit together. It does not test the real detector (see test_integration_real.py).
"""
import json
from pathlib import Path

import numpy as np
import pytest

from app.config import Settings
from app.processing import AnalyzeRequest, Models, analyze
from app.schemas import TrackingResult
from app.video_io import VideoError, iter_frames, probe, sniff_container, validate
from tests.synthetic import PLAYERS, FakeDetector, FakeKeypoints, ball_at, write_video


@pytest.fixture(scope="module")
def clip(tmp_path_factory) -> Path:
    path = tmp_path_factory.mktemp("clip") / "synthetic.mp4"
    write_video(path, seconds=2.0)
    return path


def settings(**over) -> Settings:
    base = Settings()
    return Settings(**{**{f: getattr(base, f) for f in base.__dataclass_fields__}, "batch_size": 4, **over})


def test_probe_timestamps_and_segments(clip):
    meta = probe(clip)
    assert (meta.width, meta.height, meta.fps) == (640, 360, 25.0)
    assert meta.frame_count == 50 and meta.duration_s == pytest.approx(2.0)
    frames = list(iter_frames(clip, 0.4, 1.2))
    assert len(frames) == 20
    assert frames[0].timestamp_ms == pytest.approx(400.0) and frames[-1].timestamp_ms == pytest.approx(1160.0)
    assert np.allclose(np.diff([f.timestamp_ms for f in frames]), 40.0)
    assert [f.source_index for f in frames][:2] == [10, 11]
    assert len(list(iter_frames(clip, 0, 2, stride=5))) == 10
    assert sniff_container(clip.read_bytes()[:64]) == "mp4"


def test_validation_limits(clip):
    meta = probe(clip)
    s = settings(max_segment_seconds=1.5)
    validate(meta, s, 0.0, 1.5)
    for start, dur, code in ((0.0, 2.0, "segment_too_long"), (5.0, 1.0, "invalid_segment"), (0.0, 0.0, "invalid_segment")):
        with pytest.raises(VideoError) as e:
            validate(meta, s, start, dur)
        assert e.value.code == code
    with pytest.raises(VideoError) as e:
        validate(meta, settings(max_source_seconds=1.0), 0.0, 0.5)
    assert e.value.code == "video_too_long"


def run(clip, **kw):
    models = Models(FakeDetector(drop_ball=kw.pop("drop_ball", set())), FakeKeypoints(), [{"role": "detector", "name": "fake", "licence": "test"}], "cpu")
    return analyze(AnalyzeRequest(clip, 0.0, 2.0, "synthetic.mp4"), settings(**kw), models=models)


def test_pipeline_tracks_projects_and_calibrates_against_ground_truth(clip):
    result = run(clip, drop_ball={10, 11, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39})
    TrackingResult.model_validate(result)  # the published schema
    assert result["segment"]["processedFrames"] == 50
    cal = result["calibration"]
    assert cal["framesCalibrated"] == 50 and cal["status"] == "calibrated"
    assert len(cal["shots"]) == 1  # a pan is not a cut

    people = [t for t in result["tracks"] if t["objectType"] == "player"]
    assert len(people) == len(PLAYERS)  # one stable track per player despite the pan
    for t in people:
        # Every frame, including the ones before ByteTrack confirmed the track (recovered from its detections).
        assert t["observations"]["frame"] == list(range(50))
    # Projected foot points land on the true pitch positions (DizPitch 0-100), within ~0.3 m.
    errors = []
    for t in people:
        f = t["observations"]["frame"][-1]
        px, py = t["observations"]["pitch"][-1]
        truth = min((p.at(result["frames"]["tMs"][f] / 1000) for p in PLAYERS), key=lambda q: abs(q[0] / 105 * 100 - px) + abs(q[1] / 68 * 100 - py))
        errors.append(np.hypot((px - truth[0] / 105 * 100) * 1.05, (py - truth[1] / 68 * 100) * 0.68))
    assert max(errors) < 0.3

    # Teams: three white, three red.
    assert sorted(t["team"] for t in people) == ["A", "A", "A", "B", "B", "B"]

    ball = next(t for t in result["tracks"] if t["objectType"] == "ball")
    src = dict(zip(ball["observations"]["frame"], ball["observations"]["source"]))
    assert src[10] == "interpolated" and src[11] == "interpolated"  # 2-frame gap bridged
    assert all(f not in src for f in range(30, 40))  # 10-frame gap left missing
    f = 20
    i = ball["observations"]["frame"].index(f)
    bx, by = ball["observations"]["pitch"][i]
    truth = ball_at(result["frames"]["tMs"][f] / 1000)
    assert abs(bx - truth[0] / 105 * 100) < 0.4 and abs(by - truth[1] / 68 * 100) < 0.6
    assert any("10 short gaps" not in w for w in result["warnings"])


def test_result_is_compact_and_json_serialisable(clip):
    result = run(clip)
    text = json.dumps(result)
    assert len(text) < 200_000
    assert "base64" not in text


def test_uncalibrated_frames_are_marked_not_guessed(clip):
    models = Models(FakeDetector(), _NoKeypoints(), [], "cpu")
    result = analyze(AnalyzeRequest(clip, 0.0, 1.0), settings(), models=models)
    assert result["calibration"]["status"] == "unavailable"
    people = [t for t in result["tracks"] if t["objectType"] == "player"]
    assert people and all(p is None for t in people for p in t["observations"]["pitch"])
    assert all(b is not None for t in people for b in t["observations"]["bbox"])  # image tracking still available
    assert any("manual calibration" in w for w in result["warnings"])


class _NoKeypoints:
    def detect(self, frames):
        return [None for _ in frames]
