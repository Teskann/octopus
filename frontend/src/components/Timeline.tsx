import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";
import type { Clip, Scene, SceneCut } from "../types";
import { cleanCuts } from "../scenes";

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/** Whole-video timeline: click to seek, drag to select a range, right-click to
 *  generate a clip from the selection (or a default range at the cursor). */
export function Timeline({
  duration,
  t,
  clips,
  scenes,
  cuts,
  selectedClipId,
  onSeek,
  onCreateClip,
  onSelectClip,
}: {
  duration: number;
  t: number;
  clips: Clip[];
  scenes: Scene[];
  cuts: SceneCut[];
  selectedClipId: string | null;
  onSeek: (to: number) => void;
  onCreateClip: (start: number, end: number) => void;
  onSelectClip: (id: string) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; start: number; end: number } | null>(null);

  const pct = (time: number) => (duration ? (time / duration) * 100 : 0);
  const timeAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration);
  };

  // Colour the track by the active scene across time (from the scene cuts).
  const sceneColor = (id: string) => scenes.find((s) => s.id === id)?.color ?? "#334155";
  const bands: { start: number; end: number; color: string }[] = [];
  if (duration && scenes.length > 1) {
    const sorted = cleanCuts(cuts); // drop redundant/self cuts, like the render
    let prev = 0;
    let prevScene = "main";
    for (const c of sorted) {
      if (c.time > prev) bands.push({ start: prev, end: c.time, color: sceneColor(prevScene) });
      prevScene = c.scene_id;
      prev = c.time;
    }
    bands.push({ start: prev, end: duration, color: sceneColor(prevScene) });
  }

  function onTrackDown(e: ReactPointerEvent) {
    if (e.button !== 0) return; // left button only; right opens the context menu
    const el = e.currentTarget as HTMLElement;
    const downTime = timeAt(e.clientX);
    let moved = false;
    el.setPointerCapture(e.pointerId);
    setMenu(null);
    const move = (ev: PointerEvent) => {
      const cur = timeAt(ev.clientX);
      if (Math.abs(cur - downTime) > 0.15) moved = true;
      setSel({ start: Math.min(downTime, cur), end: Math.max(downTime, cur) });
    };
    const up = () => {
      try { el.releasePointerCapture(e.pointerId); } catch { /* ok */ }
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      if (!moved) {
        setSel(null);
        onSeek(downTime);
      }
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  function onContextMenu(e: ReactMouseEvent) {
    e.preventDefault();
    const at = timeAt(e.clientX);
    const range = sel && sel.end - sel.start > 0.2 ? sel : { start: at, end: Math.min(at + 15, duration) };
    setMenu({ x: e.clientX, y: e.clientY, start: range.start, end: range.end });
  }

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  return (
    <div className="timeline">
      <div ref={trackRef} className="tl-track" onPointerDown={onTrackDown} onContextMenu={onContextMenu}>
        {bands.map((b, i) => (
          <div
            key={i}
            className="tl-scene"
            style={{ left: `${pct(b.start)}%`, width: `${pct(b.end - b.start)}%`, background: b.color }}
          />
        ))}
        {clips.map((c) => (
          <div
            key={c.id}
            className={`tl-clip ${c.id === selectedClipId ? "sel" : ""}`}
            style={{ left: `${pct(c.start)}%`, width: `${pct(c.end - c.start)}%` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelectClip(c.id);
              onSeek(c.start);
            }}
            title={c.name}
          >
            <span>{c.name}</span>
          </div>
        ))}
        {sel && (
          <div className="tl-sel" style={{ left: `${pct(sel.start)}%`, width: `${pct(sel.end - sel.start)}%` }} />
        )}
        <div className="tl-playhead" style={{ left: `${pct(t)}%` }} />
      </div>

      <div className="tl-labels">
        <span>{fmt(t)}</span>
        {sel && sel.end - sel.start > 0.2 && (
          <span className="accent">
            sélection {fmt(sel.start)}–{fmt(sel.end)} ({fmt(sel.end - sel.start)}) · clic droit pour créer
          </span>
        )}
        <span className="muted">{fmt(duration)}</span>
      </div>

      {menu && (
        <div className="tl-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => {
              onCreateClip(menu.start, menu.end);
              setSel(null);
              setMenu(null);
            }}
          >
            ＋ Générer un clip ({fmt(menu.end - menu.start)})
          </button>
        </div>
      )}
    </div>
  );
}
