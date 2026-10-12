"""REAL models on a REAL clip. Skipped unless the weights are installed and a clip is available.

    CV_TEST_CLIP=../test_clip.mp4 CV_TEST_START=147.2 uv run pytest -m integration -s
"""
import os
from pathlib import Path

import pytest

from app.config import Settings
from app.processing import AnalyzeRequest, analyze
from app.schemas import TrackingResult

CLIP = Path(os.environ.get("CV_TEST_CLIP", Path(__file__).resolve().parents[2] / "test_clip.mp4"))
START = float(os.environ.get("CV_TEST_START", "147.2"))
DURATION = float(os.environ.get("CV_TEST_DURATION", "2.0"))

pytestmark = pytest.mark.integration


@pytest.mark.skipif(bool(Settings().missing_models()) or not CLIP.is_file(), reason="needs model weights (scripts/download_models.sh) and a clip")
def test_real_models_detect_track_and_produce_a_valid_result():
    result = analyze(AnalyzeRequest(CLIP, START, DURATION, CLIP.name), Settings())
    TrackingResult.model_validate(result)
    people = [t for t in result["tracks"] if t["objectType"] in ("player", "goalkeeper", "referee")]
    assert people, "the detector found no people"
    longest = max(len(t["observations"]["frame"]) for t in people)
    assert longest >= 0.5 * result["segment"]["processedFrames"], "no track persisted for half the segment"
    print(f"\nreal run: {len(people)} people tracks, longest {longest} frames, calibration {result['calibration']['framesCalibrated']}/{result['calibration']['framesTotal']}, "
          f"timings {result['timingsMs']}")
