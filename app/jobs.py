"""In-memory transcription job store and background worker.

Single-process only: jobs live in a module-level dict, so this does not survive
a restart and does not scale across workers. Run uvicorn with a single worker.
"""
from __future__ import annotations

import shutil
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path

from . import config, transcription


@dataclass
class Job:
    id: str
    filename: str
    status: str = "pending"   # pending | processing | done | error
    progress: float = 0.0     # 0.0 .. 1.0
    message: str = ""
    text: str = ""            # transcript accumulated so far (streamed live)
    output_path: Path | None = None
    error: str | None = None


JOBS: dict[str, Job] = {}
_LOCK = threading.Lock()


def create_job(filename: str) -> Job:
    job = Job(id=uuid.uuid4().hex, filename=filename)
    with _LOCK:
        JOBS[job.id] = job
    return job


def get_job(job_id: str) -> Job | None:
    return JOBS.get(job_id)


def run_job(job: Job, video_path: Path, language: str | None) -> None:
    """Full pipeline for one upload. Runs in a background thread."""
    work_dir = video_path.parent
    wav_path = work_dir / "audio.wav"
    chunk_dir = work_dir / "chunks"
    chunk_dir.mkdir(exist_ok=True)
    try:
        job.status = "processing"
        job.message = "Extracting audio…"
        transcription.extract_audio(video_path, wav_path)

        job.message = "Splitting audio…"
        chunks = transcription.split_audio(wav_path, chunk_dir, config.CHUNK_SECONDS)

        parts: list[str] = []
        for i, chunk in enumerate(chunks):
            job.message = f"Transcribing segment {i + 1}/{len(chunks)}…"
            if i > 0:
                job.text += "\n\n"

            def on_delta(piece: str) -> None:
                job.text += piece  # GIL makes this append safe to read elsewhere

            parts.append(transcription.transcribe_file(chunk, language, on_delta))
            job.progress = (i + 1) / len(chunks)

        transcript = "\n\n".join(p for p in parts if p)
        job.text = transcript  # tidy up (drops separators around empty chunks)
        stem = Path(job.filename).stem or "transcript"
        out_path = config.OUTPUT_DIR / f"{stem}-{job.id[:8]}.txt"
        out_path.write_text(transcript, encoding="utf-8")

        job.output_path = out_path
        job.progress = 1.0
        job.status = "done"
        job.message = "Done"
    except Exception as exc:  # noqa: BLE001 - any failure is reported to the client
        job.status = "error"
        job.error = str(exc)
        job.message = "Failed"
    finally:
        # Remove the uploaded video, the wav and the chunks; the .txt lives in
        # OUTPUT_DIR and is kept.
        shutil.rmtree(work_dir, ignore_errors=True)
