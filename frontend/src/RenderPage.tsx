import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { api } from "./api";
import { buildCues, activeCueIndex } from "./captions";
import { CaptionBlock } from "./components/CaptionBlock";
import { defaultFrameRect, outputSize } from "./frame";
import { sceneLayersAt } from "./scenes";
import type { FitMode, Overlay, Project, Scene, TextOverlay } from "./types";

const REFERENCE_WIDTH = 1080;

// The headless renderer (app/render.py) drives this object: it waits for
// `ready`, reads `meta`, then calls `seek(t)` per frame before screenshotting.
declare global {
  interface Window {
    __render: {
      ready: boolean;
      error: string | null;
      meta: { w: number; h: number; fps: number; start: number; end: number; frameCount: number } | null;
      seek: (t: number) => Promise<void>;
    };
  }
}

if (typeof window !== "undefined" && !window.__render) {
  window.__render = { ready: false, error: null, meta: null, seek: async () => {} };
}

const raf2 = (cb: () => void) => requestAnimationFrame(() => requestAnimationFrame(cb));

/** Entry for the export route (?render=1&project=…&clip=…). Loads the project,
 *  finds the clip, and mounts the deterministic composition. */
export function RenderPage() {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get("project") || "";
  const clipId = params.get("clip") || "";
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getProject(projectId)
      .then(setProject)
      .catch((e) => {
        const msg = `Projet introuvable: ${String(e)}`;
        setError(msg);
        window.__render.error = msg;
      });
  }, [projectId]);

  if (error) return <div style={{ color: "#fff" }}>{error}</div>;
  if (!project) return null;
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) {
    window.__render.error = "Clip introuvable";
    return <div style={{ color: "#fff" }}>Clip introuvable</div>;
  }
  return <RenderStage project={project} clip={clip} />;
}

function RenderStage({ project, clip }: { project: Project; clip: { start: number; end: number } }) {
  const { style, frame } = project;
  const { w: outW, h: outH } = useMemo(() => outputSize(project), [project]);
  const mw = project.width || 1920;
  const mh = project.height || 1080;
  const fps = project.fps || 30;
  const frameCount = Math.max(1, Math.round((clip.end - clip.start) * fps));

  const cues = useMemo(() => buildCues(project.segments, style), [project.segments, style]);
  const [t, setT] = useState(clip.start);
  // Videos grouped by scene id, so each frame we only seek the ACTIVE scene's
  // video(s) — seeking every mounted scene per frame is wasted decode work.
  const videos = useRef<Map<string, Set<HTMLVideoElement>>>(new Map());
  const registerVideo = (sceneId: string) => (el: HTMLVideoElement | null) => {
    if (!el) return;
    let set = videos.current.get(sceneId);
    if (!set) {
      set = new Set<HTMLVideoElement>();
      videos.current.set(sceneId, set);
    }
    set.add(el);
  };
  const allVideos = () => [...videos.current.values()].flatMap((s) => [...s]);

  const frMain = (project.language || "").toLowerCase().startsWith("fr");
  const frTrans = (project.translate_to || "").toLowerCase().startsWith("fr");

  // A scene's crop, falling back to a centered output-aspect rect when it is
  // still the default full frame (mirrors Editor.effCrop).
  const effCrop = (sc: Scene) =>
    frame.aspect !== "original" && sc.crop.w === 1 && sc.crop.h === 1
      ? defaultFrameRect(frame.aspect, sc.width, sc.height)
      : sc.crop;

  // Geometry per scene. The main scene uses the project frame window/mode; a
  // secondary uses its own crop/mode. All stay mounted; visibility is per-frame.
  const layers = project.scenes.map((sc) =>
    sc.is_main
      ? { scene: sc, mode: frame.mode, crop: { x: frame.x, y: frame.y, w: frame.w, h: frame.h }, blur: frame.blur_bg }
      : { scene: sc, mode: sc.mode, crop: effCrop(sc), blur: true }
  );
  // Visible scene layers at this frame (opacity/scale during a crossfade),
  // keyed by scene id with a stacking index (bottom→top).
  const visLayers = sceneLayersAt(project.scene_cuts, t);
  const visById = new Map(
    visLayers.map((l, i) => [l.sceneId, { opacity: l.opacity, scale: l.scale, z: i + 1 }])
  );

  const cueIdx = activeCueIndex(cues, t);
  const cue = cueIdx >= 0 ? cues[cueIdx] : null;

  // Seek EVERY mounted video to `time` and resolve once they've all reported
  // `seeked` and the page has painted (two rAFs). Seeking all (not just the
  // visible scene) fixes some subliminal frames — a scene otherwise showed its
  // frame 0 for one capture when it appeared before its own seek applied. Videos
  // already at `time` are skipped so we never wait on a `seeked` that won't fire.
  function seek(time: number): Promise<void> {
    return new Promise((resolve) => {
      setT(time);
      const vids = allVideos().filter(
        (v) => v.readyState >= 1 && Math.abs(v.currentTime - time) > 0.001
      );
      if (vids.length === 0) {
        raf2(resolve);
        return;
      }
      let pending = vids.length;
      const done = () => {
        if (--pending === 0) raf2(resolve);
      };
      for (const v of vids) {
        const on = () => {
          v.removeEventListener("seeked", on);
          done();
        };
        v.addEventListener("seeked", on);
        try {
          v.currentTime = time;
        } catch {
          v.removeEventListener("seeked", on);
          done();
        }
      }
    });
  }

  // Publish the render contract and mark ready once fonts + videos are loaded.
  useEffect(() => {
    window.__render.meta = { w: outW, h: outH, fps, start: clip.start, end: clip.end, frameCount };
    window.__render.seek = seek;
    let cancelled = false;
    const vids = allVideos();
    const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
    const videosReady = vids.map((v) =>
      v.readyState >= 2
        ? Promise.resolve()
        : new Promise<void>((res) => {
            const on = () => {
              v.removeEventListener("loadeddata", on);
              res();
            };
            v.addEventListener("loadeddata", on);
          })
    );
    Promise.all([fontsReady, ...videosReady])
      .then(async () => {
        if (cancelled) return;
        await seek(clip.start);
        window.__render.ready = true;
      })
      .catch((e) => {
        window.__render.error = String(e);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const captionScale = outW / REFERENCE_WIDTH;
  const overlayScale = mw / REFERENCE_WIDTH;

  const stageStyle: CSSProperties = {
    position: "fixed",
    left: 0,
    top: 0,
    width: `${outW}px`,
    height: `${outH}px`,
    background: "#000",
    overflow: "hidden",
  };
  // The overlay layer spans the full source (like the preview), offset so the
  // crop window aligns with the output canvas — overlays keep their positions.
  const overlayLayerStyle: CSSProperties = {
    position: "absolute",
    width: `${mw}px`,
    height: `${mh}px`,
    left: `${-frame.x * mw}px`,
    top: `${-frame.y * mh}px`,
    zIndex: 1,
  };

  return (
    <div id="stage" style={stageStyle}>
      <div style={{ position: "absolute", inset: 0, isolation: "isolate" }}>
        {layers.map((l) => {
          const v = visById.get(l.scene.id);
          return (
            <RenderScene
              key={l.scene.id}
              src={api.sceneVideoUrl(project.id, l.scene.id)}
              mode={l.mode}
              crop={l.crop}
              blur={l.blur}
              opacity={v ? v.opacity : 0}
              scale={v ? v.scale : 1}
              zIndex={v ? v.z : 0}
              outW={outW}
              registerVideo={registerVideo(l.scene.id)}
            />
          );
        })}
      </div>
      <div className="overlay-layer" style={overlayLayerStyle}>
        {project.overlays
          .filter((ov) => t >= ov.start && t < ov.end)
          .map((ov) => (
            <RenderOverlay key={ov.id} ov={ov} scale={overlayScale} videoWidth={mw} />
          ))}
      </div>
      {cue && <CaptionBlock style={style} cue={cue} t={t} scale={captionScale} frMain={frMain} frTrans={frTrans} />}
    </div>
  );
}

/** Deterministic scene player — same DOM/CSS as SceneStage (crop / fit + blur),
 *  but seeked on demand rather than following a live playhead. */
function RenderScene({
  src,
  mode,
  crop,
  blur,
  opacity,
  scale,
  zIndex,
  outW,
  registerVideo,
}: {
  src: string;
  mode: FitMode;
  crop: { x: number; y: number; w: number; h: number };
  blur: boolean;
  opacity: number;
  scale: number;
  zIndex: number;
  outW: number;
  registerVideo: (el: HTMLVideoElement | null) => void;
}) {
  const overlayStyle: CSSProperties = {
    transition: "none", // deterministic capture — opacity/scale come from the playhead
    opacity,
    transform: `scale(${scale})`,
    zIndex,
  };
  const cropStyle: CSSProperties = {
    position: "absolute",
    width: `${100 / crop.w}%`,
    height: `${100 / crop.h}%`,
    left: `${(-crop.x * 100) / crop.w}%`,
    top: `${(-crop.y * 100) / crop.h}%`,
    right: "auto",
    bottom: "auto",
    objectFit: "fill",
  };
  // Blur scaled to the output width so it looks like the preview at any
  // resolution (CSS blur px is otherwise tied to the on-screen preview size).
  const bgStyle: CSSProperties = {
    objectFit: "cover",
    filter: `blur(${Math.round(outW * 0.024)}px) brightness(0.7)`,
    transform: "scale(1.12)",
  };

  return (
    <div className="scene-overlay" style={overlayStyle}>
      {mode === "fit" ? (
        <>
          {blur && <video ref={registerVideo} className="scene-bg" style={bgStyle} src={src} muted playsInline preload="auto" />}
          <video ref={registerVideo} className="scene-fg" src={src} muted playsInline preload="auto" />
        </>
      ) : (
        <video ref={registerVideo} className="scene-crop" style={cropStyle} src={src} muted playsInline preload="auto" />
      )}
    </div>
  );
}

/** Static overlay render — mirrors OverlayLayer's visual styling (no editing). */
function RenderOverlay({ ov, scale, videoWidth }: { ov: Overlay; scale: number; videoWidth: number }) {
  const pos: CSSProperties = { position: "absolute", left: `${ov.x * 100}%`, top: `${ov.y * 100}%` };
  if (ov.type === "image") {
    return (
      <div className="ov" style={pos}>
        <img src={ov.url} style={{ width: `${ov.scale * videoWidth}px`, display: "block" }} draggable={false} />
      </div>
    );
  }
  return (
    <div className="ov" style={pos}>
      <span style={textStyle(ov, scale, videoWidth)}>{ov.text}</span>
    </div>
  );
}

function maxTextWidth(ov: TextOverlay, videoWidth: number): number {
  return Math.max(0.2, Math.min(0.9, 1 - ov.x)) * videoWidth;
}

function hexToRgba(hex: string, opacity: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${opacity})`;
}

function textStyle(ov: TextOverlay, scale: number, videoWidth: number): CSSProperties {
  return {
    fontFamily: `"${ov.font}"`,
    fontSize: `${ov.font_size * scale}px`,
    color: ov.color,
    display: "inline-block",
    maxWidth: `${maxTextWidth(ov, videoWidth)}px`,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    textAlign: "center",
    lineHeight: 1.15,
    ...(ov.shadow !== false ? { textShadow: "0 2px 6px rgba(0,0,0,0.6)" } : {}),
    ...(ov.box_enabled
      ? {
          background: hexToRgba(ov.box_color, ov.box_opacity),
          padding: `${ov.box_padding * scale}px ${ov.box_padding * 1.6 * scale}px`,
          borderRadius: `${ov.box_radius * scale}px`,
        }
      : {}),
  };
}
