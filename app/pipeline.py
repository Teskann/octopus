"""Background processing for a project: probe → extract audio → transcribe.

Runs in a daemon thread (single worker, same model as the old text jobs).
Progress is written back onto the cached project dict and persisted, so the
frontend can poll GET /api/projects/{id}.
"""
from __future__ import annotations

from dataclasses import asdict
from pathlib import Path

from . import media, store, transcription, whisper


def _set(project: dict, **fields) -> None:
    project.update(fields)
    store.save(project)


def process_project(project_id: str, language: str | None) -> None:
    project = store.get(project_id)
    if project is None:
        return
    pdir = store.project_dir(project_id)
    video_path = store.source_path(project)
    wav_path = pdir / "audio.wav"
    try:
        _set(project, status="processing", progress=0.05, message="Reading video…")
        info = media.probe_video(video_path)
        _set(project, duration=info.duration, width=info.width,
             height=info.height, fps=info.fps,
             progress=0.1, message="Extracting audio…")

        transcription.extract_audio(video_path, wav_path)

        _set(project, progress=0.25, message="Transcribing (this can take a while)…")
        detected, segments = whisper.transcribe(wav_path, language)

        seg_dicts = []
        for i, seg in enumerate(segments):
            d = asdict(seg)
            d["id"] = f"s{i}"
            d["translation"] = ""
            seg_dicts.append(d)

        _set(project, language=detected or (language or ""),
             segments=seg_dicts, progress=1.0, status="ready", message="Ready")
    except Exception as exc:  # noqa: BLE001 - report any failure to the client
        _set(project, status="error", error=str(exc), message="Failed")
