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

  // Sanitize the incoming window so the box (and its handle) can never fall
  // outside the video — a stale/migrated crop with x+w>1 or y+h>1 would push the
  // bottom-right handle off-screen and make the scene impossible to reframe.
  const w = clamp(frame.w, 0.05, 1);
  const h = clamp(frame.h, 0.05, 1);
  const x = clamp(frame.x, 0, 1 - w);
  const y = clamp(frame.y, 0, 1 - h);

  function panDrag(e: ReactPointerEvent) {
    if (!editable) return;
    e.preventDefault();
    const rect = layerRef.current!.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
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
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      let w: number;
      let h: number;
      if (locked) {
        // Aspect is locked, so the corner can only move along the diagonal from the
        // box's top-left. Project the pointer onto that diagonal (in pixels) so the
        // corner follows the cursor as closely as possible from ANY direction —
        // dragging inward shrinks, outward grows. Clamp so the window never exceeds
        // the source in either dimension (a full-height crop simply can't grow).
        const W = rect.width;
        const H = rect.height;
        const Dx = W;
        const Dy = (H * sourceW) / (R * sourceH);
        const Vx = ev.clientX - rect.left - x * W;
        const Vy = ev.clientY - rect.top - y * H;
        const t = (Vx * Dx + Vy * Dy) / (Dx * Dx + Dy * Dy);
        const maxW = Math.min(1 - x, (R * sourceH * (1 - y)) / sourceW);
        w = clamp(t, 0.05, maxW);
        h = (w * sourceW) / (R * sourceH);
      } else {
        w = clamp((ev.clientX - rect.left) / rect.width - x, 0.05, 1 - x);
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

  const isFull = x === 0 && y === 0 && w === 1 && h === 1;
  if (isFull && !editable) return null; // nothing to show for the full frame

  // Keep the resize handle fully on-screen: it normally straddles the corner
  // (right/bottom -9px), but when the box hugs the video edge that overhang gets
  // clipped by the stage's overflow:hidden — so tuck it inside there instead.
  const atRight = x + w > 0.995;
  const atBottom = y + h > 0.995;
  const handleStyle = {
    right: atRight ? 2 : -9,
    bottom: atBottom ? 2 : -9,
  };

  return (
    <div ref={layerRef} className="reframe-layer">
      <div
        className={`reframe-box ${editable ? "editable" : ""}`}
        style={{
          left: `${x * 100}%`,
          top: `${y * 100}%`,
          width: `${w * 100}%`,
          height: `${h * 100}%`,
        }}
        onPointerDown={panDrag}
      >
        {editable && <div className="reframe-handle" style={handleStyle} onPointerDown={resizeDrag} />}
      </div>
    </div>
  );
}
