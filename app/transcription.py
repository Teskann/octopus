"""ffmpeg-based audio pipeline + Voxtral (llama-server) transcription client."""
from __future__ import annotations

import base64
import json
import subprocess
from pathlib import Path
from typing import Callable

import httpx

from . import config


class TranscriptionError(RuntimeError):
    """Raised when an ffmpeg step or a llama-server call fails."""


def _run(cmd: list[str]) -> str:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise TranscriptionError(
            f"Command failed ({proc.returncode}): {' '.join(cmd)}\n"
            f"{proc.stderr[-2000:]}"
        )
    return proc.stdout


def extract_audio(video_path: Path, wav_path: Path) -> None:
    """Convert any video to 16 kHz mono PCM WAV, which is what Voxtral expects."""
    _run([
        "ffmpeg", "-y", "-i", str(video_path),
        "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
        str(wav_path),
    ])


def audio_duration(wav_path: Path) -> float:
    out = _run([
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(wav_path),
    ])
    return float(out.strip())


def split_audio(wav_path: Path, chunk_dir: Path, chunk_seconds: int) -> list[Path]:
    """Cut the WAV into fixed-length segments. Boundaries are time-based, so a
    word can occasionally be split across two chunks; acceptable for now."""
    duration = audio_duration(wav_path)
    chunks: list[Path] = []
    start = 0.0
    idx = 0
    while start < duration:
        out = chunk_dir / f"chunk_{idx:04d}.wav"
        _run([
            "ffmpeg", "-y",
            "-ss", str(start), "-t", str(chunk_seconds),
            "-i", str(wav_path),
            "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
            str(out),
        ])
        chunks.append(out)
        start += chunk_seconds
        idx += 1
    return chunks


# A system message keeps Voxtral-Mini (an instruct model) from adding preamble
# or refusing — without it, it tends to answer conversationally instead of just
# transcribing.
SYSTEM_PROMPT = (
    "You are an automatic speech-to-text engine. Transcribe the user's audio "
    "verbatim. Output ONLY the transcript text with natural punctuation — no "
    "preamble, no explanations, no commentary, no quotation marks. If the audio "
    "contains no intelligible speech, output nothing at all."
)


def _build_prompt(language: str | None) -> str:
    prompt = "Transcribe this audio."
    if language:
        prompt += f" The audio is in {language}."
    return prompt


def transcribe_file(
    wav_path: Path,
    language: str | None = None,
    on_delta: Callable[[str], None] | None = None,
) -> str:
    """Transcribe one audio file via llama-server, streaming tokens.

    Tokens are forwarded to `on_delta` as they arrive (for live display) and the
    full transcript is returned. The repeat-penalty / DRY sampling and the
    `max_tokens` cap guard against the model getting stuck repeating a phrase on
    non-speech audio.
    """
    data = base64.b64encode(wav_path.read_bytes()).decode("ascii")
    payload = {
        "model": config.MODEL_NAME,
        "temperature": 0.0,
        "repeat_penalty": config.REPEAT_PENALTY,
        "repeat_last_n": config.REPEAT_LAST_N,
        "dry_multiplier": config.DRY_MULTIPLIER,
        "max_tokens": config.MAX_OUTPUT_TOKENS,
        "stream": True,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": _build_prompt(language)},
                    {"type": "input_audio",
                     "input_audio": {"data": data, "format": "wav"}},
                ],
            },
        ],
    }
    parts: list[str] = []
    try:
        with httpx.stream(
            "POST",
            f"{config.LLAMA_SERVER_URL}/v1/chat/completions",
            json=payload,
            timeout=config.REQUEST_TIMEOUT,
        ) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines():
                if not line.startswith("data:"):
                    continue
                chunk = line[len("data:"):].strip()
                if chunk == "[DONE]":
                    break
                delta = json.loads(chunk)["choices"][0]["delta"].get("content")
                if delta:
                    parts.append(delta)
                    if on_delta:
                        on_delta(delta)
    except httpx.HTTPError as exc:
        raise TranscriptionError(f"llama-server request failed: {exc}") from exc
    return "".join(parts).strip()
