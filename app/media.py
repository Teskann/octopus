"""ffprobe helpers for reading video metadata (duration, size, fps)."""
from __future__ import annotations

import json
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path


class MediaError(RuntimeError):
    """Raised when ffprobe fails or returns something we can't parse."""


@dataclass
class VideoInfo:
    duration: float   # seconds
    width: int
    height: int
    fps: float


def _parse_fps(rate: str) -> float:
    """ffprobe reports frame rates as fractions like '30000/1001'."""
    if "/" in rate:
        num, den = rate.split("/", 1)
        den_f = float(den)
        return float(num) / den_f if den_f else 0.0
    return float(rate)


def probe_video(path: Path) -> VideoInfo:
    proc = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,avg_frame_rate:format=duration",
            "-of", "json", str(path),
        ],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise MediaError(f"ffprobe failed: {proc.stderr[-500:]}")
    try:
        data = json.loads(proc.stdout)
        stream = data["streams"][0]
        return VideoInfo(
            duration=float(data["format"]["duration"]),
            width=int(stream["width"]),
            height=int(stream["height"]),
            fps=_parse_fps(stream.get("avg_frame_rate", "0/1")),
        )
    except (KeyError, IndexError, ValueError) as exc:
        raise MediaError(f"could not parse ffprobe output: {exc}") from exc


def faststart_remux(path: Path) -> bool:
    """Move an MP4/MOV `moov` atom to the front (`+faststart`) so a browser can
    start playing — and output its audio — before the whole file has downloaded.
    Without it a source whose moov sits at the end plays with NO SOUND until the
    entire file arrives (the "video plays muted for ~1 min, then audio kicks in"
    bug). Stream-copy only (no re-encode): fast and lossless, done in place via a
    temp file. Returns True if remuxed, False if skipped (non-MP4 container) or on
    any ffmpeg failure — playback still works from the original, just not streamed.
    """
    if path.suffix.lower() not in (".mp4", ".mov", ".m4v"):
        return False
    tmp = path.with_name(path.stem + ".faststart" + path.suffix)
    proc = subprocess.run(
        ["ffmpeg", "-y", "-i", str(path), "-c", "copy", "-movflags", "+faststart", str(tmp)],
        capture_output=True, text=True,
    )
    if proc.returncode != 0 or not tmp.exists():
        tmp.unlink(missing_ok=True)
        return False
    tmp.replace(path)
    return True


def video_codec(path: Path) -> str:
    """Name of the first video stream's codec (e.g. 'h264', 'hevc'), '' on failure."""
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=codec_name", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True,
    )
    return proc.stdout.strip() if proc.returncode == 0 else ""


def ensure_h264(path: Path) -> bool:
    """Transcode a video to H.264/AAC MP4 when it isn't already H.264.

    The headless-Chrome renderer (Phase-5 export + the `mode=preview` frames) can
    only decode **H.264** — open-source Chromium ships no HEVC/H.265 decoder, so an
    HEVC source composites as an **all-black clip**. The catch: HEVC plays fine in
    the editor (the user's real browser has hardware HEVC), so the source looks
    healthy right up until export. Phones/cameras increasingly record HEVC, so we
    normalise any non-H.264 source to H.264 at ingest. Re-encode (not a remux),
    in place via a temp file, already `+faststart`. Returns True if transcoded,
    False if already H.264 / not a probeable video / on ffmpeg failure (the
    original is left untouched — playback still works in the editor).
    """
    codec = video_codec(path)
    if not codec or codec == "h264":
        return False
    tmp = path.with_name(path.stem + ".h264" + path.suffix)
    proc = subprocess.run(
        ["ffmpeg", "-y", "-i", str(path),
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(tmp)],
        capture_output=True, text=True,
    )
    if proc.returncode != 0 or not tmp.exists():
        tmp.unlink(missing_ok=True)
        return False
    tmp.replace(path)
    return True


def has_audio(path: Path) -> bool:
    """True if the file has at least one audio stream."""
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a",
         "-show_entries", "stream=index", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True,
    )
    return proc.returncode == 0 and bool(proc.stdout.strip())


def detect_scene_changes(path: Path, threshold: float = 0.4,
                         crop: str | None = None, start: float | None = None,
                         end: float | None = None) -> list[dict]:
    """Timestamps where the picture changes a lot — slide / shot transitions.

    Runs ffmpeg's `select='gt(scene,threshold)'` and reads each surviving frame's
    time (and scene score, when ffmpeg exposes it) via the metadata filter.
    `crop` is an ffmpeg crop expression ("w:h:x:y") to restrict detection to a
    region — e.g. the slide area, excluding a webcam inset — so a moving speaker
    inset doesn't trigger false positives. `start`/`end` limit the scanned range
    (faster). Returns [{"t": seconds, "score": 0..1 | None}] sorted by time.
    """
    vf: list[str] = []
    if crop:
        vf.append(f"crop={crop}")
    vf.append(f"select='gt(scene,{threshold})'")
    with tempfile.NamedTemporaryFile("w+", suffix=".txt", delete=False) as tf:
        meta_path = Path(tf.name)
    vf.append(f"metadata=print:file={meta_path}")

    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error"]
    if start is not None:
        cmd += ["-ss", f"{max(start, 0.0):.3f}"]
    if end is not None:
        cmd += ["-to", f"{end:.3f}"]
    cmd += ["-i", str(path), "-filter:v", ",".join(vf), "-an", "-f", "null", "-"]

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        meta_path.unlink(missing_ok=True)
        raise MediaError(f"ffmpeg scene detect failed: {proc.stderr[-500:]}")

    offset = start or 0.0
    changes: list[dict] = []
    try:
        for line in meta_path.read_text().splitlines():
            line = line.strip()
            if line.startswith("frame:"):
                # "frame:12   pts:...   pts_time:48.800000"
                for tok in line.split():
                    if tok.startswith("pts_time:"):
                        try:
                            t = float(tok.split(":", 1)[1])
                            changes.append({"t": round(t + offset, 3), "score": None})
                        except ValueError:
                            pass
            elif line.startswith("lavfi.scene_score=") and changes:
                try:
                    changes[-1]["score"] = round(float(line.split("=", 1)[1]), 4)
                except ValueError:
                    pass
    finally:
        meta_path.unlink(missing_ok=True)
    return changes
