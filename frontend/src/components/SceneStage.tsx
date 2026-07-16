import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { api } from "../api";
import type { FitMode, Scene } from "../types";

/** Renders a scene into the output window.
 *  - "crop": the scene's crop window fills the frame (cover, pan/zoom via crop).
 *  - "fit": the whole scene is contained with a blurred cover copy behind, so a
 *    different-aspect scene shows the blur (never what's underneath) around it.
 *  Muted, synced to the main video's time + play state, and remounted per
 *  scene/mode so the zoom-punch animation replays on each switch. */
export function SceneStage({
  projectId,
  scene,
  mode,
  crop,
  t,
  playing,
}: {
  projectId: string;
  scene: Scene;
  mode: FitMode;
  crop: { x: number; y: number; w: number; h: number };
  t: number;
  playing: boolean;
}) {
  const bgRef = useRef<HTMLVideoElement>(null);
  const fgRef = useRef<HTMLVideoElement>(null);
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const vids = [bgRef.current, fgRef.current].filter(Boolean) as HTMLVideoElement[];
    for (const v of vids) {
      const drift = Math.abs(v.currentTime - t);
      if (playing) {
        // Let it play; only correct a large drift (seeking mid-play flickers).
        if (drift > 0.5) { try { v.currentTime = t; } catch { /* ignore */ } }
        if (v.paused) v.play().catch(() => {});
      } else {
        if (drift > 0.05) { try { v.currentTime = t; } catch { /* ignore */ } }
        v.pause();
      }
    }
  }, [t, playing]);

  // Snap to the current time whenever a source (re)loads, so it never sticks on
  // frame 0 (the bug where the overlay showed black after a switch while paused).
  useEffect(() => {
    const vids = [bgRef.current, fgRef.current].filter(Boolean) as HTMLVideoElement[];
    const onLoad = (e: Event) => {
      const v = e.target as HTMLVideoElement;
      try { v.currentTime = tRef.current; } catch { /* ignore */ }
      if (playing) v.play().catch(() => {});
    };
    vids.forEach((v) => v.addEventListener("loadeddata", onLoad));
    return () => vids.forEach((v) => v.removeEventListener("loadeddata", onLoad));
  }, [playing]);

  const src = api.sceneVideoUrl(projectId, scene.id);

  // crop window -> position the video so the crop region fills the frame (no
  // distortion because crop aspect is kept equal to the output aspect).
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

  return (
    <div className="scene-overlay">
      {mode === "fit" ? (
        <>
          <video ref={bgRef} className="scene-bg" src={src} muted playsInline preload="auto" />
          <video ref={fgRef} className="scene-fg" src={src} muted playsInline preload="auto" />
        </>
      ) : (
        <video ref={fgRef} className="scene-crop" style={cropStyle} src={src} muted playsInline preload="auto" />
      )}
    </div>
  );
}
