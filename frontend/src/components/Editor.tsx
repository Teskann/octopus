import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api } from "../api";
import { usePlayhead } from "../usePlayhead";
import { buildCues, activeCueIndex, isWordActive } from "../captions";
import { frenchSpacing } from "../text";
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
import { activeSceneId } from "../scenes";
import { defaultFrameRect } from "../frame";
import type { Clip, FitMode, Frame, Overlay, Project, Scene, SceneCut, Segment, Style } from "../types";

const REFERENCE_WIDTH = 1080; // style authored against this (matches backend)

function hexToRgba(hex: string, opacity: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export function Editor({ initial }: { initial: Project }) {
  const [project, setProject] = useState<Project>(initial);
  const [style, setStyle] = useState<Style>(initial.style);
  const [overlays, setOverlays] = useState<Overlay[]>(initial.overlays);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [clips, setClips] = useState<Clip[]>(initial.clips);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [pendingClipStartId, setPendingClipStartId] = useState<string | null>(null);
  const [previewEnd, setPreviewEnd] = useState<number | null>(null);
  const [frame, setFrame] = useState<Frame>(initial.frame);
  const [sceneCuts, setSceneCuts] = useState<SceneCut[]>(initial.scene_cuts);
  const [selectedSceneId, setSelectedSceneId] = useState<string>("main");
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState<"transcript" | "overlays" | "clips" | "scenes">("transcript");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoWidth, setVideoWidth] = useState(0);
  const t = usePlayhead(videoRef);
  const saveTimer = useRef<number>();
  const overlayTimer = useRef<number>();
  const clipTimer = useRef<number>();
  const frameTimer = useRef<number>();
  const cutsTimer = useRef<number>();
  const sceneTimer = useRef<number>();

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const measure = () => setVideoWidth(v.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(v);
    return () => ro.disconnect();
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

  // Stop preview playback when the clip's end is reached.
  useEffect(() => {
    if (previewEnd != null && t >= previewEnd) {
      videoRef.current?.pause();
      setPreviewEnd(null);
    }
  }, [t, previewEnd]);

  const cues = useMemo(
    () => buildCues(project.segments, style),
    [project.segments, style]
  );
  const cueIdx = activeCueIndex(cues, t);
  const cue = cueIdx >= 0 ? cues[cueIdx] : null;
  const translation = cue ? cue.translation : "";

  // Captions size/position against the visible frame (not the whole source),
  // so the preview matches how they'll sit in the exported clip.
  const frameScale = videoWidth ? (frame.w * videoWidth) / REFERENCE_WIDTH : 0.4;
  const selectedClip = clips.find((c) => c.id === selectedClipId) || null;
  const activeScene = project.scenes.find((s) => s.id === activeSceneId(sceneCuts, t)) || null;
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

  function updateSceneCrop(id: string, crop: { x: number; y: number; w: number; h: number }) {
    updateScenes(project.scenes.map((s) => (s.id === id ? { ...s, crop } : s)));
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  const frameRegionStyle: CSSProperties = {
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
    v.play().catch(() => {});
  }

  async function reload() {
    const p = await api.getProject(project.id);
    setProject(p);
  }

  function seek(to: number) {
    const v = videoRef.current;
    if (v) v.currentTime = to + 0.001;
  }

  const cap = (s: string) => (style.uppercase ? s.toUpperCase() : s);
  // French typographic spacing on the original line (French video) and the
  // translation (translated into French), mirroring the export.
  const frMain = (project.language || "").toLowerCase().startsWith("fr");
  const frTrans = (project.translate_to || "").toLowerCase().startsWith("fr");
  const fmtMain = (s: string) => cap(frMain ? frenchSpacing(s) : s);
  const fmtTrans = (s: string) => cap(frTrans ? frenchSpacing(s) : s);
  const boxBg = style.box_enabled
    ? hexToRgba(style.box_color, style.box_opacity)
    : "transparent";

  // One box wraps the whole caption block (all lines together), not per line.
  const boxStyle: CSSProperties = style.box_enabled
    ? {
        background: boxBg,
        padding: `${style.box_padding_y * frameScale}px ${style.box_padding_x * frameScale}px`,
        borderRadius: `${style.box_radius * frameScale}px`,
      }
    : {};

  const textStyle = (fontPx: number, color: string, strokePx: number): CSSProperties => ({
    fontFamily: `"${style.font}"`,
    fontSize: `${fontPx}px`,
    color,
    // A box replaces the per-glyph outline (matches the ASS export).
    WebkitTextStroke: style.box_enabled ? undefined : `${strokePx}px ${style.outline_color}`,
    paintOrder: "stroke fill",
  });

  const translationRow = style.translation_enabled && translation ? (
    <div className="cap-row" key="trans">
      <span
        className="cap-box"
        style={textStyle(
          style.font_size * frameScale * style.translation_scale,
          style.translation_color,
          style.outline_width * frameScale * 0.6
        )}
      >
        {fmtTrans(translation)}
      </span>
    </div>
  ) : null;

  return (
    <div className="editor">
      <section className="stage">
        <TranslateBar project={project} onUpdate={setProject} />
        <div className="video-outer">
          <div className="video-frame">
          {/* Hidden (but still playing for audio) when a scene is composited or
              while reframing a secondary, so the raw main never shows around the
              output window. When reframing a secondary it's taken out of flow so
              that scene's own video sizes the frame. */}
          <video
            ref={videoRef}
            src={api.videoUrl(project.id)}
            controls
            style={
              editingSecondaryCrop
                ? { position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, pointerEvents: "none" }
                : { opacity: stage ? 0 : 1, pointerEvents: stage ? "none" : "auto" }
            }
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
          <OverlayLayer
            overlays={overlays}
            t={t}
            videoWidth={videoWidth}
            selectedId={selectedOverlayId}
            onSelect={setSelectedOverlayId}
            onMove={(id, x, y) => patchOverlay(id, { x, y })}
            onResize={(id, patch) => patchOverlay(id, patch)}
            onEditText={(id, text) => patchOverlay(id, { text })}
          />
          {editingSecondaryCrop && secFrame && selectedScene ? (
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
          ) : !stage ? (
            <ReframeBox
              frame={frame}
              sourceW={project.width}
              sourceH={project.height}
              editable={tab === "scenes" && frame.mode === "crop" && selectedSceneId === "main"}
              onChange={updateFrame}
            />
          ) : null}
          <div className="frame-region" style={frameRegionStyle}>
          {stage && (
            <SceneStage
              key={stage.scene.id + stage.mode}
              projectId={project.id}
              scene={stage.scene}
              mode={stage.mode}
              crop={stage.crop}
              t={t}
              playing={playing}
            />
          )}
          {cue && !editingSecondaryCrop && (
            <div className={`caption pos-${style.position}`} style={captionPos(style, frameScale)}>
              <div className="caption-box" style={boxStyle}>
              {style.translation_position === "above" && translationRow}
              {cue.lines.length > 0
                ? cue.lines.map((line, li) => (
                    <div className="cap-row" key={li}>
                      <span
                        className="cap-box"
                        style={textStyle(style.font_size * frameScale, style.primary_color, style.outline_width * frameScale)}
                      >
                        {line.map((w, wi) => (
                          <span
                            key={wi}
                            style={
                              style.highlight_enabled && isWordActive(w, t)
                                ? { color: style.highlight_color }
                                : undefined
                            }
                          >
                            {fmtMain(w.text)}{" "}
                          </span>
                        ))}
                      </span>
                    </div>
                  ))
                : (
                  <div className="cap-row">
                    <span
                      className="cap-box"
                      style={textStyle(style.font_size * frameScale, style.primary_color, style.outline_width * frameScale)}
                    >
                      {fmtMain(cue.text)}
                    </span>
                  </div>
                )}
              {style.translation_position === "below" && translationRow}
              </div>
            </div>
          )}
          </div>
          </div>
        </div>
        <div className="stage-controls">
          <button className="btn sm" onClick={togglePlay}>{playing ? "⏸ Pause" : "▶ Lecture"}</button>
          <span className="muted small">{fmtTime(t)} / {fmtTime(project.duration)}</span>
        </div>
        <Timeline
          duration={project.duration}
          t={t}
          clips={clips}
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

      <aside className="side">
        <StylePanel style={style} onChange={updateStyle} />
        <div className="tabs">
          <button className={tab === "transcript" ? "tab on" : "tab"} onClick={() => setTab("transcript")}>
            Transcription
          </button>
          <button className={tab === "overlays" ? "tab on" : "tab"} onClick={() => setTab("overlays")}>
            Incrustations
          </button>
          <button className={tab === "clips" ? "tab on" : "tab"} onClick={() => setTab("clips")}>
            Clips
          </button>
          <button className={tab === "scenes" ? "tab on" : "tab"} onClick={() => setTab("scenes")}>
            Scènes
          </button>
        </div>

        {tab === "transcript" && (
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
            onSceneCut={addSceneCut}
          />
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
              clips={clips}
              selectedId={selectedClipId}
              onSelect={setSelectedClipId}
              onChange={updateClips}
              onPreview={previewClip}
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

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function captionPos(style: Style, scale: number): CSSProperties {
  const m = style.margin_v * scale;
  if (style.position === "top") return { top: m };
  if (style.position === "middle") return { top: "50%", transform: "translateY(-50%)" };
  return { bottom: m };
}
