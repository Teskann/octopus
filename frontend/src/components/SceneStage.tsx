import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { api } from "../api";
import type { FitMode, Scene } from "../types";

/** A scene's player. Kept mounted for the whole session (never remounted on a
 *  switch) — only the `active` one is shown and played, the rest stay loaded and
 *  paused. This is what makes switching stable: no reload, no black frame, no
 *  race between the fit layers. Crossfade + slight scale gives the punch.
 *  - "crop": one video sized to map its crop window (cover, no black).
 *  - "fit": a blurred cover copy behind + the whole scene contained in front. */
export function SceneStage({
  projectId,
  scene,
  mode,
  crop,
  t,
  active,
  playing,
}: {
  projectId: string;
  scene: Scene;
  mode: FitMode;
  crop: { x: number; y: number; w: number; h: number };
  t: number;
  active: boolean;
  playing: boolean;
}) {
  const bgRef = useRef<HTMLVideoElement>(null);
  const fgRef = useRef<HTMLVideoElement>(null);
  const tRef = useRef(t);
  tRef.current = t;

  const vids = () => [bgRef.current, fgRef.current].filter(Boolean) as HTMLVideoElement[];

  // Only the active scene follows the playhead + play state.
  useEffect(() => {
    if (!active) {
      vids().forEach((v) => v.pause());
      return;
    }
    for (const v of vids()) {
      const drift = Math.abs(v.currentTime - t);
      if (playing) {
        if (drift > 0.5) { try { v.currentTime = t; } catch { /* ignore */ } }
        if (v.paused) v.play().catch(() => {});
      } else {
        if (drift > 0.05) { try { v.currentTime = t; } catch { /* ignore */ } }
        v.pause();
      }
    }
  }, [active, t, playing]);

  // Snap to the current time whenever a source (re)loads.
  useEffect(() => {
    const list = vids();
    const onLoad = (e: Event) => {
      const v = e.target as HTMLVideoElement;
      try { v.currentTime = tRef.current; } catch { /* ignore */ }
    };
    list.forEach((v) => v.addEventListener("loadeddata", onLoad));
    return () => list.forEach((v) => v.removeEventListener("loadeddata", onLoad));
  }, []);

  const src = api.sceneVideoUrl(projectId, scene.id);
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
    <div className={`scene-overlay ${active ? "active" : ""}`}>
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
