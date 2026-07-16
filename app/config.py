"""Runtime configuration, overridable via environment variables."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", BASE_DIR / "data" / "uploads"))
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", BASE_DIR / "data" / "outputs"))

# Editor projects live here, one directory per project (see app/store.py).
PROJECTS_DIR = Path(os.getenv("PROJECTS_DIR", BASE_DIR / "data" / "projects"))

# --- whisper.cpp (word-level transcription) ---------------------------------
# whisper-cli binary built by scripts/build-whisper-rocm.sh, and a ggml model.
# DTW ("dynamic time warping") gives accurate per-word timestamps; its value is
# the alias for the model in use (e.g. large-v3-turbo -> "large.v3.turbo").
WHISPER_BIN = Path(os.getenv(
    "WHISPER_BIN", BASE_DIR.parent / "whisper.cpp" / "build" / "bin" / "whisper-cli"))
WHISPER_MODEL = Path(os.getenv(
    "WHISPER_MODEL",
    BASE_DIR.parent / "whisper.cpp" / "models" / "ggml-large-v3-turbo.bin"))
WHISPER_DTW = os.getenv("WHISPER_DTW", "large.v3.turbo")
WHISPER_THREADS = int(os.getenv("WHISPER_THREADS", "8"))

# Where llama-server (Voxtral) is listening.
LLAMA_SERVER_URL = os.getenv("LLAMA_SERVER_URL", "http://127.0.0.1:8080")

# Must match `--alias` passed to llama-server (see scripts/run-voxtral.sh).
MODEL_NAME = os.getenv("MODEL_NAME", "voxtral")

# Translation reuses the same llama-server by default, but you can point it at a
# separate, stronger instruct model (run a second llama-server) for better
# subtitle translations — set these two env vars.
TRANSLATE_SERVER_URL = os.getenv("TRANSLATE_SERVER_URL", LLAMA_SERVER_URL)
TRANSLATE_MODEL = os.getenv("TRANSLATE_MODEL", MODEL_NAME)

# Seconds of audio per chunk sent to Voxtral. Voxtral-Mini can take ~30 min in
# one go, but smaller chunks keep the server's context bounded and make progress
# granular. Keep this comfortably under the server's -c (context) budget:
# audio costs roughly ~750 tokens per minute.
CHUNK_SECONDS = int(os.getenv("CHUNK_SECONDS", "600"))

# Per-request timeout when calling llama-server (seconds). A 10 min chunk can
# take a while on first run / cold cache.
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "1800"))

# Anti-repetition sampling. Quantized models can get stuck looping a phrase on
# non-speech audio (silence/music); these keep that in check.
REPEAT_PENALTY = float(os.getenv("REPEAT_PENALTY", "1.1"))
REPEAT_LAST_N = int(os.getenv("REPEAT_LAST_N", "256"))
DRY_MULTIPLIER = float(os.getenv("DRY_MULTIPLIER", "0.6"))  # 0 disables DRY sampling

# Hard cap on tokens emitted per chunk: a backstop so a repetition loop can never
# run away. Speech tops out around ~8 tokens/s, so this never truncates real
# transcripts while bounding garbage to the chunk's worth of output.
MAX_OUTPUT_TOKENS = int(os.getenv("MAX_OUTPUT_TOKENS", str(CHUNK_SECONDS * 8)))

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
