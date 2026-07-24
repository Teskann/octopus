import type { CSSProperties } from "react";
import type { Cue } from "../captions";
import { isWordActive } from "../captions";
import { frenchSpacing, hugsNext, hugsPrev } from "../text";
import type { Style } from "../types";

/** The on-screen caption block. Single source of truth shared by the editor
 *  preview (Editor.tsx) and the export render page (RenderStage.tsx) so what you
 *  see and what you download are produced by the exact same DOM/CSS.
 *
 *  `scale` = (caption-window width in px) / 1080 — style sizes are authored
 *  against a 1080-wide reference. In the preview that window is the displayed
 *  frame; in the export it is the full output width. Same ratio, different res. */
export function CaptionBlock({
  style,
  cue,
  t,
  scale,
  frMain,
  frTrans,
}: {
  style: Style;
  cue: Cue;
  t: number;
  scale: number;
  frMain: boolean;
  frTrans: boolean;
}) {
  const cap = (s: string) => (style.uppercase ? s.toUpperCase() : s);
  const fmtMain = (s: string) => cap(frMain ? frenchSpacing(s) : s);
  const fmtTrans = (s: string) => cap(frTrans ? frenchSpacing(s) : s);
  const translation = cue.translation;

  // One box wraps the whole caption block (all lines together), not per line.
  const boxStyle: CSSProperties = style.box_enabled
    ? {
        background: hexToRgba(style.box_color, style.box_opacity),
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

  const translationRow =
    style.translation_enabled && translation ? (
      <div className="cap-row" key="trans">
        <span
          className="cap-box"
          style={textStyle(
            style.font_size * scale * style.translation_scale,
            style.translation_color,
            style.outline_width * scale * 0.6
          )}
        >
          {fmtTrans(translation)}
        </span>
      </div>
    ) : null;

  return (
    <div className={`caption pos-${style.position}`} style={captionPos(style, scale)}>
      <div className="caption-box" style={boxStyle}>
        {style.translation_position === "above" && translationRow}
        {cue.lines.length > 0 ? (
          cue.lines.map((line, li) => (
            <div className="cap-row" key={li}>
              <span
                className="cap-box cap-line"
                style={textStyle(style.font_size * scale, style.primary_color, style.outline_width * scale)}
              >
                {line.map((w, wi) => {
                  const next = line[wi + 1];
                  // Non-breaking space when a French sign hugs this join, so the
                  // browser can't drop a lone "?" or "»" onto its own line.
                  const sep = hugsNext(w.text) || (next && hugsPrev(next.text)) ? "\u00A0" : " ";
                  return (
                    <span
                      key={wi}
                      style={
                        style.highlight_enabled && isWordActive(w, t)
                          ? { color: style.highlight_color }
                          : undefined
                      }
                    >
                      {fmtMain(w.text)}
                      {sep}
                    </span>
                  );
                })}
              </span>
            </div>
          ))
        ) : (
          <div className="cap-row">
            <span
              className="cap-box"
              style={textStyle(style.font_size * scale, style.primary_color, style.outline_width * scale)}
            >
              {fmtMain(cue.text)}
            </span>
          </div>
        )}
        {style.translation_position === "below" && translationRow}
      </div>
    </div>
  );
}

function captionPos(style: Style, scale: number): CSSProperties {
  const m = style.margin_v * scale;
  if (style.position === "top") return { top: m };
  if (style.position === "middle") return { top: "50%", transform: "translateY(-50%)" };
  return { bottom: m };
}

function hexToRgba(hex: string, opacity: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
