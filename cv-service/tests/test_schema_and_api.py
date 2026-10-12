import json
import time

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.schemas import Observations, TrackingResult


def test_observations_must_align_and_be_ordered():
    ok = dict(frame=[0, 1], bbox=[[0, 0, 1, 1]] * 2, foot=[[0, 0]] * 2, pitch=[None, [1, 2]], confidence=[0.5, None], source=["detected", "interpolated"])
    Observations(**ok)
    with pytest.raises(ValidationError):
        Observations(**{**ok, "pitch": [None]})
    with pytest.raises(ValidationError):
        Observations(**{**ok, "frame": [1, 1]})
    with pytest.raises(ValidationError):
        Observations(**{**ok, "source": ["detected", "guessed"]})


def test_json_schema_is_exportable():
    schema = TrackingResult.model_json_schema()
    assert schema["properties"]["schemaVersion"]["const"] == 1
    json.dumps(schema)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    import dataclasses

    import app.main as main

    monkeypatch.setattr(main, "settings", dataclasses.replace(main.settings, work_dir=tmp_path / "work", models_dir=tmp_path / "models", max_upload_mb=1))
    return TestClient(main.app), main


MP4_HEAD = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00" + b"\x00" * 64


def test_health_reports_missing_models(client):
    c, _ = client
    body = c.get("/health").json()
    assert body["status"] == "models_missing"
    assert set(body["models"]["missing"]) >= {"football-player-detection.pt", "football-pitch-detection.pt"}
    assert body["limits"]["maxSegmentSeconds"] > 0


def test_analyze_without_models_is_a_clear_setup_error(client):
    c, _ = client
    r = c.post("/api/analyze", files={"video": ("a.mp4", MP4_HEAD, "video/mp4")}, data={"startSeconds": "0", "durationSeconds": "8"})
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "models_missing"
    assert "download_models.sh" in r.json()["error"]["message"]


def _models_present(main, tmp_path):
    main.settings.models_dir.mkdir(parents=True, exist_ok=True)
    for n in (main.settings.player_model, main.settings.ball_model, main.settings.pitch_model):
        (main.settings.models_dir / n).write_bytes(b"x")


def test_upload_validation(client, tmp_path):
    c, main = client
    _models_present(main, tmp_path)
    r = c.post("/api/analyze", files={"video": ("a.mp4", b"not a video at all, just text" * 3, "video/mp4")})
    assert r.status_code == 415 and r.json()["error"]["code"] == "unsupported_format"
    r = c.post("/api/analyze", files={"video": ("a.mp4", MP4_HEAD + b"\x00" * (2 * 1024 * 1024), "video/mp4")})
    assert r.status_code == 413
    r = c.post("/api/analyze", files={"video": ("a.mp4", MP4_HEAD, "video/mp4")}, data={"durationSeconds": "999"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "segment_too_long"
    assert not any(main.settings.work_dir.glob("*")) if main.settings.work_dir.exists() else True  # nothing left behind


def test_job_lifecycle_deletes_the_upload(client, tmp_path, monkeypatch):
    c, main = client
    _models_present(main, tmp_path)
    seen = {}

    def fake_analyze(req, settings, progress, cancel):
        seen["path"] = req.video_path
        assert req.video_path.exists()
        assert req.video_path.parent == settings.work_dir and req.video_path.name.endswith(".upload")  # never the client's name
        progress("detecting and tracking", 3, 10)
        return {"schemaVersion": 1, "fake": True}

    monkeypatch.setattr(main, "analyze", fake_analyze)
    r = c.post("/api/analyze", files={"video": ("../../etc/passwd.mp4", MP4_HEAD, "video/mp4")}, data={"startSeconds": "1", "durationSeconds": "2"})
    assert r.status_code == 202
    job = r.json()["jobId"]
    for _ in range(100):
        status = c.get(f"/api/jobs/{job}").json()
        if status["state"] in ("done", "failed"):
            break
        time.sleep(0.02)
    assert status["state"] == "done"
    assert c.get(f"/api/results/{job}").json() == {"schemaVersion": 1, "fake": True}
    assert not seen["path"].exists()  # the uploaded video is deleted when the job ends
    assert c.get("/api/jobs/not-a-job").status_code == 404
    assert c.delete(f"/api/jobs/{job}").json() == {"deleted": True}
    assert c.get(f"/api/jobs/{job}").status_code == 404


def test_failed_job_reports_a_readable_error(client, tmp_path, monkeypatch):
    c, main = client
    _models_present(main, tmp_path)
    from app.video_io import VideoError

    def failing(*_a, **_k):
        raise VideoError("unreadable_video", "The video could not be opened.")

    monkeypatch.setattr(main, "analyze", failing)
    job = c.post("/api/analyze", files={"video": ("a.mp4", MP4_HEAD, "video/mp4")}).json()["jobId"]
    for _ in range(100):
        status = c.get(f"/api/jobs/{job}").json()
        if status["state"] != "queued" and status["state"] != "running":
            break
        time.sleep(0.02)
    assert status["state"] == "failed" and status["error"]["code"] == "unreadable_video"
    assert c.get(f"/api/results/{job}").status_code == 409


def test_exported_json_schema_is_current():
    """schema/tracking-result.v1.schema.json must match the pydantic model (regenerate with scripts/export_schema.py)."""
    import importlib.util
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location("export_schema", root / "scripts" / "export_schema.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert (root / "schema" / "tracking-result.v1.schema.json").read_text() == module.schema_text()
