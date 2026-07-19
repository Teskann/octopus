import { useEffect, useRef } from "react";
import { api } from "../api";

/** A scene's raw source shown full (in-flow, so it sizes the preview frame to
 *  the scene's own aspect), synced to the main playhead. Used while reframing a
 *  secondary scene so the crop rectangle behaves exactly like the main's. */
export function SceneSourceVideo({
  projectId,
  sceneId,
  width,
  height,
  maxW,
  maxH,
  t,
  playing,
}: {
  projectId: string;
  sceneId: string;
  width?: number;
  height?: number;
  maxW?: number;
  maxH?: number;
  t: number;
  playing: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (Math.abs(v.currentTime - t) > 0.2) {
      try { v.currentTime = t; } catch { /* not seekable yet */ }
    }
    if (playing) v.play().catch(() => {});
    else v.pause();
  }, [t, playing]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const onLoad = () => { try { v.currentTime = tRef.current; } catch { /* ignore */ } };
    v.addEventListener("loadeddata", onLoad);
    return () => {
      v.removeEventListener("loadeddata", onLoad);
      // Release the decoder only on a REAL unmount (see Editor) — the isConnected
      // check avoids stripping src during React StrictMode's dev remount.
      setTimeout(() => {
        if (v.isConnected) return;
        try { v.pause(); v.removeAttribute("src"); v.load(); } catch { /* ignore */ }
      }, 0);
    };
  }, []);

  return (
    // width/height reserve the scene's aspect BEFORE the video loads its metadata
    // — without them a <video> reports 300×150 (2:1), so the in-flow .video-frame
    // (and the ReframeBox drawn over it) would size wrong until load, then jump.
    <video
      ref={ref}
      className="edit-video"
      width={width || undefined}
      height={height || undefined}
      style={{ maxWidth: maxW || undefined, maxHeight: maxH || undefined }}
      src={api.sceneVideoUrl(projectId, sceneId)}
      muted
      playsInline
      preload="auto"
    />
  );
}
