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
    """Align word starts to the segment span, then chain ends gaplessly.

    Word starts come from whisper's DTW alignment (see `_tokens_to_words`), which
    is accurate and in the same absolute reference as the segment times, so we
    keep them as-is and only clamp the *lower* bound to `seg_start` and force
    them non-decreasing. We deliberately do NOT clamp the upper bound to
    `seg_end`: DTW aligns per token and a late word can land slightly past the
    coarse decoder `offsets.to`; clamping it there collapsed every trailing word
    onto `seg_end` — a zero-width window that `isWordActive` can never match, so
    the tail of the segment was never highlighted. Ends are set to the next
    word's start so the karaoke highlight is gapless. (Only when a segment
    carries no per-word timing at all do we fall back to spreading evenly.)
    """
    if not words:
        return
    seg_span = seg_end - seg_start
    if seg_span <= 0:  # degenerate segment: give each word a small even slot
        seg_span = max(0.25 * len(words), 0.4)
        seg_end = seg_start + seg_span

    if max(w.start for w in words) - words[0].start <= 0:
        # all tokens share one timestamp (no usable timing): spread evenly
        for i, w in enumerate(words):
            w.start = seg_start + seg_span * i / len(words)

    hi = max(seg_end, max(w.start for w in words))
    prev = seg_start
    for w in words:  # force non-decreasing, keep within [seg_start, hi]
        w.start = min(max(w.start, prev), hi)
        prev = w.start
    for i, w in enumerate(words):  # end = next word's start (gapless)
        w.end = words[i + 1].start if i + 1 < len(words) else max(seg_end, w.start + 0.04)
        if w.end <= w.start:
            w.end = w.start + 0.04


def _token_time(tok: dict) -> tuple[float, float]:
    """Best (start, end) for a token, in seconds.

    Prefer `t_dtw` — whisper's Dynamic-Time-Warping-aligned timestamp, which is
    accurate to the word (in centiseconds, -1 when unavailable). Fall back to the
    coarse `offsets` (decoder timestamps, in milliseconds) only when DTW is
    missing. `t_dtw` is a single point per token, so start == end here; the real
    end is derived later as the next word's start (see `_fit_words_to_segment`).
    """
    dtw = tok.get("t_dtw", -1)
    if dtw is not None and dtw >= 0:
        t = dtw / 100.0
        return t, t
    off = tok.get("offsets", {})
    return off.get("from", 0) / 1000.0, off.get("to", off.get("from", 0)) / 1000.0


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
        t0, t1 = _token_time(tok)
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
    prompt: str | None = None,
) -> tuple[str, list[Segment]]:
    """Return (detected_language, segments) for a 16 kHz mono WAV.

    ``progress_cb`` (if given) is called with a 0..1 fraction as whisper reports
    its progress, so the UI's bar can grow during the (long) transcription.
    ``prompt`` (if given) is passed to whisper as the initial prompt/context to
    steer the spelling of names, jargon and acronyms."""
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
        if prompt and prompt.strip():
            # Initial context: biases vocabulary/spelling (names, jargon…).
            cmd += ["--prompt", prompt.strip()]
        if config.WHISPER_DTW:
            # whisper.cpp silently DISABLES DTW word timestamps when flash
            # attention is on ("not supported with flash_attn - disabling"), and
            # the CLI enables flash attention by default. So force it off here —
            # otherwise every t_dtw comes back -1 and word timing falls back to
            # the coarse decoder offsets (visibly wrong per-word sync).
            cmd += ["-nfa", "--dtw", config.WHISPER_DTW]

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
    n_tok = n_dtw = 0  # diagnostic: is DTW actually producing per-token times?
    for seg in data.get("transcription", []):
        off = seg.get("offsets", {})
        text = seg.get("text", "").strip()
        if not text:
            continue
        for tok in seg.get("tokens", []):
            if _skip_token(tok.get("text", "")) or not tok.get("text", "").strip():
                continue
            n_tok += 1
            dtw = tok.get("t_dtw", -1)
            if dtw is not None and dtw >= 0:
                n_dtw += 1
        seg_start = off.get("from", 0) / 1000.0
        seg_end = off.get("to", 0) / 1000.0
        words = _tokens_to_words(seg.get("tokens", []), seg_start, seg_end)
        segments.append(Segment(
            start=seg_start, end=seg_end, text=text, words=words))

    n_words = sum(len(s.words) for s in segments)
    dtw_pct = (100 * n_dtw / n_tok) if n_tok else 0
    print(f"[whisper] {len(segments)} segments, {n_words} words (lang={detected}); "
          f"DTW timing on {n_dtw}/{n_tok} tokens ({dtw_pct:.0f}%) — "
          f"{'good' if dtw_pct > 80 else 'FALLING BACK to coarse offsets!'}",
          flush=True)
    return detected, segments


def segment_to_dict(seg: Segment) -> dict:
    return asdict(seg)
