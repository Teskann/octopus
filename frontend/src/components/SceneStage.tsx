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

  // Only the active scene follows the playhead + play state. The muted scene
  // plays freely at ~1×; we bias its playbackRate PROPORTIONALLY to the drift so
  // it eases back to zero — the further behind, the faster it runs (up to 2×),
  // converging in ~1s with no backward jump or flicker. A hard seek is used ONLY
  // for a genuine timeline jump (drift > 1.5s), and NEVER while the element is
  // already seeking: re-issuing `currentTime = t` at 60fps is what wedged the
  // decoder ("freeze until I reopen") and yanked the image backwards; the weak
  // 1.06× recovery is what left it 1-2s behind the audio.
  useEffect(() => {
    if (!active) {
      vids().forEach((v) => { v.pause(); v.playbackRate = 1; });
      return;
    }
    for (const v of vids()) {
      const drift = v.currentTime - t; // + = image ahead, - = image behind
      if (!playing) {
        v.playbackRate = 1;
        if (!v.seeking && Math.abs(drift) > 0.05) {
          try { v.currentTime = t; } catch { /* ignore */ }
        }
        v.pause();
        continue;
      }
      if (Math.abs(drift) > 1.5) {
        if (!v.seeking) { try { v.currentTime = t; } catch { /* ignore */ } }
        v.playbackRate = 1;
      } else {
        // Proportional catch-up: rate 1 at zero drift, clamped to [0.5×, 2×].
        v.playbackRate = Math.min(2, Math.max(0.5, 1 - drift * 2));
      }
      if (v.paused) v.play().catch(() => {});
    }
  }, [active, t, playing]);

  // Snap to the current time whenever a source (re)loads. Force a REAL seek even
  // when the target equals the current time (both 0 at open): setting currentTime
  // to the value it already holds is a no-op, so the HW decoder never paints and
  // the scene stays black/frozen until a manual seek. A tiny epsilon guarantees a
  // seek → a decoded frame.
  useEffect(() => {
    const list = vids();
    const snap = (v: HTMLVideoElement) => {
      const target = tRef.current;
      try {
        v.currentTime = Math.abs(v.currentTime - target) < 0.001 ? target + 0.001 : target;
      } catch { /* ignore */ }
    };
    const onLoad = (e: Event) => snap(e.target as HTMLVideoElement);
    list.forEach((v) => {
      // Already decoded (loadeddata fired before this effect ran, e.g. the second
      // fit-mode <video> of the same source) → kick now; otherwise wait for load.
      if (v.readyState >= 2) snap(v);
      else v.addEventListener("loadeddata", onLoad);
    });
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
