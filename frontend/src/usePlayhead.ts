import { useEffect, useRef, useState, type RefObject } from "react";

/** Track a <video>'s currentTime while playing. The playhead re-renders the whole
 *  editor tree, so the play loop is THROTTLED to ~30Hz: at 60fps it can saturate
 *  the main thread and starve the video decoder + the rAF loop itself — which
 *  shows up as stutter, slow-motion, or a frozen timeline (t stops advancing).
 *  30Hz is smooth for captions + the playhead marker at half the render load.
 *  Seeks/pause update immediately so scrubbing stays responsive. */
const MIN_DT = 1000 / 30;

export function usePlayhead(videoRef: RefObject<HTMLVideoElement>) {
  const [time, setTime] = useState(0);
  const raf = useRef<number>();
  const last = useRef(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const loop = (ts: number) => {
      if (ts - last.current >= MIN_DT) {
        last.current = ts;
        setTime(video.currentTime);
      }
      raf.current = requestAnimationFrame(loop);
    };
    const start = () => {
      cancelAnimationFrame(raf.current!);
      last.current = 0; // update on the very next frame
      raf.current = requestAnimationFrame(loop);
    };
    const pause = () => {
      cancelAnimationFrame(raf.current!);
      setTime(video.currentTime);
    };
    // A seek fires "seeked" even mid-playback. Snap the time, and if the video
    // is still playing, resume the loop — otherwise it would freeze here (the
    // bug where captions got stuck after scrubbing / arrow keys while playing).
    const seeked = () => {
      setTime(video.currentTime);
      if (!video.paused) start();
    };
    const seeking = () => setTime(video.currentTime);

    video.addEventListener("play", start);
    video.addEventListener("playing", start);
    video.addEventListener("pause", pause);
    video.addEventListener("seeked", seeked);
    video.addEventListener("seeking", seeking);
    if (!video.paused) start();

    return () => {
      cancelAnimationFrame(raf.current!);
      video.removeEventListener("play", start);
      video.removeEventListener("playing", start);
      video.removeEventListener("pause", pause);
      video.removeEventListener("seeked", seeked);
      video.removeEventListener("seeking", seeking);
    };
  }, [videoRef]);

  return time;
}
