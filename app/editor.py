"""Editor projects API (upload, process, read, edit)."""
from __future__ import annotations

import threading
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse

from . import pipeline, store, subtitles, translate

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.post("")
async def create_project(
    file: UploadFile = File(...),
    language: str = Form(""),
) -> dict:
    original = file.filename or "video.mp4"
    ext = Path(original).suffix or ".mp4"
    source_filename = f"source{ext}"

    project = store.new_project(name=Path(original).stem, source_filename=source_filename)
    dest = store.project_dir(project["id"]) / source_filename
    with dest.open("wb") as fh:
        while chunk := await file.read(1 << 20):  # 1 MiB at a time
            fh.write(chunk)

    threading.Thread(
        target=pipeline.process_project,
        args=(project["id"], language.strip() or None),
        daemon=True,
    ).start()
    return {"id": project["id"]}


@router.get("")
def list_projects() -> list[dict]:
    return store.list_projects()


@router.get("/{project_id}")
def get_project(project_id: str) -> dict:
    project = store.get(project_id)
    if project is None:
        raise HTTPException(404, "Unknown project")
    return project


@router.patch("/{project_id}")
def patch_project(project_id: str, patch: dict) -> dict:
    # Only editable top-level keys may be patched from the client.
    allowed = {"name", "style", "translate_to", "overlays", "clips"}
    clean = {k: v for k, v in patch.items() if k in allowed}
    project = store.update(project_id, clean)
    if project is None:
        raise HTTPException(404, "Unknown project")
    return project


@router.patch("/{project_id}/segments/{segment_id}")
def patch_segment(project_id: str, segment_id: str, patch: dict) -> dict:
    project = store.get(project_id)
    if project is None:
        raise HTTPException(404, "Unknown project")
    for seg in project["segments"]:
        if seg["id"] == segment_id:
            for key in ("text", "translation", "start", "end"):
                if key in patch:
                    seg[key] = patch[key]
            store.save(project)
            return seg
    raise HTTPException(404, "Unknown segment")


@router.post("/{project_id}/translate")
def translate_project(project_id: str, body: dict) -> dict:
    project = store.get(project_id)
    if project is None:
        raise HTTPException(404, "Unknown project")
    target = (body.get("target") or "").strip()
    if not target:
        raise HTTPException(400, "Missing target language")
    threading.Thread(
        target=translate.translate_project,
        args=(project_id, target),
        daemon=True,
    ).start()
    return {"status": "started", "target": target}


@router.get("/{project_id}/subtitles.ass", response_class=PlainTextResponse)
def get_subtitles(project_id: str) -> str:
    project = store.get(project_id)
    if project is None:
        raise HTTPException(404, "Unknown project")
    width = project["width"] or 1080
    height = project["height"] or 1920
    return subtitles.build_ass(project, width, height)


@router.get("/{project_id}/video")
def get_video(project_id: str) -> FileResponse:
    project = store.get(project_id)
    if project is None:
        raise HTTPException(404, "Unknown project")
    path = store.source_path(project)
    if not path.exists():
        raise HTTPException(404, "Video missing")
    # FileResponse honours Range requests, so the <video> element can seek.
    return FileResponse(path)
