"""Persisted editor projects.

A project is a directory under PROJECTS_DIR holding the source video, cached
audio, uploaded assets, exports, and a project.json describing segments, style,
overlays and clips. Unlike the old in-memory text jobs, editor state must
survive reloads, so it lives on disk. An in-memory cache + lock guards live
progress updates during processing (single uvicorn worker).
"""
from __future__ import annotations

import json
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from . import config

SCHEMA_VERSION = 1

_CACHE: dict[str, dict] = {}
_LOCK = threading.Lock()


def default_style() -> dict:
    """TikTok-ish defaults: big bold original line, smaller translation under.

    `font` must be a family installed on the system — libass (export) and the
    browser both resolve it via fontconfig, so a missing family silently falls
    back. "DejaVu Sans" is always present.
    """
    return {
        "font": "DejaVu Sans",
        "font_size": 56,             # px, relative to a 1080-wide canvas
        "primary_color": "#FFFFFF",
        "highlight_color": "#FFE100",  # active word
        "highlight_enabled": True,     # word-by-word karaoke highlight on/off
        "outline_color": "#000000",
        "outline_width": 6,
        "box_enabled": False,          # solid box behind the text
        "box_color": "#000000",
        "box_opacity": 0.55,           # 0 = transparent, 1 = solid
        "box_radius": 14,              # px @1080, rounded corners (preview)
        "box_padding_x": 26,           # px @1080, horizontal padding
        "box_padding_y": 10,           # px @1080, vertical padding
        "position": "bottom",        # top | middle | bottom
        "margin_v": 220,             # px from the chosen edge
        "uppercase": True,
        "translation_enabled": True,   # show the translated line at all
        "translation_scale": 0.5,    # translation line size vs original
        "translation_color": "#B7C7FF",
        "translation_position": "below",  # below | above the original line
        # Lines wrap by width, not word count: a line fills up to this fraction
        # of the video width, so long words take fewer per line automatically.
        "max_line_width_pct": 80,    # % of video width a caption line may fill
        "max_lines": 2,              # lines shown at once (fewer at chunk end)
    }


def normalize_style(style: dict | None) -> dict:
    """Fill any missing keys from defaults so older projects stay valid."""
    return {**default_style(), **(style or {})}


def default_frame() -> dict:
    """Project-level output framing, shared by every clip. The crop window
    (x,y,w,h) is a normalized rectangle of the source video that becomes the
    output; aspect 'free' unlocks the ratio; blur_bg fills any margin."""
    return {"aspect": "original", "mode": "crop", "x": 0.0, "y": 0.0, "w": 1.0,
            "h": 1.0, "blur_bg": True}


def normalize_frame(frame: dict | None) -> dict:
    return {**default_frame(), **(frame or {})}


def project_dir(project_id: str) -> Path:
    return config.PROJECTS_DIR / project_id


def _json_path(project_id: str) -> Path:
    return project_dir(project_id) / "project.json"


def new_project(name: str, source_filename: str) -> dict:
    pid = uuid.uuid4().hex
    pdir = project_dir(pid)
    (pdir / "assets").mkdir(parents=True, exist_ok=True)
    (pdir / "exports").mkdir(parents=True, exist_ok=True)
    project = {
        "id": pid,
        "version": SCHEMA_VERSION,
        "name": name,
        "status": "created",       # created | processing | ready | error
        "progress": 0.0,
        "message": "",
        "error": None,
        "source_video": source_filename,
        "duration": 0.0,
        "width": 0,
        "height": 0,
        "fps": 0.0,
        "language": "",
        "translate_to": None,
        "translate_status": "idle",   # idle | running | done | error
        "translate_progress": 0.0,
        # translation keyed by a caption block's original text, so it matches
        # exactly what is on screen and survives live re-chunking.
        "translations": {},
        "segments": [],
        "style": default_style(),
        "frame": default_frame(),
        # Synchronized video sources. scenes[0] is the main video (carries the
        # audio); extra scenes are alternative points of view (muted), shown as
        # B-roll during a clip. crop is a per-scene reframe window.
        "scenes": [{
            "id": "main", "name": "Principale", "filename": source_filename,
            "is_main": True, "width": 0, "height": 0, "mode": "crop",
            "crop": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
        }],
        "overlays": [],
        "clips": [],
        # Global scene switches: {id, time, scene_id}. The active scene at time t
        # is the last cut with time <= t (default: the main scene).
        "scene_cuts": [],
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    save(project)
    return project


def save(project: dict) -> None:
    pid = project["id"]
    with _LOCK:
        _CACHE[pid] = project
        _json_path(pid).write_text(
            json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8")


def get(project_id: str) -> dict | None:
    with _LOCK:
        if project_id in _CACHE:
            return _CACHE[project_id]
    path = _json_path(project_id)
    if not path.exists():
        return None
    project = json.loads(path.read_text(encoding="utf-8"))
    project["style"] = normalize_style(project.get("style"))
    project["frame"] = normalize_frame(project.get("frame"))
    if not project.get("scenes"):
        project["scenes"] = [{
            "id": "main", "name": "Principale",
            "filename": project.get("source_video", ""), "is_main": True,
            "width": project.get("width", 0), "height": project.get("height", 0),
            "mode": "crop", "crop": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
        }]
    for sc in project["scenes"]:
        sc.setdefault("mode", "crop" if sc.get("is_main") else "fit")
        sc.setdefault("crop", {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0})
    project.setdefault("scene_cuts", [])
    project.setdefault("translations", {})
    project.setdefault("translate_status", "idle")
    project.setdefault("translate_progress", 0.0)
    with _LOCK:
        _CACHE[project_id] = project
    return project


def update(project_id: str, patch: dict[str, Any]) -> dict | None:
    """Shallow-merge top-level keys and persist. Returns the updated project."""
    project = get(project_id)
    if project is None:
        return None
    project.update(patch)
    save(project)
    return project


def list_projects() -> list[dict]:
    items = []
    for path in sorted(config.PROJECTS_DIR.glob("*/project.json")):
        try:
            p = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        items.append({
            "id": p["id"], "name": p["name"], "status": p["status"],
            "duration": p["duration"], "created_at": p.get("created_at", ""),
        })
    items.sort(key=lambda x: x["created_at"], reverse=True)
    return items


def source_path(project: dict) -> Path:
    return project_dir(project["id"]) / project["source_video"]
