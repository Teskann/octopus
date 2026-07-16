# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local video-transcription web app. Upload a video, get a downloadable text
transcript. Transcription is done by **Voxtral-Mini-3B** served through
**llama.cpp** (`llama-server`) on **AMD ROCm/HIP** — target GPU is an RX 6900 XT
(`gfx1030`, RDNA2). There is no cloud call anywhere.

## Architecture

Two separate processes, talking over HTTP:

1. **`llama-server`** (from a llama.cpp build) hosts Voxtral and exposes an
   OpenAI-compatible `/v1/chat/completions` endpoint that accepts audio. Started
   by `scripts/run-voxtral.sh`. This is *not* part of the Python codebase — it is
   an external binary the app depends on.
2. **FastAPI app** (`app/`) — the upload UI and the orchestration.

Request flow for one upload (`app/jobs.py:run_job`):

```
POST /api/transcribe  → save video, create Job, spawn background thread
   ffmpeg            → extract 16 kHz mono PCM WAV          (transcription.extract_audio)
   ffmpeg/ffprobe    → split WAV into CHUNK_SECONDS chunks  (transcription.split_audio)
   per chunk:        → base64 → llama-server input_audio    (transcription.transcribe_file)
   join chunks       → write .txt to OUTPUT_DIR
Browser polls GET /api/jobs/{id} for progress, then GET .../download
```

### Key files

- `app/main.py` — FastAPI routes (`/`, `/api/transcribe`, `/api/jobs/{id}`,
  `.../download`). Uploads stream to disk; transcription runs in a background
  `threading.Thread`.
- `app/jobs.py` — in-memory `JOBS` dict + `run_job` worker (the whole pipeline).
- `app/transcription.py` — the only place that shells out to ffmpeg/ffprobe and
  the only place that calls llama-server.
- `app/config.py` — all tunables, env-overridable.
- `app/static/index.html` — self-contained UI (no build step, no framework).
- `scripts/` — build llama.cpp (ROCm), run the model server, run the app.

## Commands

```bash
./scripts/build-llama-rocm.sh   # build llama.cpp + llama-server with HIP (gfx1030)
./scripts/run-voxtral.sh        # start Voxtral on llama-server :8080 (downloads model on first run)
./scripts/run-app.sh            # start FastAPI on :8000  (uvicorn, single worker)

pip install -r requirements.txt
```

There is no test suite or linter configured yet.

## Things that bite

- **gfx1030 is natively supported by ROCm 7.x** — do *not* set
  `HSA_OVERRIDE_GFX_VERSION` (that is only for unsupported cards). Build with
  `-DGGML_HIP=ON -DAMDGPU_TARGETS=gfx1030`.
- **Do not use vLLM on this card.** vLLM performs badly on gfx1030 (RDNA2);
  llama.cpp is the correct backend here. This is a deliberate choice.
- **Flash Attention must be OFF on gfx1030.** The HIP Flash-Attention kernel
  aborts (`ggml_abort` in `launch_fattn` / `ggml_cuda_flash_attn_ext_tile_case`)
  during decode and core-dumps the server. `run-voxtral.sh` passes
  `--flash-attn off` for this reason — do not remove it (overridable via `FA=`).
- **`MODEL_NAME` must equal the server's `--alias`** (`voxtral` on both sides),
  otherwise the chat-completions call is rejected.
- **Load the model with `-hf`.** Loading the GGUF manually can make llama-server
  reject `input_audio` content; `-hf` pulls the matching mmproj (audio encoder)
  and wires it up.
- **Context vs chunk length.** Audio costs ~750 tokens/minute. Keep
  `CHUNK_SECONDS` comfortably under the server's `-c` (default 16384 ≈ ~10 min of
  audio + output). Voxtral itself caps at ~30 min of audio per pass, which is why
  long files are chunked at all.
- **Jobs are in-memory** — run a single uvicorn worker; state does not survive a
  restart.
- **Repetition loops on non-speech audio.** The Q4 model can get stuck emitting a
  phrase hundreds of times on silence/music. `transcribe_file` sends
  `repeat_penalty` + DRY sampling and a `max_tokens` cap (`MAX_OUTPUT_TOKENS`,
  ~8 tok/s × chunk) as a backstop. Don't drop these.

## Live transcript streaming

`transcribe_file` requests `stream: true` and parses the SSE `data:` lines,
calling `on_delta` per token. `jobs.run_job` appends those tokens to `job.text`;
`GET /api/jobs/{id}` returns `text`, and the browser polls every 600 ms and
re-renders it (with a blinking cursor) so words appear as they are produced. This
is poll-based, not SSE/WebSocket — deliberately simple, single-process.

## Known limitations (by design, not bugs)

- No speaker diarization in the local flow (would need Mistral API `diarize` or
  pyannote / WhisperX).
- Chunk boundaries are time-based, so a word can occasionally be split across two
  chunks. Silence-aware splitting (ffmpeg `silencedetect`) would improve this.
- Voxtral languages: en, fr, de, es, it, pt, nl, hi (auto-detected). The optional
  language field in the UI just appends a hint to the prompt.
