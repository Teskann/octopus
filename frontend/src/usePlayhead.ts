import { useEffect, useRef, useState, type RefObject } from "react";

/** Track a <video>'s currentTime smoothly via requestAnimationFrame while
 *  playing (timeupdate only fires ~4x/s, too coarse for word highlighting). */
export function usePlayhead(videoRef: RefObject<HTMLVideoElement>) {
  const [time, setTime] = useState(0);
  const raf = useRef<number>();

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const loop = () => {
      setTime(video.currentTime);
      raf.current = requestAnimationFrame(loop);
    };
    const start = () => {
      cancelAnimationFrame(raf.current!);
      loop();
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
