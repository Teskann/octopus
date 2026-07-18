"""whisper.cpp client: transcribe a WAV into word-timestamped segments.

We shell out to `whisper-cli` (built for ROCm by scripts/build-whisper-rocm.sh)
and ask for the *full* JSON output (`-oj -ojf`), which includes per-token
timestamps. Tokens are sub-word pieces; we merge them back into words (a new
word starts on a leading space) so the UI can do the karaoke highlight.

`--dtw` (dynamic time warping) is enabled for accurate per-word times.
"""
from __future__ import annotations

import json
import re
import subprocess
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

from . import config

# whisper-cli prints "... progress =  42%" to stderr when --print-progress is on.
_PROGRESS_RE = re.compile(r"progress\s*=\s*(\d+)\s*%")


class WhisperError(RuntimeError):
    """Raised when whisper-cli fails or its output can't be parsed."""


@dataclass
class Word:
    start: float   # seconds
    end: float
    text: str


@dataclass
class Segment:
    start: float
    end: float
    text: str
    words: list[Word]


def _skip_token(text: str) -> bool:
    """Special tokens look like [_BEG_], [_TT_123]; drop them, keep real text."""
    return text.startswith("[_") and text.endswith("]")


def _fit_words_to_segment(words: list[Word], seg_start: float, seg_end: float) -> None:
    """Anchor word times to the segment's reliable [start, end] span.

    whisper's *segment* timestamps are trustworthy, but its *token* times drift —
    the opening words of a segment often land ~1s before the segment even starts.
    So we affine-map the raw word starts onto [seg_start, seg_end], preserving
    their relative rhythm: a pure lead becomes a shift (first word → seg_start),
    drift is rescaled. Ends are then set to the next word's start so the karaoke
    highlight is gapless.
    """
    if not words:
        return
    raw_start = words[0].start
    raw_end = max(w.end for w in words)
    seg_span = seg_end - seg_start
    if seg_span <= 0:  # degenerate segment: give each word a small even slot
        seg_span = max(0.25 * len(words), 0.4)
        seg_end = seg_start + seg_span

    span = raw_end - raw_start
    if span > 0:
        scale = seg_span / span
        for w in words:
            w.start = seg_start + (w.start - raw_start) * scale
    else:  # all tokens share one timestamp: spread evenly
        for i, w in enumerate(words):
            w.start = seg_start + seg_span * i / len(words)

    prev = seg_start
    for w in words:  # force non-decreasing, keep inside the segment
        w.start = min(max(w.start, prev), seg_end)
        prev = w.start
    for i, w in enumerate(words):  # end = next word's start (gapless)
        w.end = words[i + 1].start if i + 1 < len(words) else seg_end
        if w.end <= w.start:
            w.end = min(seg_end, w.start + 0.04)


def _tokens_to_words(
    tokens: list[dict], seg_start: float, seg_end: float
) -> list[Word]:
    """Merge sub-word tokens into words and align them to the segment span."""
    words: list[Word] = []
    for tok in tokens:
        raw = tok.get("text", "")
        if _skip_token(raw):
            continue
        piece = raw.strip()
        if not piece:
            continue
        off = tok.get("offsets", {})
        t0 = off.get("from", 0) / 1000.0
        t1 = off.get("to", off.get("from", 0)) / 1000.0
        if raw.startswith(" ") or not words:
            words.append(Word(start=t0, end=t1, text=piece))
        else:  # sub-word continuation / trailing punctuation
            words[-1].text += piece
            words[-1].end = t1
    _fit_words_to_segment(words, seg_start, seg_end)
    return words


def transcribe(
    wav_path: Path,
    language: str | None = None,
    progress_cb: Callable[[float], None] | None = None,
) -> tuple[str, list[Segment]]:
    """Return (detected_language, segments) for a 16 kHz mono WAV.

    ``progress_cb`` (if given) is called with a 0..1 fraction as whisper reports
    its progress, so the UI's bar can grow during the (long) transcription."""
    if not config.WHISPER_BIN.exists():
        raise WhisperError(
            f"whisper-cli not found at {config.WHISPER_BIN}. "
            f"Run scripts/build-whisper-rocm.sh first.")
    if not config.WHISPER_MODEL.exists():
        raise WhisperError(f"whisper model not found at {config.WHISPER_MODEL}.")

    with tempfile.TemporaryDirectory() as tmp:
        out_prefix = Path(tmp) / "out"
        cmd = [
            str(config.WHISPER_BIN),
            "-m", str(config.WHISPER_MODEL),
            "-f", str(wav_path),
            "-oj", "-ojf",                 # JSON, full (per-token timestamps)
            "-of", str(out_prefix),
            "-t", str(config.WHISPER_THREADS),
            "-l", language or "auto",
            "-pp",                          # print progress (parsed for the UI)
        ]
        if config.WHISPER_DTW:
            cmd += ["--dtw", config.WHISPER_DTW]

        # Stream stdout+stderr so we can parse the running progress percentage.
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1)
        tail: list[str] = []
        last_pct = -1
        assert proc.stdout is not None
        for line in proc.stdout:
            tail.append(line)
            if len(tail) > 40:
                del tail[0]
            m = _PROGRESS_RE.search(line)
            if m and progress_cb is not None:
                pct = int(m.group(1))
                if pct != last_pct:
                    last_pct = pct
                    progress_cb(pct / 100.0)
        proc.wait()
        if proc.returncode != 0:
            raise WhisperError(
                f"whisper-cli failed ({proc.returncode}):\n{''.join(tail)[-2000:]}")

        json_path = out_prefix.with_suffix(".json")
        if not json_path.exists():
            raise WhisperError("whisper-cli produced no JSON output")
        data = json.loads(json_path.read_text(encoding="utf-8"))

    detected = data.get("result", {}).get("language", "") or (language or "")
    segments: list[Segment] = []
    for seg in data.get("transcription", []):
        off = seg.get("offsets", {})
        text = seg.get("text", "").strip()
        if not text:
            continue
        seg_start = off.get("from", 0) / 1000.0
        seg_end = off.get("to", 0) / 1000.0
        words = _tokens_to_words(seg.get("tokens", []), seg_start, seg_end)
        segments.append(Segment(
            start=seg_start, end=seg_end, text=text, words=words))

    n_words = sum(len(s.words) for s in segments)
    print(f"[whisper] {len(segments)} segments, {n_words} words "
          f"(lang={detected})", flush=True)
    return detected, segments


def segment_to_dict(seg: Segment) -> dict:
    return asdict(seg)
