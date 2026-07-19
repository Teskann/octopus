import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api } from "../api";
import { usePlayhead } from "../usePlayhead";
import { buildCues, activeCueIndex } from "../captions";
import { CaptionBlock } from "./CaptionBlock";
import { ContextPanel } from "./ContextPanel";
import { StylePanel } from "./StylePanel";
import { TranslateBar } from "./TranslateBar";
import { TranscriptPanel } from "./TranscriptPanel";
import { OverlayPanel } from "./OverlayPanel";
import { OverlayLayer } from "./OverlayLayer";
import { Timeline } from "./Timeline";
import { ClipPanel } from "./ClipPanel";
import { ReframeBox } from "./ReframeBox";
import { SceneStage } from "./SceneStage";
import { ScenePanel } from "./ScenePanel";
import { SceneSourceVideo } from "./SceneSourceVideo";
import { activeSceneId, cleanCuts, TRANSITION_DUR, TRANSITION_LEAD } from "../scenes";
import { defaultFrameRect } from "../frame";
import { formatTime } from "../time";
import type { Clip, FitMode, Frame, Overlay, Project, Scene, SceneCut, Segment, Style } from "../types";

const REFERENCE_WIDTH = 1080; // style authored against this (matches backend)

type Rect = { x: number; y: number; w: number; h: number };

// Map a crop window onto its container: the video is blown up so the crop
// sub-rectangle exactly fills the (output-aspect) container, offset to it. Same
// math as SceneStage / the export, so the preview matches the export.
function cropMap(c: Rect): CSSProperties {
  return {
    position: "absolute",
    width: `${100 / c.w}%`,
    height: `${100 / c.h}%`,
    left: `${(-c.x * 100) / c.w}%`,
    top: `${(-c.y * 100) / c.h}%`,
  };
}

export function Editor({
  initial,
  onReprocess,
}: {
  initial: Project;
  onReprocess: (id: string) => void;
}) {
  const [project, setProject] = useState<Project>(initial);
  const [style, setStyle] = useState<Style>(initial.style);
  const [overlays, setOverlays] = useState<Overlay[]>(initial.overlays);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [clips, setClips] = useState<Clip[]>(initial.clips);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [pendingClipStartId, setPendingClipStartId] = useState<string | null>(null);
  const [previewEnd, setPreviewEnd] = useState<number | null>(null);
  // Start of the clip currently being previewed (null = free playback). While a
  // clip preview is running we hide any caption that began before it, so a clip
  // never opens on the previous segment's leftover subtitle.
  const [previewStart, setPreviewStart] = useState<number | null>(null);
  const [frame, setFrame] = useState<Frame>(initial.frame);
  const [whisperPrompt, setWhisperPrompt] = useState<string>(initial.whisper_prompt || "");
  const [sceneCuts, setSceneCuts] = useState<SceneCut[]>(initial.scene_cuts);
  const [selectedSceneId, setSelectedSceneId] = useState<string>("main");
  const [playing, setPlaying] = useState(false);
  // Set when the project changed on disk from OUTSIDE this editor (e.g. an MCP
  // agent), so we can offer a reload instead of silently diverging.
  const [externalChange, setExternalChange] = useState(false);
  // Right-pane nav. `null` = panel collapsed (click the active tab to hide it).
  const [tab, setTab] = useState<"subtitles" | "overlays" | "clips" | "scenes" | null>("subtitles");
  const openTab = (name: "subtitles" | "overlays" | "clips" | "scenes") =>
    setTab((cur) => (cur === name ? null : name));
  const videoRef = useRef<HTMLVideoElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const [videoWidth, setVideoWidth] = useState(0);
  const [regionWidth, setRegionWidth] = useState(0);
  const [outer, setOuter] = useState({ w: 0, h: 0 });
  const t = usePlayhead(videoRef);
  const saveTimer = useRef<number>();
  const overlayTimer = useRef<number>();
  const clipTimer = useRef<number>();
  const frameTimer = useRef<number>();
  const cutsTimer = useRef<number>();
  const sceneTimer = useRef<number>();
  const promptTimer = useRef<number>();

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const measure = () => setVideoWidth(v.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(v);
    return () => ro.disconnect();
  }, []);

  // Measure the output window (frame-region) on screen — captions are authored
  // against a 1080-wide output, so this drives their scale in both preview modes.
  useEffect(() => {
    const el = regionRef.current;
    if (!el) return;
    const measure = () => setRegionWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Available space for the cropped preview (column width × up to 78vh). Sizing
  // the frame in JS keeps the OUTPUT aspect exactly (CSS aspect-ratio distorts
  // when a wide output would be clamped by max-width).
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const measure = () => setOuter({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  // Track the main video's play state so scene overlays follow it (resyncing
  // reliably on play/pause, not just when the playhead ticks).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const on = () => setPlaying(true);
    const off = () => setPlaying(false);
    v.addEventListener("play", on);
    v.addEventListener("playing", on);
    v.addEventListener("pause", off);
    v.addEventListener("ended", off);
    return () => {
      v.removeEventListener("play", on);
      v.removeEventListener("playing", on);
      v.removeEventListener("pause", off);
      v.removeEventListener("ended", off);
    };
  }, []);

  // Kick the decoder to paint the first frame on open. With HW-accelerated H.264
  // decode (AMD/ROCm), a freshly-loaded <video> often stays black/frozen until
  // currentTime is touched — the "black screen until I seek a few times" bug. A
  // tiny one-time seek once the frame data is ready forces a decoded frame.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const kick = () => { try { v.currentTime = v.currentTime + 0.001; } catch { /* ignore */ } };
    if (v.readyState >= 2) kick();
    else v.addEventListener("loadeddata", kick, { once: true });
    return () => v.removeEventListener("loadeddata", kick);
  }, []);

  // Keyboard: Space = play/pause (never scroll the page), ←/→ = seek 5s.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      const v = videoRef.current;
      if (!v) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (v.paused) {
          setPreviewEnd(null);
          setPreviewStart(null);
          v.play().catch(() => {});
        } else {
          v.pause();
        }
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        v.currentTime = Math.max(0, v.currentTime - 5);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 5);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Stop preview playback when the clip's end is reached.
  useEffect(() => {
    if (previewEnd != null && t >= previewEnd) {
      videoRef.current?.pause();
      setPreviewEnd(null);
      setPreviewStart(null);
    }
  }, [t, previewEnd]);

  const cues = useMemo(
    () => buildCues(project.segments, style),
    [project.segments, style]
  );
  const cueIdx = activeCueIndex(cues, t);
  // During a clip preview, hide a caption that began before the clip so it never
  // opens on the previous segment's leftover subtitle (matches RenderPage).
  const cue =
    cueIdx >= 0 &&
    (previewStart == null || cues[cueIdx].start >= previewStart - 1e-3)
      ? cues[cueIdx]
      : null;
  const selectedClip = clips.find((c) => c.id === selectedClipId) || null;
  // Scene shown at the playhead. Query the CLEANED cuts (no self/redundant
  // switches, like the export) shifted by (lead + dur): the CSS crossfade below
  // starts when `active` toggles and lasts TRANSITION_DUR, so it *completes*
  // TRANSITION_LEAD before the cut — matching the export (scenes.ts sceneLayersAt).
  const activeScene =
    project.scenes.find(
      (s) => s.id === activeSceneId(cleanCuts(sceneCuts), t + TRANSITION_LEAD + TRANSITION_DUR)
    ) || null;
  const selectedScene = project.scenes.find((s) => s.id === selectedSceneId) || null;

  // A scene's crop, falling back to a centered output-aspect rect when it is
  // still the default full frame (so a different-aspect scene isn't distorted).
  const effCrop = (sc: Scene) =>
    frame.aspect !== "original" && sc.crop.w === 1 && sc.crop.h === 1
      ? defaultFrameRect(frame.aspect, sc.width, sc.height)
      : sc.crop;

  // In the Scènes tab we preview whichever scene is selected (to reframe it);
  // otherwise the scene active at the playhead.
  const previewScene = tab === "scenes" && selectedScene ? selectedScene : activeScene;
  const editingSecondaryCrop =
    tab === "scenes" && !!selectedScene && !selectedScene.is_main && selectedScene.mode === "crop";
  // Editing the MAIN crop (drag the frame over the full source). Both crop-edit
  // cases show the whole source + a ReframeBox; every other view shows only the
  // cropped output (no black bars around it).
  const editingMainCrop =
    tab === "scenes" && selectedSceneId === "main" &&
    frame.mode === "crop" && frame.aspect !== "original";
  const reframing = editingSecondaryCrop || editingMainCrop;
  const cropped = !reframing;

  // What to composite over the base video: overlay scenes always; the main only
  // in "fit" mode. Except while reframing a secondary scene, where we show its
  // full source instead (so the crop rectangle works like the main's).
  const stage = editingSecondaryCrop
    ? null
    : previewScene && !previewScene.is_main
      ? { scene: previewScene, mode: previewScene.mode, crop: effCrop(previewScene) }
      : previewScene && previewScene.is_main && frame.mode === "fit"
        ? { scene: previewScene, mode: "fit" as FitMode, crop: { x: frame.x, y: frame.y, w: frame.w, h: frame.h } }
        : null;

  const secFrame: Frame | null =
    editingSecondaryCrop && selectedScene
      ? { aspect: frame.aspect, mode: "crop", blur_bg: false, ...effCrop(selectedScene) }
      : null;

  const stageSceneId = stage ? stage.scene.id : null;
  const mainScene = project.scenes.find((s) => s.is_main) || null;

  // Output pixel geometry → the cropped preview's aspect ratio, and the scale
  // for captions (authored @1080 output) and overlays (authored @1080 source).
  const outW = frame.w * (project.width || 1920);
  const outH = frame.h * (project.height || 1080);
  // Fit the output aspect inside the available space (no distortion, no bars).
  const croppedSize = (() => {
    const ratio = outW / outH || 16 / 9;
    const availW = outer.w || 640;
    const availH = outer.h || 500;
    let w = availW;
    let h = availW / ratio;
    if (h > availH) { h = availH; w = availH * ratio; }
    return { width: `${Math.round(w)}px`, height: `${Math.round(h)}px` };
  })();
  const captionScale = regionWidth ? regionWidth / REFERENCE_WIDTH : 0.4;
  // Overlays are positioned in SOURCE coordinates (like the export), so in the
  // cropped view they live in a crop-mapped layer sized to the whole source.
  const overlaySourceWidth = cropped
    ? (regionWidth ? regionWidth / frame.w : 0)
    : videoWidth;

  function updateSceneCrop(id: string, crop: Rect) {
    updateScenes(project.scenes.map((s) => (s.id === id ? { ...s, crop } : s)));
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      setPreviewEnd(null); // don't let a stale clip-preview stop re-pause us
      setPreviewStart(null);
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }

  const frameRegionStyle: CSSProperties = cropped
    ? { position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }
    : {
        position: "absolute",
        left: `${frame.x * 100}%`,
        top: `${frame.y * 100}%`,
        width: `${frame.w * 100}%`,
        height: `${frame.h * 100}%`,
        overflow: "hidden",
        pointerEvents: "none",
      };

  function updateStyle(patch: Partial<Style>) {
    const next = { ...style, ...patch };
    setStyle(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      api.patchProject(project.id, { style: next }).catch(() => {});
    }, 400);
  }

  function updateOverlays(next: Overlay[]) {
    setOverlays(next);
    window.clearTimeout(overlayTimer.current);
    overlayTimer.current = window.setTimeout(() => {
      api.patchProject(project.id, { overlays: next }).catch(() => {});
    }, 400);
  }

  function patchOverlay(id: string, patch: Partial<Overlay>) {
    updateOverlays(overlays.map((o) => (o.id === id ? ({ ...o, ...patch } as Overlay) : o)));
  }

  function updateClips(next: Clip[]) {
    setClips(next);
    window.clearTimeout(clipTimer.current);
    clipTimer.current = window.setTimeout(() => {
      api.patchProject(project.id, { clips: next }).catch(() => {});
    }, 400);
  }

  function updateFrame(patch: Partial<Frame>) {
    const next = { ...frame, ...patch };
    setFrame(next);
    window.clearTimeout(frameTimer.current);
    frameTimer.current = window.setTimeout(() => {
      api.patchProject(project.id, { frame: next }).catch(() => {});
    }, 400);
  }

  function updateContext(next: string) {
    setWhisperPrompt(next);
    window.clearTimeout(promptTimer.current);
    promptTimer.current = window.setTimeout(() => {
      api.patchProject(project.id, { whisper_prompt: next }).catch(() => {});
    }, 400);
  }

  function updateScenes(next: Scene[]) {
    setProject((p) => ({ ...p, scenes: next }));
    window.clearTimeout(sceneTimer.current);
    sceneTimer.current = window.setTimeout(() => {
      api.patchProject(project.id, { scenes: next }).catch(() => {});
    }, 400);
  }

  function createClip(start: number, end: number) {
    const clip: Clip = {
      id: "clip" + Math.floor(performance.now() * 1000).toString(36),
      name: `Clip ${clips.length + 1}`,
      start,
      end,
    };
    updateClips([...clips, clip]);
    setSelectedClipId(clip.id);
    setTab("clips");
  }

  function updateSceneCuts(next: SceneCut[]) {
    setSceneCuts(next);
    window.clearTimeout(cutsTimer.current);
    cutsTimer.current = window.setTimeout(() => {
      api.patchProject(project.id, { scene_cuts: next }).catch(() => {});
    }, 400);
  }

  function addSceneCut(seg: Segment, sceneId: string) {
    const time = seg.words.length ? seg.words[0].start : seg.start;
    // replace any near-coincident cut so a word maps to one scene
    const kept = sceneCuts.filter((c) => Math.abs(c.time - time) > 0.05);
    const cut: SceneCut = { id: "cut" + Math.floor(performance.now() * 1000).toString(36), time, scene_id: sceneId };
    updateSceneCuts([...kept, cut]);
  }

  function startClip(seg: Segment) {
    setPendingClipStartId(seg.id);
  }

  function endClip(seg: Segment) {
    const startSeg = project.segments.find((s) => s.id === pendingClipStartId);
    setPendingClipStartId(null);
    if (!startSeg) return;
    // Bound the clip to the first/last word timestamps (frame-accurate), not the
    // looser segment start/end, and handle segments picked in either order.
    const wStart = (s: Segment) => (s.words.length ? s.words[0].start : s.start);
    const wEnd = (s: Segment) => (s.words.length ? s.words[s.words.length - 1].end : s.end);
    createClip(Math.min(wStart(startSeg), wStart(seg)), Math.max(wEnd(startSeg), wEnd(seg)));
  }

  function previewClip(clip: Clip) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = clip.start + 0.001;
    setPreviewEnd(clip.end);
    setPreviewStart(clip.start);
    v.play().catch(() => {});
  }

  async function reload() {
    const p = await api.getProject(project.id);
    setProject(p);
  }

  // Full reload: also reset the locally-edited slices from the server. Used when
  // accepting an external change (agent edits); discards any unsaved local edit.
  async function reloadAll() {
    const p = await api.getProject(project.id);
    setProject(p);
    setStyle(p.style);
    setOverlays(p.overlays);
    setClips(p.clips);
    setFrame(p.frame);
    setSceneCuts(p.scene_cuts);
    setExternalChange(false);
  }

  // Everything editable is auto-saved (debounced). `flush` forces every pending
  // edit to disk immediately — the export reads the saved project.json, so it
  // must all be persisted before a render starts.
  const saved = { style, frame, overlays, clips, scenes: project.scenes,
                  scene_cuts: sceneCuts, whisper_prompt: whisperPrompt };
  const savedRef = useRef(saved);
  savedRef.current = saved;

  async function flush() {
    window.clearTimeout(saveTimer.current);
    window.clearTimeout(overlayTimer.current);
    window.clearTimeout(clipTimer.current);
    window.clearTimeout(frameTimer.current);
    window.clearTimeout(cutsTimer.current);
    window.clearTimeout(sceneTimer.current);
    window.clearTimeout(promptTimer.current);
    await api.patchProject(project.id, savedRef.current);
  }

  const [reprocessing, setReprocessing] = useState(false);
  // Re-run whisper on the source video. Replaces every segment + word timing,
  // so we flush the current style/frame/overlays/clips first (they're preserved)
  // then hand back to the processing view until it's ready again.
  async function reprocess() {
    if (
      !window.confirm(
        "Recalculer la transcription ? Les sous-titres actuels (corrections et " +
          "traductions comprises) seront remplacés. Le style, le cadrage, les " +
          "clips et les incrustations sont conservés."
      )
    )
      return;
    setReprocessing(true);
    try {
      await flush();
      await api.retranscribe(project.id);
      onReprocess(project.id);
    } catch {
      setReprocessing(false);
      window.alert("Impossible de relancer la transcription.");
    }
  }

  // Safety net: persist the latest edits when leaving the editor (navigating
  // home) or hiding the tab, so nothing debounced is ever lost.
  useEffect(() => {
    const onHide = () => {
      fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(savedRef.current),
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      onHide(); // also on unmount (e.g. back to the project list)
    };
  }, [project.id]);

  function seek(to: number) {
    const v = videoRef.current;
    if (v) v.currentTime = to + 0.001;
  }

  // French typographic spacing on the original line (French video) and the
  // translation (translated into French) is handled inside CaptionBlock.
  const frMain = (project.language || "").toLowerCase().startsWith("fr");
  const frTrans = (project.translate_to || "").toLowerCase().startsWith("fr");

  const videoStyle: CSSProperties = editingSecondaryCrop
    ? { position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, pointerEvents: "none" }
    : cropped
      ? { ...cropMap(frame), objectFit: "fill", maxWidth: "none", maxHeight: "none", opacity: stage ? 0 : 1, pointerEvents: "none" }
      : { opacity: stage ? 0 : 1, pointerEvents: stage ? "none" : "auto" };

  // Poll for changes made outside this editor (the MCP agent writes via the same
  // API). We compare the server's content to our live edits; a difference that is
  // STABLE across two polls (so it isn't just our own debounced save landing)
  // means the project was changed elsewhere → surface a reload banner.
  useEffect(() => {
    const sig = (p: Project, ov: Overlay[], cl: Clip[], sc: SceneCut[], st: Style, fr: Frame) =>
      JSON.stringify({
        name: p.name, style: st, frame: fr, overlays: ov, clips: cl, scene_cuts: sc,
        scenes: p.scenes,
        segments: p.segments.map((s) => [s.id, s.start, s.end, s.text, s.translation]),
      });
    const local = sig(project, overlays, clips, sceneCuts, style, frame);
    let prevServer = "";
    const id = window.setInterval(async () => {
      let fresh: Project;
      try {
        fresh = await api.getProject(project.id);
      } catch {
        return;
      }
      const server = sig(fresh, fresh.overlays, fresh.clips, fresh.scene_cuts, fresh.style, fresh.frame);
      if (server === local) setExternalChange(false);
      else if (server === prevServer) setExternalChange(true);
      prevServer = server;
    }, 5000);
    return () => window.clearInterval(id);
  }, [project, overlays, clips, sceneCuts, style, frame]);

  return (
    <div className="editor">
      {externalChange && (
        <div className="ext-change-banner">
          <span>✏️ Ce projet a été modifié en dehors de l'éditeur (agent).</span>
          <div className="ext-change-actions">
            <button className="btn sm" onClick={reloadAll}>Recharger</button>
            <button className="link" onClick={() => setExternalChange(false)}>Ignorer</button>
          </div>
        </div>
      )}
      {/* LEFT — the transcript, in its own scroll view (search + auto-follow). */}
      <aside className="transcript-pane">
        <TranscriptPanel
          projectId={project.id}
          segments={project.segments}
          t={t}
          onSeek={seek}
          reload={reload}
          pendingClipStartId={pendingClipStartId}
          onStartClip={startClip}
          onEndClip={endClip}
          scenes={project.scenes}
          cuts={sceneCuts}
          onSceneCut={addSceneCut}
          withSearch
          follow={playing}
        />
      </aside>

      {/* CENTER — the video preview + timeline. */}
      <section className="stage">
        <div
          ref={outerRef}
          className="video-outer"
          onClick={(e) => {
            if (!cropped) return; // reframe mode keeps native controls
            if ((e.target as HTMLElement).closest(".ov, .ov-handle")) return;
            togglePlay();
          }}
        >
          <div className={`video-frame ${cropped ? "cropped" : ""}`} style={cropped ? croppedSize : undefined}>
            {/* The base <video> is the audio + playhead master. In the cropped
                view it's positioned to map the crop window (no native controls,
                which would fall outside the crop); in reframe mode it shows the
                whole source with controls. preload=auto so it paints on open. */}
            <video
              ref={videoRef}
              src={api.videoUrl(project.id)}
              preload="auto"
              controls={reframing}
              style={videoStyle}
            />
            {editingSecondaryCrop && selectedScene && (
              <SceneSourceVideo
                key={selectedScene.id}
                projectId={project.id}
                sceneId={selectedScene.id}
                t={t}
                playing={playing}
              />
            )}
            {cropped ? (
              <div className="overlay-cropwrap" style={{ ...cropMap(frame), pointerEvents: "none" }}>
                <OverlayLayer
                  overlays={overlays}
                  t={t}
                  videoWidth={overlaySourceWidth}
                  selectedId={selectedOverlayId}
                  onSelect={setSelectedOverlayId}
                  onMove={(id, x, y) => patchOverlay(id, { x, y })}
                  onResize={(id, patch) => patchOverlay(id, patch)}
                  onEditText={(id, text) => patchOverlay(id, { text })}
                />
              </div>
            ) : (
              <OverlayLayer
                overlays={overlays}
                t={t}
                videoWidth={overlaySourceWidth}
                selectedId={selectedOverlayId}
                onSelect={setSelectedOverlayId}
                onMove={(id, x, y) => patchOverlay(id, { x, y })}
                onResize={(id, patch) => patchOverlay(id, patch)}
                onEditText={(id, text) => patchOverlay(id, { text })}
              />
            )}
            {reframing && (
              editingSecondaryCrop && secFrame && selectedScene ? (
                <ReframeBox
                  frame={secFrame}
                  sourceW={selectedScene.width}
                  sourceH={selectedScene.height}
                  editable
                  onChange={(patch) => {
                    const c = effCrop(selectedScene);
                    updateSceneCrop(selectedScene.id, {
                      x: patch.x ?? c.x,
                      y: patch.y ?? c.y,
                      w: patch.w ?? c.w,
                      h: patch.h ?? c.h,
                    });
                  }}
                />
              ) : (
                <ReframeBox
                  frame={frame}
                  sourceW={project.width}
                  sourceH={project.height}
                  editable
                  onChange={updateFrame}
                />
              )
            )}
            <div ref={regionRef} className="frame-region" style={frameRegionStyle}>
              {/* Every secondary scene stays mounted; only the active one shows and
                  plays. Crossfade handles the transition — no remount, no reload. */}
              {project.scenes.filter((s) => !s.is_main).map((sc) => (
                <SceneStage
                  key={sc.id}
                  projectId={project.id}
                  scene={sc}
                  mode={sc.mode}
                  crop={effCrop(sc)}
                  t={t}
                  playing={playing}
                  active={stageSceneId === sc.id}
                />
              ))}
              {frame.mode === "fit" && mainScene && (
                <SceneStage
                  key="__mainfit"
                  projectId={project.id}
                  scene={mainScene}
                  mode="fit"
                  crop={{ x: frame.x, y: frame.y, w: frame.w, h: frame.h }}
                  t={t}
                  playing={playing}
                  active={stageSceneId === "main"}
                />
              )}
              {cue && !editingSecondaryCrop && (
                <CaptionBlock style={style} cue={cue} t={t} scale={captionScale} frMain={frMain} frTrans={frTrans} />
              )}
            </div>
          </div>
        </div>
        <div className="stage-controls">
          <button className="btn sm" onClick={togglePlay}>{playing ? "⏸ Pause" : "▶ Lecture"}</button>
          <span className="muted small">{formatTime(t)} / {formatTime(project.duration)}</span>
        </div>
        <Timeline
          duration={project.duration}
          t={t}
          clips={clips}
          scenes={project.scenes}
          cuts={sceneCuts}
          selectedClipId={selectedClipId}
          onSeek={seek}
          onCreateClip={createClip}
          onSelectClip={(id) => {
            setSelectedClipId(id);
            setTab("clips");
          }}
        />
        <p className="muted small">
          {project.language ? `Langue : ${project.language}. ` : ""}
          {project.segments.length} segments · {project.width}×{project.height}
        </p>
      </section>

      {/* RIGHT — a nav that shows/hides tool panels. */}
      <aside className="side">
        <nav className="side-nav">
          <button className={tab === "subtitles" ? "nav-btn on" : "nav-btn"} onClick={() => openTab("subtitles")}>
            <span className="nav-ico">Aa</span>Sous-titres
          </button>
          <button className={tab === "overlays" ? "nav-btn on" : "nav-btn"} onClick={() => openTab("overlays")}>
            <span className="nav-ico">✦</span>Incrustations
          </button>
          <button className={tab === "clips" ? "nav-btn on" : "nav-btn"} onClick={() => openTab("clips")}>
            <span className="nav-ico">✂</span>Clips
          </button>
          <button className={tab === "scenes" ? "nav-btn on" : "nav-btn"} onClick={() => openTab("scenes")}>
            <span className="nav-ico">🎥</span>Scènes
          </button>
        </nav>

        {tab === "subtitles" && (
          <>
            <div className="toolbar">
              <span className="tool-label">Transcription</span>
              <button className="btn" onClick={reprocess} disabled={reprocessing}>
                {reprocessing ? "Relance…" : "↻ Recalculer"}
              </button>
            </div>
            <ContextPanel prompt={whisperPrompt} onChange={updateContext} />
            <TranslateBar project={project} onUpdate={setProject} />
            <StylePanel style={style} onChange={updateStyle} />
          </>
        )}
        {tab === "overlays" && (
          <OverlayPanel
            projectId={project.id}
            overlays={overlays}
            t={t}
            duration={project.duration}
            selectedClip={selectedClip}
            selectedId={selectedOverlayId}
            onSelect={setSelectedOverlayId}
            onChange={updateOverlays}
          />
        )}
        {tab === "clips" && (
          <>
            <ClipPanel
              projectId={project.id}
              clips={clips}
              selectedId={selectedClipId}
              onSelect={setSelectedClipId}
              onChange={updateClips}
              onPreview={previewClip}
              flush={flush}
            />
            {selectedClip && (
              <TranscriptPanel
                projectId={project.id}
                segments={project.segments.filter((s) => s.end > selectedClip.start && s.start < selectedClip.end)}
                t={t}
                onSeek={seek}
                reload={reload}
                pendingClipStartId={pendingClipStartId}
                onStartClip={startClip}
                onEndClip={endClip}
                scenes={project.scenes}
                cuts={sceneCuts}
                onSceneCut={addSceneCut}
              />
            )}
          </>
        )}
        {tab === "scenes" && (
          <ScenePanel
            projectId={project.id}
            scenes={project.scenes}
            cuts={sceneCuts}
            frame={frame}
            sourceW={project.width}
            sourceH={project.height}
            selectedSceneId={selectedSceneId}
            onSelectScene={setSelectedSceneId}
            onReload={reload}
            onScenesChange={updateScenes}
            onFrameChange={updateFrame}
            onCutsChange={updateSceneCuts}
            onSeek={seek}
          />
        )}
      </aside>
    </div>
  );
}
