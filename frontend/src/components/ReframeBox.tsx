import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Frame } from "../types";
import { outputRatio } from "../frame";

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** The output framing window over the video: the dashed rectangle is what ends
 *  up in the export; everything outside is dimmed. When editable, drag the body
 *  to pan and the corner handle to zoom (aspect kept unless "free"). */
export function ReframeBox({
  frame,
  sourceW,
  sourceH,
  editable,
  onChange,
}: {
  frame: Frame;
  sourceW: number;
  sourceH: number;
  editable: boolean;
  onChange: (patch: Partial<Frame>) => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const locked = frame.aspect !== "free";
  const R = outputRatio(frame.aspect, sourceW, sourceH);

  function panDrag(e: ReactPointerEvent) {
    if (!editable) return;
    e.preventDefault();
    const rect = layerRef.current!.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const { x, y, w, h } = frame;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / rect.width;
      const dy = (ev.clientY - startY) / rect.height;
      onChange({ x: clamp(x + dx, 0, 1 - w), y: clamp(y + dy, 0, 1 - h) });
    };
    const up = () => {
      try { el.releasePointerCapture(e.pointerId); } catch { /* ok */ }
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  function resizeDrag(e: ReactPointerEvent) {
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = layerRef.current!.getBoundingClientRect();
    const { x, y } = frame;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      let w = clamp((ev.clientX - rect.left) / rect.width - x, 0.05, 1 - x);
      let h: number;
      if (locked) {
        h = (w * sourceW) / (R * sourceH);
        if (y + h > 1) {
          h = 1 - y;
          w = (R * sourceH * h) / sourceW;
        }
      } else {
        h = clamp((ev.clientY - rect.top) / rect.height - y, 0.05, 1 - y);
      }
      onChange({ w, h });
    };
    const up = () => {
      try { el.releasePointerCapture(e.pointerId); } catch { /* ok */ }
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  const isFull = frame.x === 0 && frame.y === 0 && frame.w === 1 && frame.h === 1;
  if (isFull && !editable) return null; // nothing to show for the full frame

  return (
    <div ref={layerRef} className="reframe-layer">
      <div
        className={`reframe-box ${editable ? "editable" : ""}`}
        style={{
          left: `${frame.x * 100}%`,
          top: `${frame.y * 100}%`,
          width: `${frame.w * 100}%`,
          height: `${frame.h * 100}%`,
        }}
        onPointerDown={panDrag}
      >
        {editable && <div className="reframe-handle" onPointerDown={resizeDrag} />}
      </div>
    </div>
  );
}
