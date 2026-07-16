import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api } from "../api";
import { usePlayhead } from "../usePlayhead";
import { buildCues, activeCueIndex, isWordActive } from "../captions";
import { StylePanel } from "./StylePanel";
import { TranslateBar } from "./TranslateBar";
import type { Project, Style } from "../types";

const REFERENCE_WIDTH = 1080; // style authored against this (matches backend)

function hexToRgba(hex: string, opacity: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export function Editor({ initial }: { initial: Project }) {
  const [project, setProject] = useState<Project>(initial);
  const [style, setStyle] = useState<Style>(initial.style);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoWidth, setVideoWidth] = useState(0);
  const t = usePlayhead(videoRef);
  const saveTimer = useRef<number>();

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const measure = () => setVideoWidth(v.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(v);
    return () => ro.disconnect();
  }, []);

  const cues = useMemo(
    () => buildCues(project.segments, style),
    [project.segments, style]
  );
  const cueIdx = activeCueIndex(cues, t);
  const cue = cueIdx >= 0 ? cues[cueIdx] : null;
  const translation = cue ? cue.translation : "";

  const scale = videoWidth ? videoWidth / REFERENCE_WIDTH : 0.4;

  function updateStyle(patch: Partial<Style>) {
    const next = { ...style, ...patch };
    setStyle(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      api.patchProject(project.id, { style: next }).catch(() => {});
    }, 400);
  }

  function seek(to: number) {
    const v = videoRef.current;
    if (v) v.currentTime = to + 0.001;
  }

  const cap = (s: string) => (style.uppercase ? s.toUpperCase() : s);
  const boxBg = style.box_enabled
    ? hexToRgba(style.box_color, style.box_opacity)
    : "transparent";

  // One box wraps the whole caption block (all lines together), not per line.
  const boxStyle: CSSProperties = style.box_enabled
    ? {
        background: boxBg,
        padding: `${style.box_padding_y * scale}px ${style.box_padding_x * scale}px`,
        borderRadius: `${style.box_radius * scale}px`,
      }
    : {};

  const textStyle = (fontPx: number, color: string, strokePx: number): CSSProperties => ({
    fontFamily: `"${style.font}"`,
    fontSize: `${fontPx}px`,
    color,
    // A box replaces the per-glyph outline (matches the ASS export).
    WebkitTextStroke: style.box_enabled ? undefined : `${strokePx}px ${style.outline_color}`,
    paintOrder: "stroke fill",
  });

  const translationRow = translation ? (
    <div className="cap-row" key="trans">
      <span
        className="cap-box"
        style={textStyle(
          style.font_size * scale * style.translation_scale,
          style.translation_color,
          style.outline_width * scale * 0.6
        )}
      >
        {cap(translation)}
      </span>
    </div>
  ) : null;

  return (
    <div className="editor">
      <section className="stage">
        <TranslateBar project={project} onUpdate={setProject} />
        <div className="video-outer">
          <div className="video-frame">
          <video ref={videoRef} src={api.videoUrl(project.id)} controls />
          {cue && (
            <div className={`caption pos-${style.position}`} style={captionPos(style, scale)}>
              <div className="caption-box" style={boxStyle}>
              {style.translation_position === "above" && translationRow}
              {cue.lines.length > 0
                ? cue.lines.map((line, li) => (
                    <div className="cap-row" key={li}>
                      <span
                        className="cap-box"
                        style={textStyle(style.font_size * scale, style.primary_color, style.outline_width * scale)}
                      >
                        {line.map((w, wi) => (
                          <span
                            key={wi}
                            style={
                              style.highlight_enabled && isWordActive(w, t)
                                ? { color: style.highlight_color }
                                : undefined
                            }
                          >
                            {cap(w.text)}{" "}
                          </span>
                        ))}
                      </span>
                    </div>
                  ))
                : (
                  <div className="cap-row">
                    <span
                      className="cap-box"
                      style={textStyle(style.font_size * scale, style.primary_color, style.outline_width * scale)}
                    >
                      {cap(cue.text)}
                    </span>
                  </div>
                )}
              {style.translation_position === "below" && translationRow}
              </div>
            </div>
          )}
          </div>
        </div>
        <p className="muted small">
          {project.language ? `Langue : ${project.language}. ` : ""}
          {project.segments.length} segments · {project.width}×{project.height}
        </p>
      </section>

      <aside className="side">
        <StylePanel style={style} onChange={updateStyle} />
        <div className="transcript">
          <h3>Transcription</h3>
          <div className="segments">
            {project.segments.map((s) => {
              const isActive = t >= s.start && t < s.end;
              return (
                <div
                  key={s.id}
                  className={`seg ${isActive ? "active" : ""}`}
                  onClick={() => seek(s.start)}
                >
                  <span className="ts">{s.start.toFixed(1)}s</span>
                  <span className="seg-text">
                    {s.words.length > 0
                      ? s.words.map((w, j) => (
                          <span
                            key={j}
                            className={isActive && isWordActive(w, t) ? "word on" : "word"}
                          >
                            {w.text}{" "}
                          </span>
                        ))
                      : s.text}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}

function captionPos(style: Style, scale: number): CSSProperties {
  const m = style.margin_v * scale;
  if (style.position === "top") return { top: m };
  if (style.position === "middle") return { top: "50%", transform: "translateY(-50%)" };
  return { bottom: m };
}
