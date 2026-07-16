"""Editor projects API (upload, process, read, edit)."""
from __future__ import annotations

import threading
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse

from . import media, pipeline, segments as segment_ops, store, subtitles, translate

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
    allowed = {"name", "style", "frame", "translate_to", "overlays", "clips",
               "scenes", "scene_cuts"}
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
            if "text" in patch:
                segment_ops.set_segment_text(seg, patch["text"])
            for key in ("translation", "start", "end"):
                if key in patch:
                    seg[key] = patch[key]
            store.save(project)
            return seg
    raise HTTPException(404, "Unknown segment")


@router.post("/{project_id}/segments/{segment_id}/split")
def split_segment(project_id: str, segment_id: str, body: dict) -> list[dict]:
    project = store.get(project_id)
    if project is None:
        raise HTTPException(404, "Unknown project")
    segment_ops.split(project["segments"], segment_id, int(body.get("word_index", 0)))
    store.save(project)
    return project["segments"]


@router.post("/{project_id}/segments/{segment_id}/merge")
def merge_segment(project_id: str, segment_id: str) -> list[dict]:
    project = store.get(project_id)
    if project is None:
        raise HTTPException(404, "Unknown project")
    segment_ops.merge_with_next(project["segments"], segment_id)
    store.save(project)
    return project["segments"]


@router.delete("/{project_id}/segments/{segment_id}")
def delete_segment(project_id: str, segment_id: str) -> list[dict]:
    project = store.get(project_id)
    if project is None:
        raise HTTPException(404, "Unknown project")
    i = segment_ops.find(project["segments"], segment_id)
    if i >= 0:
        del project["segments"][i]
        store.save(project)
    return project["segments"]


@router.post("/{project_id}/assets")
async def upload_asset(project_id: str, file: UploadFile = File(...)) -> dict:
    project = store.get(project_id)
    if project is None:
        raise HTTPException(404, "Unknown project")
    ext = Path(file.filename or "image.png").suffix or ".png"
    name = f"{Path(file.filename or 'img').stem}-{store.project_dir(project_id).name[:4]}{ext}"
    name = name.replace("/", "_")
    dest = store.project_dir(project_id) / "assets" / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("wb") as fh:
        while chunk := await file.read(1 << 20):
            fh.write(chunk)
    return {"name": name, "url": f"/api/projects/{project_id}/assets/{name}"}


@router.get("/{project_id}/assets/{name}")
def get_asset(project_id: str, name: str) -> FileResponse:
    path = store.project_dir(project_id) / "assets" / Path(name).name
    if not path.exists():
        raise HTTPException(404, "Asset missing")
    return FileResponse(path)


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


@router.post("/{project_id}/scenes")
async def add_scene(project_id: str, file: UploadFile = File(...)) -> dict:
    """Upload an extra (muted) point-of-view video, synchronized with the main."""
    project = store.get(project_id)
    if project is None:
        raise HTTPException(404, "Unknown project")
    sid = "scene-" + uuid.uuid4().hex[:8]
    ext = Path(file.filename or "scene.mp4").suffix or ".mp4"
    filename = f"{sid}{ext}"
    dest = store.project_dir(project_id) / filename
    with dest.open("wb") as fh:
        while chunk := await file.read(1 << 20):
            fh.write(chunk)
    try:
        info = media.probe_video(dest)
        w, h = info.width, info.height
    except media.MediaError:
        w = h = 0
    scene = {
        "id": sid, "name": Path(file.filename or "Scène").stem, "filename": filename,
        "is_main": False, "width": w, "height": h, "mode": "fit",
        "crop": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
    }
    project.setdefault("scenes", []).append(scene)
    store.save(project)
    return scene


@router.get("/{project_id}/scenes/{scene_id}/video")
def get_scene_video(project_id: str, scene_id: str) -> FileResponse:
    project = store.get(project_id)
    if project is None:
        raise HTTPException(404, "Unknown project")
    scene = next((s for s in project.get("scenes", []) if s["id"] == scene_id), None)
    if scene is None:
        raise HTTPException(404, "Unknown scene")
    path = store.project_dir(project_id) / scene["filename"]
    if not path.exists():
        raise HTTPException(404, "Scene video missing")
    return FileResponse(path)


@router.delete("/{project_id}/scenes/{scene_id}")
def delete_scene(project_id: str, scene_id: str) -> list[dict]:
    project = store.get(project_id)
    if project is None:
        raise HTTPException(404, "Unknown project")
    scenes = project.get("scenes", [])
    scene = next((s for s in scenes if s["id"] == scene_id), None)
    if scene and not scene.get("is_main"):
        f = store.project_dir(project_id) / scene["filename"]
        if f.exists():
            f.unlink()
        project["scenes"] = [s for s in scenes if s["id"] != scene_id]
        store.save(project)
    return project.get("scenes", [])


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
