"""Clip export jobs — a small in-memory queue on top of app/render.py.

A job renders one clip to ``data/projects/<id>/exports/<name>-<clipid>.mp4``.
"Export all" enqueues one job per clip; a bounded ThreadPoolExecutor
(``EXPORT_CONCURRENCY``) runs a few ffmpeg processes in parallel. Jobs live in
memory (single uvicorn worker, like the rest of the app); the rendered files
persist on disk. Progress is polled via GET /api/projects/{id}/renders.
"""
from __future__ import annotations

import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import config, render, store

_EXECUTOR = ThreadPoolExecutor(max_workers=max(1, config.EXPORT_CONCURRENCY))
_JOBS: dict[str, dict] = {}
_LOCK = threading.Lock()


def _sanitize(name: str) -> str:
    slug = re.sub(r"[^\w-]+", "_", name.strip()) or "clip"
    return slug[:60]


def _exports_dir(project_id: str) -> Path:
    d = store.project_dir(project_id) / "exports"
    d.mkdir(parents=True, exist_ok=True)
    return d


def output_filename(clip: dict) -> str:
    return f"{_sanitize(clip['name'])}-{clip['id']}.mp4"


def _public(job: dict) -> dict:
    """The client-facing view of a job (adds a download url when ready)."""
    out = {k: job[k] for k in
           ("id", "clip_id", "clip_name", "status", "progress", "message",
            "error", "filename", "created_at")}
    if job["status"] == "done":
        out["download"] = f"/api/projects/{job['project_id']}/renders/{job['id']}/file"
    else:
        out["download"] = None
    return out


def _set(job_id: str, **fields) -> None:
    with _LOCK:
        job = _JOBS.get(job_id)
        if job is not None:
            job.update(fields)


def _run(job_id: str) -> None:
    with _LOCK:
        job = _JOBS.get(job_id)
    if job is None:
        return
    _set(job_id, status="running", message="Rendu…")
    try:
        project = store.get(job["project_id"])
        if project is None:
            raise RuntimeError("Projet introuvable")
        clip = next((c for c in project.get("clips", []) if c["id"] == job["clip_id"]), None)
        if clip is None:
            raise RuntimeError("Clip introuvable")
        out_path = _exports_dir(job["project_id"]) / job["filename"]
        render.render_clip(project, clip, out_path,
                           progress=lambda f: _set(job_id, progress=round(f, 3)))
        _set(job_id, status="done", progress=1.0, message="Terminé")
    except Exception as exc:  # noqa: BLE001 - surface any failure to the client
        _set(job_id, status="error", error=str(exc), message="Échec")


def enqueue_clip(project_id: str, clip: dict) -> dict:
    job = {
        "id": "r" + uuid.uuid4().hex[:10],
        "project_id": project_id,
        "clip_id": clip["id"],
        "clip_name": clip["name"],
        "status": "queued",
        "progress": 0.0,
        "message": "En attente…",
        "error": None,
        "filename": output_filename(clip),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    with _LOCK:
        _JOBS[job["id"]] = job
    _EXECUTOR.submit(_run, job["id"])
    return _public(job)


def enqueue_clips(project_id: str, clips: list[dict]) -> list[dict]:
    return [enqueue_clip(project_id, c) for c in clips]


def list_for(project_id: str) -> list[dict]:
    with _LOCK:
        jobs = [j for j in _JOBS.values() if j["project_id"] == project_id]
    jobs.sort(key=lambda j: j["created_at"], reverse=True)
    return [_public(j) for j in jobs]


def get(job_id: str) -> dict | None:
    with _LOCK:
        return _JOBS.get(job_id)
