#!/usr/bin/env python3
"""Diagnose the llama-server audio path with a 5 s synthetic WAV.

Run with the project venv:  .venv/bin/python scripts/smoke_test.py
"""
import base64
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import httpx

URL = os.getenv("LLAMA_SERVER_URL", "http://127.0.0.1:8080")
MODEL = os.getenv("MODEL_NAME", "voxtral")

# 1. Is the server up, and does it report an audio modality?
try:
    props = httpx.get(f"{URL}/props", timeout=10).json()
    print("server /props modalities:", props.get("modalities", "<not reported>"))
    print("server model:", props.get("model_path") or props.get("default_generation_settings", {}).get("model"))
except Exception as exc:  # noqa: BLE001
    print(f"Cannot reach {URL}/props -> {exc!r}")
    print("Is llama-server running? (./scripts/run-voxtral.sh)")
    sys.exit(1)

SENTENCE = "The quick brown fox jumps over the lazy dog."

# 2. Build a tiny WAV with REAL speech (so there is something to transcribe).
#    Uses espeak-ng if present; otherwise warns and falls back to a tone.
with tempfile.TemporaryDirectory() as d:
    raw = Path(d) / "speech.wav"
    wav = Path(d) / "test.wav"
    if subprocess.run(["which", "espeak-ng"], capture_output=True).returncode == 0:
        subprocess.run(["espeak-ng", "-w", str(raw), SENTENCE],
                       check=True, capture_output=True)
        print(f'synthesized speech: "{SENTENCE}"')
    else:
        print("WARNING: espeak-ng not found -> using a tone (model has nothing to "
              "transcribe). Install with: sudo apt install espeak-ng")
        subprocess.run(
            ["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=5",
             "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(raw)],
            check=True, capture_output=True,
        )
    # Normalize to 16 kHz mono PCM (what the app sends).
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(raw), "-ar", "16000", "-ac", "1",
         "-c:a", "pcm_s16le", str(wav)],
        check=True, capture_output=True,
    )
    data = base64.b64encode(wav.read_bytes()).decode("ascii")
    print(f"test WAV: {wav.stat().st_size} bytes ({len(data)} b64 chars)")

    payload = {
        "model": MODEL,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": (
                "You are an automatic speech-to-text engine. Transcribe the "
                "user's audio verbatim. Output ONLY the transcript text, no "
                "preamble or commentary. If there is no speech, output nothing.")},
            {"role": "user", "content": [
                {"type": "text", "text": "Transcribe this audio."},
                {"type": "input_audio", "input_audio": {"data": data, "format": "wav"}},
            ]},
        ],
    }
    try:
        r = httpx.post(f"{URL}/v1/chat/completions", json=payload, timeout=120)
        print("HTTP", r.status_code)
        print(r.text[:2000])
    except Exception as exc:  # noqa: BLE001
        print(f"REQUEST FAILED: {exc!r}")
        print("--> The server crashed/closed on the audio request. Check its terminal logs.")
        sys.exit(1)
