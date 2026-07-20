# Octopus 🐙

A **100 %-local video editor** for making TikTok / Shorts / opus.pro-style clips.
Drop a video and get **word-level bilingual subtitles**, restyle and correct them,
**reframe** to any aspect ratio, add **image / text overlays**, cut **clips** from
the transcript, and switch between multiple synchronized camera angles
(**scenes / B-roll**). Everything runs on this machine — **no cloud calls**.

Target GPU: **AMD RX 6900 XT** (`gfx1030`, RDNA2) on **ROCm 7.x**.

```
upload → ffmpeg (16 kHz mono WAV) → whisper.cpp (word timestamps) → editor
      → llama-server (Voxtral) translation → headless-Chrome render → MP4
```

See [`ROADMAP.md`](ROADMAP.md) for phase status and [`CLAUDE.md`](CLAUDE.md) for
the architecture, data model and gotchas.

## What you can do

- **Transcribe** with word-level timestamps (karaoke word-highlight captions).
- **Bilingual subtitles** — original language large, translation smaller
  underneath — with live TikTok-style captions over the video.
- **Style captions** — font, size, colours, outline, highlight, box, position,
  uppercase, line wrapping; save/apply your own **style presets**.
- **Correct the transcript** in place (edit / split / merge / delete segments);
  word timing stays aligned.
- **Reframe** to any aspect (`9:16`, `1:1`, `4:5`, `16:9`, …) with a per-scene
  crop window, **crop** (cover) or **fit** (contain + blurred background fill).
- **Overlays** — drop images or free text (titles, callouts) for a time range.
- **Scenes / B-roll** — import extra synchronized camera angles and switch
  between them from the transcript; switches **crossfade** (zoom-punch).
- **Clips** — select a range on the timeline or from the transcript and cut a
  named clip, edited independently from the source.
- **Export** — render a clip (or all clips) to MP4 with everything burned in,
  **pixel-matching the preview** (see [Export](#export) below).

## Architecture — moving parts

1. **whisper.cpp** (`whisper-cli`, external binary) — transcription with
   word-level timestamps. Shelled out per job by `app/whisper.py`, built by
   `scripts/build-whisper-rocm.sh`.
2. **llama-server** (llama.cpp hosting **Voxtral-Mini**) — used for **translation**
   only (`app/translate.py`). Started by `scripts/run-voxtral.sh` on `:8080`.
   Optionally point translation at a stronger instruct model via
   `TRANSLATE_SERVER_URL` / `TRANSLATE_MODEL`.
3. **FastAPI app** (`app/`) + **React / TypeScript / Vite frontend** (`frontend/`).
   Dev: Vite on `:5173` proxies `/api` to FastAPI on `:8000`.
4. **MCP server** (`mcp_server/`) — optional; lets an agent (Claude Code) drive
   the editor. See [Agent control](#agent-control-mcp) below.

A **Project** is persisted on disk (`data/projects/<id>/`): `project.json`
(segments, style, frame, scenes, scene_cuts, overlays, clips, translations…),
the source video, extra scene videos, `audio.wav`, `assets/`, `exports/`.

## Prerequisites

- ROCm 7.x with your GPU visible: `rocminfo | grep gfx` shows `gfx1030`. Your
  user must be in the `video` and `render` groups (access to `/dev/kfd` and
  `/dev/dri`).
- `ffmpeg` and `ffprobe` on `PATH` (export needs libx264 + aac).
- Python 3.11+ (uses `X | Y` type syntax).
- The ROCm / HIP toolchain (`hipcc`, `hipconfig`) to build whisper.cpp / llama.cpp.
- Node.js + npm for the frontend (the npm registry must be reachable to install).
- **Google Chrome** for export (real Chrome, not Playwright's Chromium — see below).

## Setup

```bash
# 1. Build whisper.cpp with HIP + download the model (one time)
./scripts/build-whisper-rocm.sh

# 2. Build llama.cpp / llama-server for Voxtral (one time, ~10 min)
./scripts/build-llama-rocm.sh

# 3. Python deps
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 4. Bundle the TikTok caption fonts (one time) — for the browser preview
./scripts/fetch-fonts.sh

# 5. Export deps: Playwright + real Chrome (one time)
./scripts/setup-render.sh
```

## Run

```bash
# Terminal 1 — Voxtral on llama-server (translation) on :8080
./scripts/run-voxtral.sh

# Terminal 2 — FastAPI app (projects API) on :8000, single worker
./scripts/run-app.sh

# Terminal 3 — Vite dev server (proxies /api → :8000) on :5173
cd frontend && npm install && npm run dev
```

Open <http://127.0.0.1:5173>, drop a video, and you get word-synced captions to
style, translate, reframe, clip and export.

> The legacy single-page text app is still served by FastAPI at
> <http://127.0.0.1:8000> (`app/static/index.html`) — unrelated to the editor.

## Export

Export is a **headless-browser renderer** — *"one renderer"*, not an ffmpeg
filtergraph. A clip is rendered by loading the frontend's own preview route in
**headless Chrome** (`?render=1`) and screenshotting it frame by frame, then
muxing the source audio with `ffmpeg`. Because the export reuses the preview's
own React components and CSS, the output **matches the preview by construction**
(same fonts, blur, karaoke, overlays, scene crossfades).

Frames are split into contiguous chunks captured by `RENDER_PARALLELISM` browsers
**in parallel**; `ffmpeg` assembles the JPEG sequence into H.264. Per-clip
"Exporter" and "Exporter tous les clips" both run via a polled render-job queue
with progress + download (`ClipPanel.tsx`).

**Requirements:** real **Chrome** (the source is H.264/AAC, which Playwright's
open-source Chromium can't decode — you'd get black frames), and the frontend
reachable at `RENDER_BASE_URL` (default the Vite dev server, `http://localhost:5173`).

## Agent control (MCP)

`mcp_server/` exposes the editor's controls to an agent (Claude Code) over an MCP
`transcript` server (`.mcp.json`). It is a thin HTTP client to the running
FastAPI app (`TRANSCRIPT_API`, default `http://localhost:8000`) — it never touches
`project.json` directly, so the app's in-memory cache stays the single source of
truth. Tools cover the whole workflow: list/find projects, read & edit the
transcript, translate, set style/frame, manage scenes & scene cuts, add overlays,
create/retime clips, apply presets, and start/monitor exports. The
[`generate_clips`](.claude/skills/generate_clips/SKILL.md) skill drives it to turn
a talk into publish-ready shorts.

## How transcription works

- The browser uploads the video; the server streams it to disk and starts a
  background job (`app/pipeline.py`), then polls `GET /api/projects/{id}`.
- `ffmpeg` extracts 16 kHz mono WAV (what whisper expects).
- `whisper-cli` transcribes with DTW word timestamps (`-nfa` — flash-attention
  off — is required, or DTW is silently disabled; see `CLAUDE.md`).
- Translation is done on demand by `llama-server` (Voxtral), one block at a time,
  and cached in `project.json`.

## Configuration

Environment variables (see `app/config.py`):

| Var | Default | Meaning |
|-----|---------|---------|
| `WHISPER_BIN` / `WHISPER_MODEL` | `../whisper.cpp/…` | whisper-cli binary + ggml model |
| `WHISPER_DTW` | `large.v3.turbo` | DTW model alias (accurate word times) |
| `WHISPER_THREADS` | `8` | whisper CPU threads |
| `LLAMA_SERVER_URL` | `http://127.0.0.1:8080` | Where llama-server listens |
| `MODEL_NAME` | `voxtral` | Must match `--alias` in `run-voxtral.sh` |
| `TRANSLATE_SERVER_URL` / `TRANSLATE_MODEL` | = llama-server / `MODEL_NAME` | Optional stronger translation model |
| `CHUNK_SECONDS` | `600` | Audio seconds per transcription chunk |
| `REQUEST_TIMEOUT` | `1800` | Per-chunk llama-server HTTP timeout |
| `RENDER_BASE_URL` | `http://localhost:5173` | Where the frontend is reachable for export |
| `RENDER_BROWSER_CHANNEL` | `chrome` | Browser channel used for export (needs H.264) |
| `RENDER_PARALLELISM` | `8` | Browsers capturing one clip's frames in parallel |
| `RENDER_JPEG_QUALITY` | `95` | Captured-frame JPEG quality |
| `EXPORT_CONCURRENCY` | `1` | Clips rendered at once ("export all") |
| `UPLOAD_DIR` / `OUTPUT_DIR` / `PROJECTS_DIR` | `data/…` | Working dirs |

## Caption fonts

`scripts/fetch-fonts.sh` downloads a few punchy, TikTok-friendly fonts (all SIL
Open Font License) into `frontend/public/fonts/`. The font picker also lists fonts
installed on your system (`fc-list`). To add your own, drop the `.ttf` in
`frontend/public/fonts/`, add an `@font-face` in `frontend/src/fonts.css`, and
list it in `StylePanel.tsx`.

| Font | Source |
|------|--------|
| Anton | <https://github.com/googlefonts/AntonFont> |
| Bebas Neue | <https://github.com/dharmatype/Bebas-Neue> |
| Oswald | <https://github.com/googlefonts/OswaldFont> |
| Montserrat | <https://github.com/JulietaUla/Montserrat> |

Other good drop-ins: Poppins (<https://github.com/itfoundry/Poppins>), Inter
(<https://github.com/rsms/inter>), Roboto (<https://github.com/googlefonts/roboto>).

## Limitations

- **No speaker diarization** ("who spoke?") in this local flow.
- whisper.cpp covers many languages with auto-detection; translation quality
  depends on the llama-server model you point it at.
- Projects are cached in-memory + written to disk — **single uvicorn worker**;
  state does not scale across workers.
- Export needs real Chrome and the frontend running; rendering is CPU libx264
  (VAAPI GPU encode on gfx1030 is a future refinement).
