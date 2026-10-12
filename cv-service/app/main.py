"""HTTP API for DizPitch's computer-vision service (FastAPI).

    GET    /health                     service, device, model files, limits
    POST   /api/analyze                multipart: video + startSeconds + durationSeconds  -> 202 {jobId}
    POST   /api/scan                   multipart: video  -> 202 {jobId}  (find shots suitable for tracking)
    GET    /api/jobs/{jobId}           state + progress (+ error)
    GET    /api/results/{jobId}        the tracking result (or scan result) once done
    DELETE /api/jobs/{jobId}           cancel and forget a job
"""
from __future__ import annotations

import logging
import re
import uuid
from pathlib import Path

from fastapi import FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import Settings
from .jobs import Job, JobManager
from .processing import AnalyzeRequest, analyze
from .scan import scan
from .video_io import sniff_container

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("dizpitch.cv")

settings = Settings()
jobs = JobManager(settings.result_ttl_seconds)
app = FastAPI(title="DizPitch CV service", version="0.1.0")
if settings.cors_origins:
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["GET", "POST", "DELETE"], allow_headers=["*"])

JOB_ID = re.compile(r"^[0-9a-f]{32}$")
ACCEPTED = {"mp4", "quicktime", "webm", "matroska"}


def error(status: int, code: str, message: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, **extra}})


def limits() -> dict:
    return {
        "maxUploadMb": settings.max_upload_mb,
        "maxSourceSeconds": settings.max_source_seconds,
        "maxSegmentSeconds": settings.max_segment_seconds,
        "frameStride": settings.frame_stride,
        "formats": ["mp4", "mov", "webm", "mkv"],
    }


@app.get("/health")
def health() -> dict:
    missing = settings.missing_models()
    return {
        "status": "ok" if not missing else "models_missing",
        "device": settings.resolve_device(),
        "models": {"dir": "models/" if settings.models_dir.name == "models" else settings.models_dir.name, "missing": missing},
        "limits": limits(),
        "resultTtlSeconds": settings.result_ttl_seconds,
    }


async def _save_upload(video: UploadFile) -> Path:
    """Streams the upload to a random file name (never the client's), enforcing the size limit and the container type."""
    settings.work_dir.mkdir(parents=True, exist_ok=True)
    path = settings.work_dir / f"{uuid.uuid4().hex}.upload"
    size = 0
    head = b""
    try:
        with open(path, "wb") as out:
            while chunk := await video.read(1 << 20):
                if not head:
                    head = chunk[:64]
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    raise HTTPException(413, {"code": "file_too_large", "message": f"The upload is larger than {settings.max_upload_mb:g} MB."})
                out.write(chunk)
        if size == 0:
            raise HTTPException(400, {"code": "empty_file", "message": "The uploaded file is empty."})
        if sniff_container(head) not in ACCEPTED:
            raise HTTPException(415, {"code": "unsupported_format", "message": "This is not an MP4, MOV, WebM or MKV video."})
        return path
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def _models_missing_response() -> JSONResponse | None:
    missing = settings.missing_models()
    if missing:
        return error(503, "models_missing", "Model weights are not installed. Run ./scripts/download_models.sh in cv-service/.", missing=missing)
    return None


@app.post("/api/analyze", status_code=202)
async def post_analyze(
    video: UploadFile,
    startSeconds: float = Form(0.0),
    durationSeconds: float = Form(8.0),
):
    if (resp := _models_missing_response()) is not None:
        return resp
    if not (0 < durationSeconds <= settings.max_segment_seconds):
        return error(400, "segment_too_long", f"The segment must be longer than 0 s and at most {settings.max_segment_seconds:g} s.")
    if startSeconds < 0:
        return error(400, "invalid_segment", "The segment start cannot be negative.")
    path = await _save_upload(video)
    name = Path(video.filename or "clip").name[:120]

    def work(job: Job) -> dict:
        def progress(stage: str, done: int, total: int) -> None:
            job.progress = {"stage": stage, "done": done, "total": total}

        return analyze(AnalyzeRequest(path, startSeconds, durationSeconds, name), settings, progress, job.cancel)

    job = jobs.submit("analyze", path, work)
    log.info("analyze job %s: %s, %.2f s from %.2f s", job.id, name, durationSeconds, startSeconds)
    return {"jobId": job.id}


@app.post("/api/scan", status_code=202)
async def post_scan(video: UploadFile):
    if (resp := _models_missing_response()) is not None:
        return resp
    path = await _save_upload(video)

    def work(job: Job) -> dict:
        def progress(stage: str, done: int, total: int) -> None:
            job.progress = {"stage": stage, "done": done, "total": total}

        return scan(path, settings, progress, job.cancel)

    job = jobs.submit("scan", path, work)
    return {"jobId": job.id}


def _job(job_id: str) -> Job:
    if not JOB_ID.match(job_id):
        raise HTTPException(404, {"code": "not_found", "message": "No such job."})
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, {"code": "not_found", "message": "No such job (it may have expired)."})
    return job


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    return _job(job_id).status()


@app.get("/api/results/{job_id}")
def get_result(job_id: str):
    job = _job(job_id)
    if job.state != "done" or job.result is None:
        return error(409, "not_ready", f"The job is {job.state}.", state=job.state)
    return job.result


@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: str) -> dict:
    _job(job_id)
    jobs.delete(job_id)
    return {"deleted": True}


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    detail = exc.detail if isinstance(exc.detail, dict) else {"code": "error", "message": str(exc.detail)}
    return JSONResponse(status_code=exc.status_code, content={"error": detail})
