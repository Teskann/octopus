"""Editor projects API (upload, process, read, edit)."""
from __future__ import annotations

import subprocess
import threading
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse, Response

from . import (
    exports, media, pipeline, render, segments as segment_ops, store,
    subtitles, translate,
)

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


@router.post("/{project_id}/retranscribe")
def retranscribe(project_id: str, body: dict | None = None) -> dict:
    """Re-run transcription on the existing source video, replacing the current
    segments/word timings. Reuses the detected language unless one is given."""
    project = store.get(project_id)
    if project is None:
        raise HTTPException(404, "Unknown project")
    body = body or {}
    language = (body.get("language") or project.get("language") or "").strip()
    # Optional context/prompt: persist it so it steers this run (and is reused on
    # the next). Passing "" clears it; omitting it keeps the stored one.
    if body.get("prompt") is not None:
        project["whisper_prompt"] = str(body["prompt"])
    project.update(status="processing", progress=0.0, message="Relance…", error="")
    store.save(project)
    threading.Thread(
        target=pipeline.process_project,
        args=(project_id, language or None),
        daemon=True,
    ).start()
    return {"status": "processing"}


@router.get("")
def list_projects() -> list[dict]:
    return store.list_projects()


@router.get("/{project_id}")
def get_project(project_id: str) -> dict:
    project = store.get(project_id)
    if project is None:
        raise HTTPException(404, "Unknown project")
    return project


@router.get("/{project_id}/transcript")
def get_transcript(project_id: str, q: str = "", start: float | None = None,
                   end: float | None = None, offset: int = 0,
                   limit: int | None = None) -> list[dict]:
    """Compact, token-cheap view of the transcript: one row per segment with its
    id, timecodes, text and translation (no per-word timings). An agent reasons
    over this to pick clip boundaries; word-level timings stay in GET /{id}.

    Optional filters keep the payload small on long talks: `q` = case-insensitive
    substring search over text+translation; `start`/`end` = keep segments
    overlapping that time window; `offset`/`limit` = paginate."""
    project = store.get(project_id)
    if project is None:
        raise HTTPException(404, "Unknown project")
    rows = [
        {"id": s["id"], "start": s["start"], "end": s["end"],
         "text": s["text"], "translation": s.get("translation", "")}
        for s in project["segments"]
    ]
    if q:
        ql = q.lower()
        rows = [r for r in rows
                if ql in r["text"].lower() or ql in (r["translation"] or "").lower()]
    if start is not None:
        rows = [r for r in rows if r["end"] > start]
    if end is not None:
        rows = [r for r in rows if r["start"] < end]
    if offset:
        rows = rows[max(offset, 0):]
    if limit is not None:
        rows = rows[:max(limit, 0)]
    return rows


@router.delete("/{project_id}")
def delete_project(project_id: str) -> dict:
    if not store.delete_project(project_id):
        raise HTTPException(404, "Unknown project")
    return {"deleted": project_id}


@router.patch("/{project_id}")
def patch_project(project_id: str, patch: dict) -> dict:
    # Only editable top-level keys may be patched from the client.
    allowed = {"name", "style", "frame", "translate_to", "overlays", "clips",
               "scenes", "scene_cuts", "whisper_prompt"}
    clean = {k: v for k, v in patch.items() if k in allowed}
    project = store.update(project_id, clean)
    if project is None:
        raise HTTPException(404, "Unknown project")
    return project


@router.get("/{project_id}/segments/{segment_id}")
def get_segment(project_id: str, segment_id: str) -> dict:
    """One segment with its per-word timings — the cheap way to read word
    boundaries for a clean clip cut without pulling the whole project."""
    project = store.get(project_id)
    if project is None:
        raise HTTPException(404, "Unknown project")
    seg = next((s for s in project["segments"] if s["id"] == segment_id), None)
    if seg is None:
        raise HTTPException(404, "Unknown segment")
    return seg


@router.post("/{project_id}/segments/batch")
def batch_edit_segments(project_id: str, body: dict) -> dict:
    """Apply many segment edits in a single write. `body.edits` is a list of
    {id, text?, translation?, start?, end?}; per-word timings are recomputed for
    any edit that changes `text`. Returns {updated:[...], missing:[ids]}."""
    project = store.get(project_id)
    if project is None:
        raise HTTPException(404, "Unknown project")
    by_id = {s["id"]: s for s in project["segments"]}
    updated: list[dict] = []
    missing: list[str] = []
    for edit in body.get("edits", []):
        seg = by_id.get(edit.get("id"))
        if seg is None:
            missing.append(edit.get("id"))
            continue
        if edit.get("text") is not None:
            segment_ops.set_segment_text(seg, edit["text"])
        for key in ("translation", "start", "end"):
            if edit.get(key) is not None:
                seg[key] = edit[key]
        updated.append(seg)
    if updated:
        store.save(project)
    return {"updated": updated, "missing": missing}


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


@router.get("/{project_id}/scenes")
def list_scenes(project_id: str) -> list[dict]:
    """Scenes (camera angles / B-roll) with each file's `duration` and
    `has_audio`, probed once and cached. Surfaces hard limits — e.g. a secondary
    camera shorter than the talk can only be shown up to its own duration."""
    project = store.get(project_id)
    if project is None:
        raise HTTPException(404, "Unknown project")
    changed = False
    for sc in project.get("scenes", []):
        if "duration" not in sc or "has_audio" not in sc:
            path = store.project_dir(project_id) / sc["filename"]
            if path.exists():
                try:
                    sc["duration"] = round(media.probe_video(path).duration, 3)
                except media.MediaError:
                    sc["duration"] = 0.0
                sc["has_audio"] = media.has_audio(path)
                changed = True
    if changed:
        store.save(project)
    return project.get("scenes", [])


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
    media.faststart_remux(dest)  # stream-friendly moov, like the source
    try:
        info = media.probe_video(dest)
        w, h = info.width, info.height
    except media.MediaError:
        w = h = 0
    colors = store.SCENE_COLORS
    scene = {
        "id": sid, "name": Path(file.filename or "Scène").stem, "filename": filename,
        "is_main": False, "width": w, "height": h, "mode": "fit",
        "color": colors[len(project["scenes"]) % len(colors)],
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


@router.get("/{project_id}/frame")
def get_frame(project_id: str, t: float, width: int = 480,
              mode: str = "source", scene: str = "main") -> Response:
    """A single JPEG of the video at time `t` (seconds) — the agent's "eyes".

    mode="source" (default): the raw frame of scene `scene` (default the main
    video), grabbed by ffmpeg — fast, no browser, good for understanding
    *content*; use `scene` to peek at a secondary camera / B-roll angle.
    mode="preview": the fully composed output frame (captions + reframe + scenes)
    captured from the same headless renderer as export — `scene` is ignored."""
    project = store.get(project_id)
    if project is None:
        raise HTTPException(404, "Unknown project")

    if mode == "preview":
        try:
            data = render.capture_frame(project, max(t, 0.0))
        except RuntimeError as exc:
            raise HTTPException(500, str(exc))
        return Response(content=data, media_type="image/jpeg")

    path = store.scene_path(project, scene)
    if path is None:
        raise HTTPException(404, f"Unknown scene: {scene}")
    if not path.exists():
        raise HTTPException(404, "Video missing")
    proc = subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
         "-ss", f"{max(t, 0.0):.3f}", "-i", str(path),
         "-frames:v", "1", "-vf", f"scale={max(16, width)}:-2",
         "-c:v", "mjpeg", "-f", "image2", "pipe:1"],
        capture_output=True,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise HTTPException(500, proc.stderr.decode("utf-8", "replace")[-400:])
    return Response(content=proc.stdout, media_type="image/jpeg")


@router.get("/{project_id}/scene-changes")
def scene_changes(project_id: str, scene: str = "main", threshold: float = 0.4,
                  crop: str = "", start: float | None = None,
                  end: float | None = None) -> list[dict]:
    """Detect big picture changes in a scene's video — slide / shot transitions.
    Returns [{t, score}]. `threshold` 0..1 (lower = more sensitive). `crop` is an
    ffmpeg crop expr "w:h:x:y" to ignore a region (e.g. a moving webcam inset).
    `start`/`end` limit the scanned range."""
    project = store.get(project_id)
    if project is None:
        raise HTTPException(404, "Unknown project")
    path = store.scene_path(project, scene)
    if path is None:
        raise HTTPException(404, f"Unknown scene: {scene}")
    if not path.exists():
        raise HTTPException(404, "Video missing")
    try:
        return media.detect_scene_changes(path, threshold, crop or None, start, end)
    except media.MediaError as exc:
        raise HTTPException(500, str(exc))


# --- clip export / render ---------------------------------------------------

@router.post("/{project_id}/renders")
def start_renders(project_id: str, body: dict) -> list[dict]:
    """Start rendering one or more clips. `body.clip_ids` empty/absent = all."""
    project = store.get(project_id)
    if project is None:
        raise HTTPException(404, "Unknown project")
    clips = project.get("clips", [])
    wanted = body.get("clip_ids") or [c["id"] for c in clips]
    todo = [c for c in clips if c["id"] in wanted]
    if not todo:
        raise HTTPException(400, "Aucun clip à exporter")
    return exports.enqueue_clips(project_id, todo)


@router.get("/{project_id}/renders")
def list_renders(project_id: str) -> list[dict]:
    if store.get(project_id) is None:
        raise HTTPException(404, "Unknown project")
    return exports.list_for(project_id)


@router.delete("/{project_id}/renders/{job_id}")
def cancel_render(project_id: str, job_id: str) -> dict:
    """Stop a queued/running render job."""
    job = exports.cancel_job(project_id, job_id)
    if job is None:
        raise HTTPException(404, "Unknown render job")
    return job


@router.get("/{project_id}/renders/{job_id}/file")
def render_file(project_id: str, job_id: str) -> FileResponse:
    job = exports.get(job_id)
    if job is None or job["project_id"] != project_id:
        raise HTTPException(404, "Unknown render job")
    if job["status"] != "done":
        raise HTTPException(409, "Rendu non terminé")
    path = store.project_dir(project_id) / "exports" / job["filename"]
    if not path.exists():
        raise HTTPException(404, "Fichier introuvable")
    return FileResponse(path, media_type="video/mp4", filename=job["filename"])
