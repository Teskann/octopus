"""User-saved caption-style presets.

A preset is just a named caption `style` (see store.default_style). They are
global (shared by every project) and persisted to a single JSON file next to the
projects directory, so they survive reloads and a cleared browser cache. Built-in
presets live in the frontend (frontend/src/presets.ts); this only holds the
ones the user saved.
"""
from __future__ import annotations

import json
import threading
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException

from . import builtin_presets, config, store

router = APIRouter(prefix="/api/presets", tags=["presets"])

_PATH = config.PROJECTS_DIR.parent / "presets.json"
_LOCK = threading.Lock()


def _load() -> list[dict]:
    if not _PATH.exists():
        return []
    try:
        data = json.loads(_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return data if isinstance(data, list) else []


def _save(items: list[dict]) -> None:
    _PATH.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")


@router.get("/builtin")
def list_builtin_presets() -> list[dict]:
    """The read-only, built-in looks (same as the frontend's). An agent applies
    one by copying its `style` onto a project."""
    return builtin_presets.BUILTIN_PRESETS


@router.get("")
def list_presets() -> list[dict]:
    with _LOCK:
        return _load()


@router.post("")
def create_preset(body: dict) -> dict:
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "A preset name is required")
    preset = {
        "id": uuid.uuid4().hex,
        "name": name,
        "style": store.normalize_style(body.get("style")),
    }
    with _LOCK:
        items = _load()
        items.append(preset)
        _save(items)
    return preset


@router.delete("/{preset_id}")
def delete_preset(preset_id: str) -> dict:
    with _LOCK:
        items = _load()
        kept = [p for p in items if p.get("id") != preset_id]
        if len(kept) == len(items):
            raise HTTPException(404, "Unknown preset")
        _save(kept)
    return {"deleted": preset_id}
