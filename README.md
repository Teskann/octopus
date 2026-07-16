# Transcript

Simple web app to transcribe videos locally. Upload a video → get a downloadable
text transcript. Transcription runs on **Voxtral-Mini** via **llama.cpp** on AMD
ROCm (built for the RX 6900 XT / gfx1030).

```
video → ffmpeg (16 kHz mono WAV) → split into chunks → llama-server (Voxtral) → stitch → .txt
```

## Prerequisites

- ROCm 7.x with your GPU visible: `rocminfo | grep gfx` shows `gfx1030`.
  Make sure your user is in the `video` and `render` groups (access to
  `/dev/kfd` and `/dev/dri`).
- `ffmpeg` and `ffprobe` on `PATH`.
- Python 3.11+ (uses `X | Y` type syntax).
- The ROCm/HIP toolchain (`hipcc`, `hipconfig`) to build llama.cpp.

## Setup

```bash
# 1. Build llama.cpp with the HIP backend (one time, ~10 min)
./scripts/build-llama-rocm.sh

# 2. Python deps
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Run

Two processes. Start the model server first (downloads the model on first run):

```bash
# Terminal 1 — Voxtral on llama-server (OpenAI-compatible API on :8080)
./scripts/run-voxtral.sh

# Terminal 2 — the web app
./scripts/run-app.sh
```

Open <http://127.0.0.1:8000>, drop a video, download the transcript.

## Video editor (in development)

A local, opus.pro-style editor is being built on top of this app: drag & drop a
video → auto bilingual TikTok-style subtitles → correct/style them → add images,
text, intro/outro → select clips on a timeline → export with everything burned
in. See [`ROADMAP.md`](ROADMAP.md) for the plan and phases.

It adds **whisper.cpp** (word-level timestamps, needed for the karaoke
highlight) alongside Voxtral, and a **React + Vite** frontend.

```bash
# Build whisper.cpp with HIP + download the model (one time)
./scripts/build-whisper-rocm.sh

# Download the bundled caption fonts (one time) — installs them for the browser
# preview and for the libass export (fontconfig)
./scripts/fetch-fonts.sh

# Backend (projects API is served by the same FastAPI app)
./scripts/run-app.sh                      # :8000

# Frontend dev server (proxies /api to :8000)
cd frontend && npm install && npm run dev # :5173
```

### Caption fonts

`scripts/fetch-fonts.sh` downloads a few punchy, TikTok-friendly fonts (all SIL
Open Font License) into `frontend/public/fonts/` and installs them for the
export. The font picker also lists fonts already installed on your system
(`fc-list`). To add your own, drop the `.ttf` in `frontend/public/fonts/`, add
an `@font-face` in `frontend/src/fonts.css`, and list it in `StylePanel.tsx`.

| Font | Source |
|------|--------|
| Anton | <https://github.com/googlefonts/AntonFont> |
| Bebas Neue | <https://github.com/dharmatype/Bebas-Neue> |
| Oswald | <https://github.com/googlefonts/OswaldFont> |
| Montserrat | <https://github.com/JulietaUla/Montserrat> |

Other good caption fonts (drop-in): Poppins
(<https://github.com/itfoundry/Poppins>), Inter (<https://github.com/rsms/inter>),
Roboto (<https://github.com/googlefonts/roboto>).

Open <http://127.0.0.1:5173>, drop a video, and you get word-synced captions.
Phase 1 (transcription + timeline-synced preview) is in; styling, translation,
overlays, clips and export follow (see the roadmap).

## How it works

- The browser uploads the video; the server streams it to disk and starts a
  background job, then the browser polls `/api/jobs/{id}` for progress.
- `ffmpeg` extracts 16 kHz mono WAV (what Voxtral expects).
- Voxtral handles ~30 min of audio per pass, so longer files are split into
  fixed-length chunks (`CHUNK_SECONDS`, default 600 s) and each chunk is sent to
  `llama-server` as base64 `input_audio` on `/v1/chat/completions`.
- The per-chunk transcriptions are concatenated into one `.txt`.

## Configuration

Environment variables (see `app/config.py`):

| Var | Default | Meaning |
|-----|---------|---------|
| `LLAMA_SERVER_URL` | `http://127.0.0.1:8080` | Where llama-server listens |
| `MODEL_NAME` | `voxtral` | Must match `--alias` in `run-voxtral.sh` |
| `CHUNK_SECONDS` | `600` | Audio seconds per chunk |
| `REQUEST_TIMEOUT` | `1800` | Per-chunk HTTP timeout |
| `UPLOAD_DIR` / `OUTPUT_DIR` | `data/...` | Working dirs |

## Limitations

- **No speaker diarization** ("who spoke?") in this local flow. For that, use the
  Mistral API `diarize` option or pair with pyannote / WhisperX.
- Voxtral covers 8 languages (en, fr, de, es, it, pt, nl, hi) with auto-detection.
- Jobs live in memory — single uvicorn worker, no persistence across restarts.
- Chunk boundaries are time-based, so a word can occasionally be split between
  two chunks.
