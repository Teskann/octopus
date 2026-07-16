import { useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { Overlay } from "../types";

const REFERENCE_WIDTH = 1080;

function hexToRgba(hex: string, opacity: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
const clamp = (v: number, lo = 0, hi = 1) => Math.min(Math.max(v, lo), hi);

/** Run a pointer gesture with pointer capture so move/up are reliably delivered
 *  to this element even if the cursor leaves it — without capture, a fast
 *  release could drop the pointerup and the element would keep following. */
function beginGesture(e: ReactPointerEvent, onMove: (ev: PointerEvent) => void) {
  const el = e.currentTarget as HTMLElement;
  const id = e.pointerId;
  el.setPointerCapture(id);
  const stop = () => {
    try { el.releasePointerCapture(id); } catch { /* already released */ }
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", stop);
    el.removeEventListener("pointercancel", stop);
  };
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", stop);
  el.addEventListener("pointercancel", stop);
}

/** Overlays over the video. Rendered when active at time `t` OR selected/edited
 *  (so they don't vanish while you position them). Drag to move, corner handle
 *  to resize, double-click text to edit inline. */
export function OverlayLayer({
  overlays,
  t,
  videoWidth,
  selectedId,
  onSelect,
  onMove,
  onResize,
  onEditText,
}: {
  overlays: Overlay[];
  t: number;
  videoWidth: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, patch: Partial<Overlay>) => void;
  onEditText: (id: string, text: string) => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const scale = videoWidth ? videoWidth / REFERENCE_WIDTH : 0.4;

  function startDrag(e: ReactPointerEvent, ov: Overlay) {
    if (editingId === ov.id) return;
    e.preventDefault();
    onSelect(ov.id);
    const rect = layerRef.current!.getBoundingClientRect();
    const grabX = (e.clientX - rect.left) / rect.width - ov.x;
    const grabY = (e.clientY - rect.top) / rect.height - ov.y;
    beginGesture(e, (ev) =>
      onMove(
        ov.id,
        clamp((ev.clientX - rect.left) / rect.width - grabX),
        clamp((ev.clientY - rect.top) / rect.height - grabY)
      )
    );
  }

  function startResize(e: ReactPointerEvent, ov: Overlay) {
    e.preventDefault();
    e.stopPropagation();
    onSelect(ov.id);
    const rect = layerRef.current!.getBoundingClientRect();
    const leftPx = rect.left + ov.x * rect.width;
    const topPx = rect.top + ov.y * rect.height;
    beginGesture(e, (ev) => {
      if (ov.type === "image") {
        onResize(ov.id, { scale: clamp((ev.clientX - leftPx) / rect.width, 0.05, 1.5) });
      } else {
        onResize(ov.id, { font_size: clamp(Math.round((ev.clientY - topPx) / scale), 12, 320) });
      }
    });
  }

  const visible = overlays.filter(
    (ov) => (t >= ov.start && t < ov.end) || ov.id === selectedId || ov.id === editingId
  );

  return (
    <div ref={layerRef} className="overlay-layer">
      {visible.map((ov) => {
        const selected = ov.id === selectedId;
        return (
          <div
            key={ov.id}
            className={`ov ${selected ? "selected" : ""}`}
            style={{ left: `${ov.x * 100}%`, top: `${ov.y * 100}%` }}
            onPointerDown={(e) => startDrag(e, ov)}
          >
            {ov.type === "text" ? (
              editingId === ov.id ? (
                <textarea
                  autoFocus
                  className="ov-edit"
                  defaultValue={ov.text}
                  style={{ ...textStyle(ov, scale, videoWidth), width: `${editWidth(ov, videoWidth)}px` }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    onEditText(ov.id, e.target.value);
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      (e.target as HTMLTextAreaElement).blur();
                    } else if (e.key === "Escape") {
                      setEditingId(null);
                    }
                  }}
                />
              ) : (
                <span
                  className="ov-text"
                  style={textStyle(ov, scale, videoWidth)}
                  onDoubleClick={() => {
                    onSelect(ov.id);
                    setEditingId(ov.id);
                  }}
                >
                  {ov.text}
                </span>
              )
            ) : (
              <img src={ov.url} style={{ width: `${ov.scale * videoWidth}px` }} draggable={false} />
            )}
            {selected && <div className="ov-handle" onPointerDown={(e) => startResize(e, ov)} />}
          </div>
        );
      })}
    </div>
  );
}

type TextOv = Extract<Overlay, { type: "text" }>;

// Text wraps within this fraction of the video width, so long lines break onto
// several lines instead of running off-screen; the box shrinks to fit shorter text.
function maxTextWidth(ov: TextOv, videoWidth: number): number {
  return Math.max(0.2, Math.min(0.9, 1 - ov.x)) * videoWidth;
}
function editWidth(ov: TextOv, videoWidth: number): number {
  return maxTextWidth(ov, videoWidth);
}

function textStyle(ov: TextOv, scale: number, videoWidth: number): CSSProperties {
  return {
    fontFamily: `"${ov.font}"`,
    fontSize: `${ov.font_size * scale}px`,
    color: ov.color,
    display: "inline-block",
    maxWidth: `${maxTextWidth(ov, videoWidth)}px`,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    textAlign: "center",
    lineHeight: 1.15,
    // shadow defaults on (undefined => true) so existing overlays are unchanged
    ...(ov.shadow !== false ? { textShadow: "0 2px 6px rgba(0,0,0,0.6)" } : {}),
    ...(ov.box_enabled
      ? {
          background: hexToRgba(ov.box_color, ov.box_opacity),
          padding: `${ov.box_padding * scale}px ${ov.box_padding * 1.6 * scale}px`,
          borderRadius: `${ov.box_radius * scale}px`,
        }
      : {}),
  };
}
