# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

A **100%-local video editor** for making TikTok/opus.pro-style clips: drop a
video, get **word-level bilingual subtitles**, restyle/correct them, **reframe**
to any aspect ratio, add **image/text overlays**, cut **clips** from the
transcript, and switch between multiple synchronized camera angles (**scenes /
B-roll**). Everything runs on this machine — no cloud calls.

Target GPU: **AMD RX 6900 XT** (`gfx1030`, RDNA2) on **ROCm 7.x**.

Status: the **editor + live preview** is built (Phases 1–4 + many refinements).
**Phase 5 — export — is built as a headless-browser renderer** ("one renderer",
not an ffmpeg filtergraph): a clip renders to MP4 by loading the frontend's own
preview route in headless Chrome and screenshotting it frame by frame, so the
export matches the preview by construction (same fonts/blur/karaoke/overlays).
See `ROADMAP.md` and the **Export** section below.

## Architecture — three moving parts

1. **whisper.cpp** (`whisper-cli`, an external binary): transcription with
   **word-level timestamps** (needed for the karaoke word-highlight). Shelled out
   per job by `app/whisper.py`, NOT a server. Built by
   `scripts/build-whisper-rocm.sh`. Voxtral is *not* used for transcription
   anymore because it gives no timestamps.
2. **llama-server** (llama.cpp, hosts **Voxtral-Mini**): used for **translation**
   only (`app/translate.py`). Started by `scripts/run-voxtral.sh` on `:8080`.
   Optionally point translation at a second, stronger instruct model via
   `TRANSLATE_SERVER_URL`/`TRANSLATE_MODEL`.
3. **FastAPI app** (`app/`) + **React/TS/Vite frontend** (`frontend/`). Dev: Vite
   on `:5173` proxies `/api` to FastAPI on `:8000`. The whole editor UI is the
   React app; `app/static/index.html` is the legacy single-page text app and is
   unrelated.

## Request / data flow

Upload → `POST /api/projects` saves the video, creates a **Project** (persisted
JSON on disk), spawns a background thread (`app/pipeline.py`):
`ffprobe` metadata → `ffmpeg` 16 kHz mono WAV → `whisper-cli` → word-timed
segments. The browser polls `GET /api/projects/{id}`. Everything else (style,
frame, scenes, cuts, overlays, clips, translation) is edited live and saved with
`PATCH /api/projects/{id}` (debounced) or dedicated endpoints.

## Data model — the Project (see `app/store.py`)

A project is a directory: `data/projects/<id>/` holding `project.json`, the
source video (`source.<ext>`), extra scene videos (`scene-<id>.<ext>`),
`audio.wav`, `assets/` (overlay images), `exports/`. `project.json` keys:

- `status/progress/message/error` — processing state (`created|processing|ready|error`).
- `duration/width/height/fps`, `language`, `source_video`.
- `segments`: `[{id, start, end, text, translation, words:[{start,end,text}]}]`.
- `translate_to`, `translate_status`, `translate_progress`, `translations` (a
  block-keyed cache the frontend maintains).
- `style`: caption style — `font, font_size, primary_color, highlight_color,
  highlight_enabled, outline_*, box_* (box behind text), position, margin_v,
  uppercase, translation_enabled/scale/color/position, max_line_width_pct,
  max_lines`. Captions wrap by **pixel width** (`max_line_width_pct`) into blocks
  of `max_lines`, not by word count.
- `frame`: **project-wide output framing** — `aspect` (`original|9:16|1:1|4:5|
  16:9|free`), plus the **main scene's** crop window `{x,y,w,h}` + `mode`
  (`crop`|`fit`) + `blur_bg`. Aspect is project-wide; window+mode are per-scene.
- `scenes`: `[{id, name, filename, is_main, width, height, mode, color, crop}]`.
  `scenes[0]` is the **main** video (carries audio). Extras are muted,
  synchronized alternate angles. Each scene has its own `crop` window and `mode`
  (crop = cover, fit = contain + blurred fill) and a `color`.
- `scene_cuts`: `[{id, time, scene_id}]` — global switches; the active scene at
  time `t` is the last cut ≤ t, else main (`frontend/src/scenes.ts activeSceneId`).
- `overlays`: `[{id,type:'text'|'image', start, end, x, y, ...}]` — text has
  font/size/color/shadow/box; image has `asset/url/scale`. Coords normalized.
- `clips`: `[{id, name, start, end}]` — just a name + range; created from the
  transcript.
- `version`, `created_at`.

`store.get()` **migrates/backfills** missing keys (`normalize_style`,
`normalize_frame`, scene `mode/crop/color`, `scenes`, `scene_cuts`) so older
projects keep working — always add new fields there.

## Backend files (`app/`)

- `main.py` — FastAPI app, includes `editor.router`; still serves the legacy
  static text app at `/`.
- `editor.py` — the projects API (`/api/projects…`): create/list/get, `PATCH`
  (allowed keys: name, style, frame, translate_to, overlays, clips, scenes,
  scene_cuts), segment edit/split/merge/delete, asset upload/serve, scene
  upload/serve/delete, `/translate`, `/subtitles.ass`, **`/renders`** (POST start
  clip export(s) · GET job list · GET `/renders/{job}/file` download), video +
  scene video (Range supported via `FileResponse`).
- `render.py` — **Phase 5 export**: drives headless Chrome (Playwright) to the
  frontend's `?render=1` route, steps it via `window.__render.seek(t)`,
  screenshots each frame (JPEG `RENDER_JPEG_QUALITY`), then muxes the clip's
  source audio. Frames are split into contiguous chunks captured by
  `RENDER_PARALLELISM` browsers **in parallel** (each writes
  `<name>_frames/{i:06d}.jpg`); ffmpeg assembles the sequence. `exports.py` —
  in-memory render-job queue + bounded `ThreadPoolExecutor` (`EXPORT_CONCURRENCY`,
  clips at once); files land in `exports/`.
- `store.py` — Project persistence (JSON + in-memory cache + lock),
  defaults/migrations, `SCENE_COLORS` palette.
- `pipeline.py` — background processing worker. `whisper.py` — whisper-cli client
  (parses full JSON → words). `media.py` — ffprobe. `transcription.py` —
  ffmpeg audio extract + the legacy Voxtral client. `segments.py` — text edit /
  split / merge (re-derives word timings). `subtitles.py` — **ASS generator** for
  the `/subtitles.ass` download (no longer used by export — the headless renderer
  reuses the React captions), incl. French spacing (`french_spacing`).
  `translate.py` — llama-server translation with anti-refusal + completeness
  retries + Markdown stripping.

## Frontend files (`frontend/src/`)

- `components/Editor.tsx` — the hub: holds all state (project, style, frame,
  overlays, clips, sceneCuts, selection, playhead), the video preview, tabs, and
  keyboard handling. **This is the file that gets big and most-edited.**
- `Uploader.tsx`, `ProcessingView.tsx` — drop + progress.
- `TranscriptPanel.tsx` — editable transcript; right-click = clip start/stop &
  scene switch; per-segment **scene-color dots** to switch scene per line.
  Rendered in both the Transcription tab and (filtered) the Clips tab.
- `StylePanel.tsx`, `TranslateBar.tsx` — caption style + translation trigger.
- `OverlayLayer.tsx` (preview, drag/resize/edit) + `OverlayPanel.tsx` (controls).
- `Timeline.tsx` — scrub/seek, drag-select → clip, clip bands, and **active-scene
  color bands**.
- `ClipPanel.tsx` — clip list/edit/preview + **export** (per-clip "Exporter" and
  "Exporter tous les clips") with a polled render-job list (progress/download).
  `ScenePanel.tsx` — **Cadrage** (aspect + per-scene crop/fit) + scene
  import/delete + scene-cut list.
- `RenderPage.tsx` — the **export route** (`?render=1&project=…&clip=…`): mounts
  the bare composition (reframe + scenes + overlays + `CaptionBlock`) sized to the
  output resolution, seeks deterministically, and publishes `window.__render`
  (`ready`/`meta`/`seek`) that `app/render.py` drives. `main.tsx` routes here when
  `?render=1`.
- `CaptionBlock.tsx` — the caption block, **shared** by the editor preview and the
  render page so what you see and what you export come from the same DOM/CSS.
- `ReframeBox.tsx` — the draggable/zoomable crop rectangle (used for the main and
  for editing a secondary scene's crop). `SceneSourceVideo.tsx` — a secondary
  scene's raw source shown full while reframing it. `SceneStage.tsx` — composites
  the active scene into the output window (see below).
- `types.ts`, `captions.ts` (block wrapping, mirrors `subtitles.py`),
  `frame.ts` (aspect ratios / default crop rect), `scenes.ts` (active scene),
  `text.ts` (French spacing), `usePlayhead.ts` (rAF playhead), `api.ts`.

## Preview & compositing model (the subtle part)

The preview is **source-based**, not a true output canvas. The `.video-frame`
sizes to the displayed video; a `.frame-region` div (position = the main scene's
crop `frame.x/y/w/h`) is the **output window** and holds the captions.

- **Main, crop mode**: the base `<video controls>` shows the source; `ReframeBox`
  draws the crop window (dim outside). Base video is the audio + playhead source.
- **Main, fit mode / any active secondary scene**: a `SceneStage` composites the
  scene into the frame-region and the **base video's picture is hidden**
  (`opacity:0`, still playing for audio) so the raw source never shows around the
  window; area outside the window is black.
- `SceneStage` renders **crop** (one video sized >100% to map its crop window,
  `object-fit:fill`) or **fit** (a blurred cover copy behind + the whole scene
  contained in front). **Every scene stays mounted** (never remounted on a
  switch); only the `active` one is shown+played; switching is a CSS
  **crossfade+scale** (`.scene-overlay.active`). This is what makes switching
  stable (no reload / black / race).
- **A/V sync**: scene videos are muted and follow the main's `currentTime` by
  **nudging `playbackRate`** (0.94/1.06) to catch up, hard-seeking only on >0.5s
  drift — avoids both flicker and audio-ahead-of-image.
- Editing a **secondary scene's** crop: its own source is shown full via
  `SceneSourceVideo` (sizes the frame to that scene's aspect) with the same
  `ReframeBox` on it.

## Editing flows

- **Clips**: right-click a subtitle → "Démarrer un clip", right-click later →
  "Terminer" (word-accurate bounds). Or drag-select on the timeline → right-click.
- **Scenes**: Scènes tab imports extra videos; right-click a subtitle (or a
  per-line color dot) → "Montrer «scene» ici" / "Revenir à la principale" drops a
  `scene_cut`. Reframe/crop-fit per scene lives in the Scènes tab; aspect is
  project-wide.
- **Translation**: bilingual — original (large) + translation (small). Click
  "Traduire". French typography (NBSP before `: ; ? ! »`, after `«`) applied to
  the original when the video is French and to the translation when translating
  into French.
- **Keyboard**: Space = play/pause (prevents page scroll), ←/→ = seek ±5s (both
  ignored while typing in a field).

## Gotchas & lessons (read before editing)

- **The user co-develops this repo between turns.** Prefer `Edit` over `Write`;
  re-`Read` a file right before changing it; if content contradicts your memory,
  surface it. (A `Write` once clobbered a hand-edited file.) See memory
  `reread-before-write-cowork`.
- **No `node`/`npm` runnable in the sandbox** (and npm registry is blocked): you
  cannot run `tsc`/build here. Type-review carefully; the automatic JSX runtime
  means **never use the `React.` namespace without importing** (`React.PointerEvent`
  → `import type { PointerEvent as ReactPointerEvent }`). Ask the user to
  `npm run build`.
- **`.video-frame video { max-width:100% }` clamps scene crop videos** — the crop
  video is sized >100% to map its window; `.scene-overlay video` must set
  `max-width/max-height:none`. This was a real bug.
- **Caption z-index** must stay above scene overlays (`.caption { z-index:5 }` >
  `.scene-overlay.active { z-index:2 }`), else subtitles hide behind B-roll.
- **Export needs real Chrome, not Playwright's Chromium** — the source is
  H.264/AAC, which open-source Chromium can't decode (black frames). `render.py`
  launches `channel="chrome"`; install once with `playwright install chrome`
  (`scripts/setup-render.sh`). Export also needs the frontend reachable at
  `RENDER_BASE_URL` (default the Vite dev server `:5173`).
- **Export = one renderer.** Captions come from the SHARED `CaptionBlock`, and the
  render page reuses `captions.ts`/`frame.ts`/`scenes.ts` + the preview CSS — so
  keep those pure and shared, don't fork a second look for export. Geometry is
  reported by the page (`frame.outputSize`), so the backend never recomputes it.
- **`ClipPanel.exportClips` flushes edits first** (`Editor.flush` → `patchProject`)
  because the render reads the saved `project.json`, but the editor saves on a
  400 ms debounce.
- **whisper.cpp / ROCm**: gfx1030 is natively supported — do NOT set
  `HSA_OVERRIDE_GFX_VERSION`. Build with `-DGGML_HIP=ON -DAMDGPU_TARGETS=gfx1030`.
  For llama.cpp/Voxtral keep **Flash-Attention OFF** on gfx1030 (`--flash-attn off`
  in `run-voxtral.sh`) — the HIP FA kernel aborts. `MODEL_NAME` must equal the
  server `--alias`. Load Voxtral with `-hf` (pulls the mmproj/audio encoder).
- **Single uvicorn worker** — projects are cached in-memory and written to disk;
  state does not scale across workers.
- **No test suite / linter configured.** Ad-hoc verification is done by importing
  modules and small scripts (backend is verifiable; frontend is not, here).
- **`!` in bash heredocs** gets mangled by history expansion — write temp scripts
  with the Write tool instead of heredocs.

## Commands

```bash
./scripts/build-whisper-rocm.sh   # build whisper-cli (HIP, gfx1030) + download model
./scripts/build-llama-rocm.sh     # build llama.cpp / llama-server (for Voxtral)
./scripts/run-voxtral.sh          # Voxtral on llama-server :8080 (translation)
./scripts/run-app.sh              # FastAPI :8000 (single worker)
cd frontend && npm install && npm run dev   # Vite :5173 (proxies /api → :8000)
./scripts/fetch-fonts.sh          # bundle TikTok caption fonts (frontend/src/fonts.css)
./scripts/setup-render.sh         # export deps: pip install playwright + `playwright install chrome`
```

Open <http://127.0.0.1:5173>. Env vars in `app/config.py` (WHISPER_*, LLAMA_*,
TRANSLATE_*, CHUNK_SECONDS, `EXPORT_CONCURRENCY`, `RENDER_PARALLELISM`,
`RENDER_JPEG_QUALITY`, `RENDER_BASE_URL`, `RENDER_BROWSER_CHANNEL`,
`RENDER_BROWSER_EXECUTABLE`, …). Export needs `ffmpeg` (libx264 + aac) and Chrome.

## Next up

**Phase 5 — export: DONE** (headless-browser renderer, `app/render.py` +
`RenderPage.tsx`). Scene switches now **crossfade** (zoom-punch) via the shared
`scenes.ts sceneLayersAt`, which also `cleanCuts` (drops redundant/self cuts) and
leads the fade slightly before the cut (`TRANSITION_DUR`/`TRANSITION_LEAD`) — the
**editor preview still uses its own CSS transition**, so wire it to
`sceneLayersAt` too if they should match exactly. Open refinements: **speed**
(parallel across
`RENDER_PARALLELISM` browsers + JPEG capture; could still reuse browsers across
clips or add VAAPI GPU encode), **overlay↔B-roll stacking** (render draws
overlays above B-roll; the editor
preview can draw them behind), and **VAAPI GPU encode** on gfx1030 (currently CPU
libx264).

**Phase 6 — polish:** style presets, project list (rename/delete), load models on
demand to fit VRAM, package as a desktop-feeling local app.
