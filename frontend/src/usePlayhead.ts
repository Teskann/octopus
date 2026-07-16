import { useEffect, useRef, useState } from "react";

/** Track a <video>'s currentTime smoothly via requestAnimationFrame while
 *  playing (timeupdate only fires ~4x/s, too coarse for word highlighting). */
export function usePlayhead(videoRef: React.RefObject<HTMLVideoElement>) {
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
    const stop = () => {
      cancelAnimationFrame(raf.current!);
      setTime(video.currentTime);
    };

    video.addEventListener("play", start);
    video.addEventListener("pause", stop);
    video.addEventListener("seeked", stop);
    if (!video.paused) start();

    return () => {
      cancelAnimationFrame(raf.current!);
      video.removeEventListener("play", start);
      video.removeEventListener("pause", stop);
      video.removeEventListener("seeked", stop);
    };
  }, [videoRef]);

  return time;
}
