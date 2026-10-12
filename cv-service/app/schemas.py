"""Versioned tracking result (schemaVersion 1). Also exported as JSON Schema (scripts/export_schema.py).

Conventions
- Frame indices in tracks refer to positions in `frames` (0 .. processedFrames-1), not source frame numbers.
- `frames.tMs` are milliseconds from the segment start, from the decoder's presentation timestamps.
- `bbox`/`foot` are source-image pixels; `pitch` is DizPitch's normalised frame (0-100; x from the left goal
  line as seen by the camera, y from the far touchline) or null when that frame is not calibrated or the point
  falls clearly outside the pitch.
- `source`: "detected" = from the detector in that frame; "interpolated" = a short gap bridged linearly
  (ball only, never longer than the configured gap). Manual corrections are added by the DizPitch editor.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

SCHEMA_VERSION = 1

ObjectType = Literal["player", "goalkeeper", "referee", "ball"]
TeamCluster = Literal["A", "B", "unknown"]


class SourceInfo(BaseModel):
    fileName: str | None = None
    width: int
    height: int
    fps: float
    durationS: float
    frameCount: int
    codec: str


class SegmentInfo(BaseModel):
    startMs: float
    endMs: float
    frameStride: int
    processedFrames: int


class CoordinateSystem(BaseModel):
    type: Literal["dizpitch_normalized"] = "dizpitch_normalized"
    min: float = 0
    max: float = 100
    xAxis: str = "pitch length; 0 = left goal line as seen from the broadcast camera, 100 = right goal line"
    yAxis: str = "pitch width; 0 = far touchline (top of the DizPitch pitch), 100 = near touchline"
    templateMetres: dict[str, float] = Field(default_factory=lambda: {"length": 105.0, "width": 68.0})


class ModelInfo(BaseModel):
    role: Literal["detector", "ballDetector", "pitchKeypoints", "tracker"]
    name: str
    file: str | None = None
    sha256: str | None = None
    licence: str


class CalibrationFrames(BaseModel):
    source: list[Literal["keypoints", "propagated", "manual", "none"]]
    # For "propagated" frames: the calibrated frame it was carried from; otherwise null.
    fromFrame: list[int | None]
    errorM: list[float | None]
    landmarks: list[int]
    shot: list[int]


class ShotInfo(BaseModel):
    index: int
    startFrame: int
    endFrame: int


class Calibration(BaseModel):
    status: Literal["calibrated", "partial", "unavailable"]
    method: str
    framesTotal: int
    framesCalibrated: int
    medianErrorM: float | None
    maxErrorM: float | None
    perFrame: CalibrationFrames
    # Row-major 3x3, image pixels -> pitch METRES on the 105 x 68 template; null when uncalibrated.
    homography: list[list[float] | None]
    # Row-major 3x3, frame pixels -> pixels of the first frame of the same shot (camera-motion compensation).
    cameraMotion: list[list[float]]
    shots: list[ShotInfo]
    notes: list[str]


class TeamClusterInfo(BaseModel):
    id: Literal["A", "B"]
    colorHex: str
    trackCount: int


class Teams(BaseModel):
    method: str
    clusters: list[TeamClusterInfo]


class Observations(BaseModel):
    frame: list[int]
    bbox: list[list[float]]
    foot: list[list[float]]
    pitch: list[list[float] | None]
    confidence: list[float | None]
    source: list[Literal["detected", "interpolated"]]

    @model_validator(mode="after")
    def _same_length(self) -> "Observations":
        n = len(self.frame)
        if not all(len(x) == n for x in (self.bbox, self.foot, self.pitch, self.confidence, self.source)):
            raise ValueError("observation arrays must have equal length")
        if any(b >= a for a, b in zip(self.frame[1:], self.frame)):
            raise ValueError("observation frames must be strictly increasing")
        return self


class Track(BaseModel):
    trackId: str
    trackerId: int | None
    objectType: ObjectType
    team: TeamCluster | None
    teamConfidence: float | None
    classVotes: dict[str, int]
    # Tracker ids of fragments joined into this track by tracklet stitching (provenance).
    mergedFrom: list[int] = Field(default_factory=list)
    observations: Observations


class Frames(BaseModel):
    sourceIndex: list[int]
    tMs: list[float]


class TrackingResult(BaseModel):
    schemaVersion: Literal[1] = SCHEMA_VERSION
    source: SourceInfo
    segment: SegmentInfo
    coordinateSystem: CoordinateSystem = Field(default_factory=CoordinateSystem)
    models: list[ModelInfo]
    device: str
    frames: Frames
    calibration: Calibration
    teams: Teams
    tracks: list[Track]
    warnings: list[str]
    timingsMs: dict[str, float]


class JobProgress(BaseModel):
    stage: str
    done: int
    total: int


class JobStatus(BaseModel):
    jobId: str
    state: Literal["queued", "running", "done", "failed", "cancelled"]
    progress: JobProgress | None = None
    error: dict | None = None
    createdAt: float
    finishedAt: float | None = None
