# Roadmap — Local video editor with TikTok-style bilingual subtitles

Goal: a 100 %-local, opus.pro-like editor. Drag & drop a video → auto
transcription + bilingual subtitles → correct/style them → add images, extra
text, intro/outro → select clips on a timeline → export with burned-in
subtitles, chosen aspect ratio and a blurred-video background fill.

Everything runs on this machine (RX 6900 XT, ROCm). No cloud calls.

## Locked-in decisions

- **Transcription + timing:** `whisper.cpp` (ROCm/HIP) — native word-level
  timestamps, needed for the karaoke word-highlight effect. Voxtral has no
  timestamps, so it is *not* used for the base transcript anymore.
- **Subtitles:** bilingual — original language large, translation smaller
  underneath (e.g. FR large / EN small).
- **Translation:** local, reusing the existing `llama-server` (Voxtral/Mistral)
  for text translation.
- **Export:** *"one renderer"* — a clip is rendered by loading the frontend's own
  preview route in **headless Chrome** and screenshotting it frame by frame
  (`app/render.py` + `RenderPage.tsx`), then muxing audio with `ffmpeg`. The
  export matches the preview by construction (same fonts/blur/karaoke/overlays),
  instead of re-implementing the look in an ffmpeg filtergraph.
- **Frontend:** React + TypeScript + Vite. Dev via Vite proxy → FastAPI `:8000`;
  prod serves the built bundle from FastAPI.

## Architecture

Two long-running model servers + the app:

- `whisper.cpp` (`whisper-cli`, shelled out per job) — transcript + word times.
- `llama-server` (existing) — translation of segments.
- FastAPI app — projects API + ffmpeg orchestration; React editor UI.

A **Project** is persisted on disk (`data/projects/<id>/project.json` + the
source video + assets), because the editor needs durable, editable state
(unlike the old in-memory text jobs).

```
data/projects/<id>/
  project.json      # segments, style, overlays, clips, metadata
  source.<ext>      # the uploaded video
  audio.wav         # 16 kHz mono (whisper input, cached)
  assets/           # uploaded overlay images
  exports/          # rendered clips
```

## Epics & user stories

### Epic A — Ingest & transcribe  *(Phase 1)*
- As a user I drag & drop a video and it uploads with a progress bar.
- The app extracts audio and transcribes it with **word-level timestamps**.
- I see the transcript as time-synced segments that highlight during playback.

### Epic B — Subtitles & style  *(Phase 2)*
- Segments are translated to my second language.
- I see live TikTok-style captions (word-by-word highlight) over the video.
- I customise style: font, size, colour, outline, highlight colour, position,
  and the size ratio between the original and the translation line.

### Epic C — Correct & enrich  *(Phase 3)*
- I fix wrong words directly in the transcript; timing stays aligned.
- I split/merge/retime segments.
- I drop images onto the video at a position for a time range.
- I add extra free text (titles, callouts).

### Epic D — Timeline & clips  *(Phase 4)*
- I scrub a timeline of the whole video.
- I select a range, right-click → **Generate clip**.
- A clip has its own aspect ratio, blurred-video background fill, and
  intro/outro — edited independently from the source.

### Epic E — Export  *(Phase 5)* — **done**
- I export a clip to MP4 with everything burned in (captions, overlays, reframe,
  scene switches with crossfade) — pixel-matching the preview.
- Aspect ratio is applied by cropping/scaling; empty space is filled with a
  blurred, scaled copy of the video.
- I get a progress bar and a download (per clip, or "export all clips").
- Rendered by headless Chrome capturing the preview route in parallel across
  `RENDER_PARALLELISM` browsers; `ffmpeg` assembles the JPEG frames + audio.

### Epic F — Polish  *(Phase 6)*
- Style presets, project list (rename/delete), load models on demand to fit
  VRAM, packaging as a desktop-feeling local app.

## Phase status

- [x] **Phase 1** — Foundation: timestamped transcription + project model + editor shell
- [x] **Phase 2** — Subtitle rendering, style & bilingual translation
- [x] **Phase 3** — Transcript correction + image/text overlays
- [x] **Phase 4** — Timeline & clip selection
- [x] **Phase 5** — Export/render pipeline (headless-browser "one renderer")
- [~] **Phase 6** — Polish ← **in progress**
  - [x] Project list on the home screen (open / rename / delete)
  - [x] Caption style presets (built-in looks + save/apply/delete your own)
  - [ ] Load models on demand to fit VRAM
  - [ ] Package as a desktop-feeling local app

## Built beyond the original phases (refinements)

The editor + **live preview** and the **export** (Phase 5) are done. On top of
Phases 1–4 the following was added — all of it is both previewed live *and*
rendered on export (the export reuses the preview's own React/CSS):

- **Reframing**: project-wide aspect + per-scene crop window (drag/zoom
  `ReframeBox`) and per-scene **crop vs fit** (fit = contain + blurred fill). When
  a scene is composited the base video is hidden so the source never shows around
  the output window.
- **Multi-scene B-roll**: import extra synchronized (muted) camera angles; switch
  scenes from the transcript (right-click or per-line color dots); global
  `scene_cuts`; zoom-punch crossfade; scene colors surfaced in the timeline
  (bands) and transcript (dots). Stable playback via persistent mounted players +
  `playbackRate` A/V sync (no flicker, no desync).
- **Subtitles**: caption box, editable text/translation, French NBSP typography,
  translation on/off + position, robust translation prompt (no refusals /
  omissions / Markdown).
- **UX**: play/pause + time bar, Space play/pause (no page scroll), ←/→ seek ±5s.
- **Export (Phase 5)**: headless-Chrome "one renderer" — a clip's frames are
  captured from the preview route (`?render=1`) in parallel across
  `RENDER_PARALLELISM` browsers and muxed with `ffmpeg`. Scene switches crossfade
  (zoom-punch, shared `scenes.ts sceneLayersAt`, redundant/self cuts dropped, fade
  led slightly before the cut); the editor preview uses the same timing so what
  you see matches what you download. Per-clip and "export all" with polled
  progress + download. Needs real Chrome (H.264) and the frontend reachable at
  `RENDER_BASE_URL`.

Data model additions to remember: `frame` (aspect+mode+crop+blur_bg), `scenes`
(with mode/crop/color), `scene_cuts`. All migrated in `store.get()`.

## Notes / trade-offs to revisit

- whisper.cpp base transcript may be slightly less accurate than Voxtral. If it
  matters, revisit with Voxtral-text + forced alignment later.
- whisper's built-in translate only targets English; using `llama-server` keeps
  any language pair open.
- Jobs/state are single-process (one uvicorn worker), same constraint as today.
