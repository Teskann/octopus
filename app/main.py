"""FastAPI app: upload a video, transcribe it with Voxtral, download the text."""
from __future__ import annotations

import threading
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse

from . import config, editor, jobs, presets

app = FastAPI(title="Transcript")
app.include_router(editor.router)
app.include_router(presets.router)

STATIC_DIR = Path(__file__).parent / "static"


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return (STATIC_DIR / "index.html").read_text(encoding="utf-8")


@app.post("/api/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: str = Form(""),
) -> dict[str, str]:
    job = jobs.create_job(file.filename or "video")
    work_dir = config.UPLOAD_DIR / job.id
    work_dir.mkdir(parents=True, exist_ok=True)
    video_path = work_dir / (file.filename or "video")

    with video_path.open("wb") as fh:
        while chunk := await file.read(1 << 20):  # stream to disk, 1 MiB at a time
            fh.write(chunk)

    threading.Thread(
        target=jobs.run_job,
        args=(job, video_path, language.strip() or None),
        daemon=True,
    ).start()

    return {"job_id": job.id}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(404, "Unknown job")
    return {
        "status": job.status,
        "progress": round(job.progress, 3),
        "message": job.message,
        "text": job.text,
        "error": job.error,
        "download": f"/api/jobs/{job_id}/download" if job.status == "done" else None,
    }


@app.get("/api/jobs/{job_id}/download")
def job_download(job_id: str) -> FileResponse:
    job = jobs.get_job(job_id)
    if job is None or job.status != "done" or job.output_path is None:
        raise HTTPException(404, "No transcript available")
    return FileResponse(
        job.output_path,
        media_type="text/plain; charset=utf-8",
        filename=job.output_path.name,
    )
