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

# --- clip export / render (app/render.py, app/exports.py) -------------------
# Export renders the frontend's own preview route in a headless browser and
# screenshots it frame by frame (see app/render.py). The frontend must be
# reachable here — the Vite dev server in dev, or the built app served by FastAPI.
# Use `localhost` (not the 127.0.0.1 literal): the Vite dev server often binds
# IPv6-only (`[::1]:5173`) under Node 17+, and `localhost` resolves to it.
RENDER_BASE_URL = os.getenv("RENDER_BASE_URL", "http://localhost:5173")
# Must be a browser with H.264/AAC codecs (the source is H.264) — Playwright's
# bundled Chromium can't decode it, so use real Chrome: `playwright install chrome`.
RENDER_BROWSER_CHANNEL = os.getenv("RENDER_BROWSER_CHANNEL", "chrome")
# Optional explicit path to a Chrome/Chromium binary, tried before the channel
# (useful if `channel="chrome"` can't find the install, e.g. odd paths).
RENDER_BROWSER_EXECUTABLE = os.getenv("RENDER_BROWSER_EXECUTABLE", "")
# How many clips to render at once ("export all"). Each clip is already rendered
# across RENDER_PARALLELISM browsers internally, so keep this low.
EXPORT_CONCURRENCY = int(os.getenv("EXPORT_CONCURRENCY", "1"))
# Browsers used in parallel to capture ONE clip's frames (contiguous chunks).
# The big speed lever. Each browser is ~300-500 MB of RAM and decodes the source,
# so returns diminish (and can reverse) once you exceed cores / GPU decode / RAM —
# on short clips the per-browser startup tax dominates. Measure vs 8.
RENDER_PARALLELISM = int(os.getenv("RENDER_PARALLELISM", "8"))
# JPEG quality (1-100) for captured frames. These frames are re-encoded to H.264
# (CRF 18) anyway, so past ~95 you only get bigger files + slower capture with no
# visible gain — 100 would work against the speed goal. 95 is the sweet spot.
RENDER_JPEG_QUALITY = int(os.getenv("RENDER_JPEG_QUALITY", "95"))
# Per-action timeout (ms) and how long to wait for the page to become ready.
RENDER_PAGE_TIMEOUT_MS = int(os.getenv("RENDER_PAGE_TIMEOUT_MS", "60000"))
RENDER_READY_TIMEOUT_MS = int(os.getenv("RENDER_READY_TIMEOUT_MS", "60000"))
# Tail (seconds) added to a clip's end when exporting. whisper collapses the
# final word's `.end` onto its segment boundary, so a clip cut at the last
# word's `.end` chops that word's audio tail (the preview only *looks* complete
# because it freezes on the last frame). This gives the last word room to
# finish — clamped so it never runs into the next spoken word or past the
# source. Matches captions.ts READ_TAIL so the caption/karaoke stay on screen
# through the tail.
EXPORT_END_PAD = float(os.getenv("EXPORT_END_PAD", "0.5"))

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
