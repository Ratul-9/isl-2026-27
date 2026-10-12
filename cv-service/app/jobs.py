"""In-memory background jobs. One worker: inference shares a single GPU/CPU and models are loaded once.

Uploaded videos are written to the work directory under a random name and DELETED as soon as the job finishes
(success, failure or cancellation). Results are kept in memory for `result_ttl_seconds`, then dropped.
"""
from __future__ import annotations

import logging
import threading
import time
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from .processing import Cancelled, ModelsMissing
from .video_io import VideoError

log = logging.getLogger("dizpitch.cv.jobs")


@dataclass
class Job:
    id: str
    kind: str  # "analyze" | "scan"
    created_at: float
    upload: Path | None
    state: str = "queued"
    progress: dict | None = None
    result: dict | None = None
    error: dict | None = None
    finished_at: float | None = None
    cancel: threading.Event = field(default_factory=threading.Event)

    def status(self) -> dict:
        return {
            "jobId": self.id,
            "kind": self.kind,
            "state": self.state,
            "progress": self.progress,
            "error": self.error,
            "createdAt": self.created_at,
            "finishedAt": self.finished_at,
        }


class JobManager:
    def __init__(self, ttl_seconds: int):
        self.ttl = ttl_seconds
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="cv-job")

    def submit(self, kind: str, upload: Path, work: Callable[[Job], dict]) -> Job:
        self.cleanup()
        job = Job(id=uuid.uuid4().hex, kind=kind, created_at=time.time(), upload=upload)
        with self._lock:
            self._jobs[job.id] = job
        self._pool.submit(self._run, job, work)
        return job

    def _run(self, job: Job, work: Callable[[Job], dict]) -> None:
        if job.cancel.is_set():
            job.state = "cancelled"
        else:
            job.state = "running"
            try:
                job.result = work(job)
                job.state = "done"
            except Cancelled:
                job.state = "cancelled"
            except ModelsMissing as e:
                job.state = "failed"
                job.error = {"code": "models_missing", "message": str(e), "missing": e.missing}
            except VideoError as e:
                job.state = "failed"
                job.error = {"code": e.code, "message": e.message}
            except Exception:  # noqa: BLE001 - never leak internals to the client; log them
                log.exception("job %s failed", job.id)
                job.state = "failed"
                job.error = {"code": "processing_error", "message": "Processing failed unexpectedly. See the service log for details."}
        job.finished_at = time.time()
        if job.upload is not None:
            job.upload.unlink(missing_ok=True)  # never keep the uploaded video
            job.upload = None

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> bool:
        job = self.get(job_id)
        if job is None:
            return False
        job.cancel.set()
        return True

    def delete(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.pop(job_id, None)
        if job is None:
            return False
        job.cancel.set()
        return True

    def cleanup(self) -> None:
        now = time.time()
        with self._lock:
            expired = [k for k, j in self._jobs.items() if j.finished_at is not None and now - j.finished_at > self.ttl]
            for k in expired:
                del self._jobs[k]
