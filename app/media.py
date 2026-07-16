"""ffprobe helpers for reading video metadata (duration, size, fps)."""
from __future__ import annotations

import json
import subprocess
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
