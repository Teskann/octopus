"""MCP tools bridging Claude Code to the editor's REST API.

Design (see mcp-agent-control.html §2): every tool is a thin HTTP call to the
running FastAPI (`TRANSCRIPT_API`). Tools that edit list fields (clips, overlays,
scene_cuts) do a read-modify-write here so the agent works one item at a time.
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP, Image

API = os.environ.get("TRANSCRIPT_API", "http://localhost:8000")

mcp = FastMCP("transcript")
# trust_env=False: the API is local (localhost) — never route it through a proxy
# picked up from the environment (HTTP_PROXY/ALL_PROXY).
http = httpx.Client(base_url=API, timeout=120, trust_env=False)


# --- helpers ----------------------------------------------------------------
def _call(method: str, path: str, **kw: Any) -> httpx.Response:
    r = http.request(method, path, **kw)
    if r.status_code >= 400:
        raise RuntimeError(f"{r.status_code} {method} {path}: {r.text[:300]}")
    return r


def _project(project_id: str) -> dict:
    return _call("GET", f"/api/projects/{project_id}").json()


def _patch(project_id: str, patch: dict) -> dict:
    return _call("PATCH", f"/api/projects/{project_id}", json=patch).json()


def _uid(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:8]}"


# --- reading ----------------------------------------------------------------
@mcp.tool()
def list_projects() -> list[dict]:
    """List all projects (id, name, status, duration, created_at). Start here."""
    return _call("GET", "/api/projects").json()


@mcp.tool()
def get_project(project_id: str) -> dict:
    """Full project state: style, frame, scenes, scene_cuts, overlays, clips and
    segments WITH per-word timings (words[]). Use it when you need exact word
    boundaries for a clip; otherwise prefer get_transcript (cheaper)."""
    return _project(project_id)


@mcp.tool()
def get_transcript(project_id: str) -> list[dict]:
    """Compact transcript: one row per segment {id, start, end, text, translation}.
    Cheap to read; reason over this to pick the most impactful sequences."""
    return _call("GET", f"/api/projects/{project_id}/transcript").json()


@mcp.tool()
def get_frame(project_id: str, t: float, width: int = 480,
             mode: str = "source") -> Image:
    """See the video at time `t` (seconds). mode="source" = raw frame (fast,
    understand content); mode="preview" = the composed output (captions + reframe
    + scenes, needs Chrome/Vite like export). `width` applies to source mode."""
    r = _call("GET", f"/api/projects/{project_id}/frame",
              params={"t": t, "width": width, "mode": mode})
    return Image(data=r.content, format="jpeg")


# --- subtitles / segments ---------------------------------------------------
@mcp.tool()
def edit_segment(project_id: str, segment_id: str, text: str | None = None,
                 translation: str | None = None, start: float | None = None,
                 end: float | None = None) -> dict:
    """Fix a subtitle: correct Whisper spelling/context mistakes (text), edit the
    translation, or nudge its bounds. Per-word timings are recomputed server-side
    when `text` changes. Only the fields you pass are updated."""
    patch = {k: v for k, v in {"text": text, "translation": translation,
                               "start": start, "end": end}.items() if v is not None}
    if not patch:
        raise RuntimeError("Rien à modifier : passez text, translation, start ou end.")
    return _call("PATCH", f"/api/projects/{project_id}/segments/{segment_id}",
                 json=patch).json()


@mcp.tool()
def split_segment(project_id: str, segment_id: str, word_index: int) -> list[dict]:
    """Split a segment into two at `word_index` (the word that starts the second
    half). Returns the new segment list."""
    return _call("POST", f"/api/projects/{project_id}/segments/{segment_id}/split",
                 json={"word_index": word_index}).json()


@mcp.tool()
def merge_segment(project_id: str, segment_id: str) -> list[dict]:
    """Merge a segment with the one after it."""
    return _call("POST",
                 f"/api/projects/{project_id}/segments/{segment_id}/merge").json()


@mcp.tool()
def delete_segment(project_id: str, segment_id: str) -> list[dict]:
    """Delete a segment. Returns the remaining segment list."""
    return _call("DELETE",
                 f"/api/projects/{project_id}/segments/{segment_id}").json()


# --- context / (re)transcription -------------------------------------------
@mcp.tool()
def get_context(project_id: str) -> str:
    """The whisper context/prompt saved on this project — the initial context that
    steers spelling of names, jargon and acronyms on (re)transcription."""
    return _project(project_id).get("whisper_prompt", "")


@mcp.tool()
def set_context(project_id: str, prompt: str) -> str:
    """Set the whisper context/prompt (names, jargon, acronyms, a one-line summary
    of the video…). Saved on the project and used the next time it is
    transcribed. Pass "" to clear it. Does NOT re-transcribe — call retranscribe
    to apply it now."""
    return _patch(project_id, {"whisper_prompt": prompt}).get("whisper_prompt", "")


@mcp.tool()
def retranscribe(project_id: str, prompt: str | None = None,
                 language: str | None = None) -> dict:
    """Re-run whisper on the source video, replacing all segments + word timings.
    Optionally set the context `prompt` (persisted) and/or force a `language`
    (else the detected one is reused). Runs in the background — poll get_project's
    status/progress. Corrections and translations are lost; style/frame/clips/
    overlays are kept."""
    body: dict[str, Any] = {}
    if prompt is not None:
        body["prompt"] = prompt
    if language is not None:
        body["language"] = language
    return _call("POST", f"/api/projects/{project_id}/retranscribe", json=body).json()


@mcp.tool()
def list_context_presets() -> list[dict]:
    """User-saved context presets [{id, name, prompt}]. Load one onto a project
    with apply_context_preset."""
    return _call("GET", "/api/context-presets").json()


@mcp.tool()
def save_context_preset(name: str, prompt: str) -> dict:
    """Save a reusable, named context preset (prompt) shared by every project."""
    return _call("POST", "/api/context-presets",
                 json={"name": name, "prompt": prompt}).json()


@mcp.tool()
def apply_context_preset(project_id: str, name: str) -> str:
    """Load a context preset by name onto a project (sets its whisper_prompt).
    Does NOT re-transcribe — call retranscribe to apply it now."""
    for p in list_context_presets():
        if p["name"].lower() == name.lower():
            return set_context(project_id, p["prompt"])
    raise RuntimeError(f"Préréglage de contexte introuvable: {name}")


# --- clips ------------------------------------------------------------------
@mcp.tool()
def list_clips(project_id: str) -> list[dict]:
    """List the project's clips [{id, name, start, end}]."""
    return _project(project_id).get("clips", [])


@mcp.tool()
def create_clip(project_id: str, start: float, end: float, name: str = "Clip") -> dict:
    """Create a clip covering [start, end] (seconds). For clean cuts, align start/
    end to word boundaries from get_project (segment.words[].start / .end)."""
    if end <= start:
        raise RuntimeError("`end` doit être supérieur à `start`.")
    proj = _project(project_id)
    clip = {"id": _uid("clip-"), "name": name, "start": float(start), "end": float(end)}
    _patch(project_id, {"clips": proj.get("clips", []) + [clip]})
    return clip


@mcp.tool()
def update_clip(project_id: str, clip_id: str, name: str | None = None,
                start: float | None = None, end: float | None = None) -> dict:
    """Rename or re-time an existing clip."""
    proj = _project(project_id)
    clips = proj.get("clips", [])
    hit = next((c for c in clips if c["id"] == clip_id), None)
    if hit is None:
        raise RuntimeError(f"Clip inconnu: {clip_id}")
    if name is not None:
        hit["name"] = name
    if start is not None:
        hit["start"] = float(start)
    if end is not None:
        hit["end"] = float(end)
    _patch(project_id, {"clips": clips})
    return hit


@mcp.tool()
def delete_clip(project_id: str, clip_id: str) -> list[dict]:
    """Delete a clip."""
    proj = _project(project_id)
    clips = [c for c in proj.get("clips", []) if c["id"] != clip_id]
    _patch(project_id, {"clips": clips})
    return clips


# --- style / presets --------------------------------------------------------
@mcp.tool()
def get_style(project_id: str) -> dict:
    """The current caption style (all ~22 fields)."""
    return _project(project_id).get("style", {})


@mcp.tool()
def set_style(project_id: str, style: dict) -> dict:
    """Merge caption-style fields, e.g. {"font":"Anton","font_size":72,
    "highlight_color":"#00E5FF","uppercase":true,"position":"bottom","box_enabled":
    true,"translation_scale":0.5,"max_lines":2}. Only the keys you pass change."""
    proj = _project(project_id)
    merged = {**proj.get("style", {}), **style}
    return _patch(project_id, {"style": merged})["style"]


@mcp.tool()
def list_presets(project_id: str = "") -> list[dict]:
    """All caption presets: the 4 built-in looks plus any the user saved.
    Returns [{name, style, builtin}]. Apply one with apply_preset."""
    builtin = _call("GET", "/api/presets/builtin").json()
    user = _call("GET", "/api/presets").json()
    return ([{"name": p["name"], "style": p["style"], "builtin": True} for p in builtin]
            + [{"name": p["name"], "style": p["style"], "builtin": False} for p in user])


@mcp.tool()
def apply_preset(project_id: str, name: str) -> dict:
    """Apply a caption preset by name (built-in or user-saved) — copies its full
    style onto the project. Names include: "TikTok classique", "Bold Anton",
    "Boîte nette", "Minimal doux"."""
    for p in list_presets():
        if p["name"].lower() == name.lower():
            return _patch(project_id, {"style": p["style"]})["style"]
    raise RuntimeError(f"Preset introuvable: {name}")


@mcp.tool()
def save_preset(name: str, style: dict) -> dict:
    """Save the given style as a reusable user preset."""
    return _call("POST", "/api/presets", json={"name": name, "style": style}).json()


# --- framing / cadrage ------------------------------------------------------
@mcp.tool()
def set_frame(project_id: str, aspect: str | None = None, x: float | None = None,
              y: float | None = None, w: float | None = None, h: float | None = None,
              mode: str | None = None, blur_bg: bool | None = None) -> dict:
    """Set output framing. `aspect` in original|9:16|1:1|4:5|16:9|free. (x,y,w,h)
    is the normalized crop window (0..1) of the main scene. `mode`: crop (cover)
    or fit (contain + blurred fill). Only the fields you pass change."""
    proj = _project(project_id)
    frame = dict(proj.get("frame", {}))
    for k, v in {"aspect": aspect, "x": x, "y": y, "w": w, "h": h,
                 "mode": mode, "blur_bg": blur_bg}.items():
        if v is not None:
            frame[k] = v
    return _patch(project_id, {"frame": frame})["frame"]


# --- scenes / B-roll --------------------------------------------------------
@mcp.tool()
def list_scenes(project_id: str) -> list[dict]:
    """List scenes (camera angles / B-roll). scenes[0] is the main (has audio)."""
    return _project(project_id).get("scenes", [])


@mcp.tool()
def list_scene_cuts(project_id: str) -> list[dict]:
    """List scene switches [{id, time, scene_id}]. Active scene at t = last cut <= t."""
    return _project(project_id).get("scene_cuts", [])


@mcp.tool()
def add_scene_cut(project_id: str, time: float, scene_id: str) -> dict:
    """Switch to scene `scene_id` starting at `time` (seconds). Use a scene id from
    list_scenes ("main" to return to the primary angle)."""
    proj = _project(project_id)
    if not any(s["id"] == scene_id for s in proj.get("scenes", [])):
        raise RuntimeError(f"Scène inconnue: {scene_id}")
    cut = {"id": _uid("cut-"), "time": float(time), "scene_id": scene_id}
    cuts = sorted(proj.get("scene_cuts", []) + [cut], key=lambda c: c["time"])
    _patch(project_id, {"scene_cuts": cuts})
    return cut


@mcp.tool()
def clear_scene_cuts(project_id: str) -> list[dict]:
    """Remove all scene switches (everything reverts to the main angle)."""
    _patch(project_id, {"scene_cuts": []})
    return []


# --- overlays ---------------------------------------------------------------
@mcp.tool()
def list_overlays(project_id: str) -> list[dict]:
    """List text/image overlays."""
    return _project(project_id).get("overlays", [])


@mcp.tool()
def add_text_overlay(project_id: str, text: str, start: float, end: float,
                     x: float = 0.3, y: float = 0.35, font_size: int = 64,
                     color: str = "#FFFFFF", font: str = "Anton") -> dict:
    """Add a text overlay from `start` to `end` (seconds). x,y are normalized
    (0..1) top-left position over the source frame."""
    ov = {"id": _uid("ov-"), "type": "text", "start": float(start), "end": float(end),
          "x": x, "y": y, "text": text, "font_size": font_size, "color": color,
          "font": font, "shadow": True, "box_enabled": False, "box_color": "#000000",
          "box_opacity": 0.55, "box_radius": 12, "box_padding": 12}
    proj = _project(project_id)
    _patch(project_id, {"overlays": proj.get("overlays", []) + [ov]})
    return ov


@mcp.tool()
def add_image_overlay(project_id: str, image_path: str, start: float, end: float,
                      x: float = 0.35, y: float = 0.3, scale: float = 0.3) -> dict:
    """Add an image overlay. `image_path` is a local file uploaded as an asset.
    `scale` is the image width as a fraction of the video width."""
    p = Path(image_path)
    if not p.exists():
        raise RuntimeError(f"Fichier introuvable: {image_path}")
    with p.open("rb") as fh:
        asset = _call("POST", f"/api/projects/{project_id}/assets",
                      files={"file": (p.name, fh, "application/octet-stream")}).json()
    ov = {"id": _uid("ov-"), "type": "image", "start": float(start), "end": float(end),
          "x": x, "y": y, "asset": asset["name"], "url": asset["url"], "scale": scale}
    proj = _project(project_id)
    _patch(project_id, {"overlays": proj.get("overlays", []) + [ov]})
    return ov


@mcp.tool()
def delete_overlay(project_id: str, overlay_id: str) -> list[dict]:
    """Delete an overlay."""
    proj = _project(project_id)
    overlays = [o for o in proj.get("overlays", []) if o["id"] != overlay_id]
    _patch(project_id, {"overlays": overlays})
    return overlays


# --- translation ------------------------------------------------------------
@mcp.tool()
def translate(project_id: str, target: str) -> dict:
    """Start bilingual translation into `target` (e.g. "fr", "en", "es"). Runs in
    the background; poll get_project's translate_status/translate_progress."""
    return _call("POST", f"/api/projects/{project_id}/translate",
                 json={"target": target}).json()


# --- export -----------------------------------------------------------------
@mcp.tool()
def export_clips(project_id: str, clip_ids: list[str] | None = None) -> list[dict]:
    """Start MP4 rendering of clips (empty/omitted = all clips). Needs Vite +
    Chrome running (like manual export). Poll with render_status."""
    return _call("POST", f"/api/projects/{project_id}/renders",
                 json={"clip_ids": clip_ids or []}).json()


@mcp.tool()
def render_status(project_id: str) -> list[dict]:
    """Render jobs with status/progress. When status=="done", `download` is the
    path to fetch the MP4 from the API."""
    jobs = _call("GET", f"/api/projects/{project_id}/renders").json()
    for j in jobs:
        if j.get("status") == "done":
            j["download"] = f"{API}/api/projects/{project_id}/renders/{j['id']}/file"
    return jobs


if __name__ == "__main__":
    mcp.run()
