import { useEffect, useRef } from "react";
import { api } from "../api";

/** A scene's raw source shown full (in-flow, so it sizes the preview frame to
 *  the scene's own aspect), synced to the main playhead. Used while reframing a
 *  secondary scene so the crop rectangle behaves exactly like the main's. */
export function SceneSourceVideo({
  projectId,
  sceneId,
  t,
  playing,
}: {
  projectId: string;
  sceneId: string;
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
    return () => v.removeEventListener("loadeddata", onLoad);
  }, []);

  return (
    <video ref={ref} className="edit-video" src={api.sceneVideoUrl(projectId, sceneId)} muted playsInline preload="auto" />
  );
}
