"""Generate an ASS subtitle file from a project's segments + style.

TikTok-style captions: a segment's words are grouped into *blocks* of at most
`max_lines` lines, each line filling up to `max_line_width_pct`% of the video
width. A block is what is shown on screen at once (fewer at the end of a
segment). When the
word-highlight is on, one Dialogue event is emitted per word so the active word
pops in the highlight colour; when off, one event per block. A smaller
translation line is drawn underneath, and an optional solid box sits behind it.

This is the single source of truth for the burned-in look; the browser preview
mirrors the same grouping so what you see matches the export.
"""
from __future__ import annotations

REFERENCE_WIDTH = 1080  # style.font_size / margins are authored against this


def _ass_color(hex_color: str, opacity: float = 1.0) -> str:
    """#RRGGBB -> ASS &HAABBGGRR. ASS is BGR; alpha 00=opaque, FF=transparent."""
    h = hex_color.lstrip("#")
    if len(h) != 6:
        return "&H00FFFFFF"
    r, g, b = h[0:2], h[2:4], h[4:6]
    alpha = max(0, min(255, round((1.0 - opacity) * 255)))
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def _ass_time(t: float) -> str:
    t = max(t, 0.0)
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    cs = int(round((t - int(t)) * 100))
    if cs == 100:  # rounding spill
        cs = 0
        s += 1
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "(").replace("}", ")")


# Rough average glyph width as a fraction of the font size. The browser preview
# measures real text; this estimate keeps the backend (ASS + translation split)
# in the same ballpark without font metrics. Exact parity comes in the export
# phase, which will use the frontend's measured layout.
_CHAR_RATIO = 0.52


def _est_px(text: str, font_size: float) -> float:
    return len(text) * font_size * _CHAR_RATIO


def blocks_for(words: list[dict], style: dict) -> list[list[list[dict]]]:
    """Group words into blocks -> lines -> words, wrapping each line by width."""
    if not words:
        return []
    max_lines = max(style.get("max_lines", 2), 1)
    fs = style.get("font_size", 56)
    upper = style.get("uppercase", True)
    max_line_px = style.get("max_line_width_pct", 80) / 100 * REFERENCE_WIDTH

    blocks: list[list[list[dict]]] = []
    cur_block: list[list[dict]] = []
    cur_line: list[dict] = []

    def line_text(line: list[dict], extra: dict | None = None) -> str:
        ws = line + ([extra] if extra else [])
        t = " ".join(w["text"] for w in ws)
        return t.upper() if upper else t

    for word in words:
        if cur_line and _est_px(line_text(cur_line, word), fs) > max_line_px:
            cur_block.append(cur_line)
            cur_line = [word]
            if len(cur_block) >= max_lines:
                blocks.append(cur_block)
                cur_block = []
        else:
            cur_line.append(word)
    if cur_line:
        cur_block.append(cur_line)
    if cur_block:
        blocks.append(cur_block)
    return blocks


def _alignment(position: str) -> int:
    return {"top": 8, "middle": 5, "bottom": 2}.get(position, 2)


def split_translation(translation: str, counts: list[int]) -> list[str]:
    """Split a segment's translation across its caption blocks proportionally to
    each block's word count, so the (full-context) translation lines up roughly
    with what is on screen. Deterministic — the browser preview does the same."""
    words = translation.split()
    n = len(words)
    total = sum(counts) or 1
    parts: list[str] = []
    acc = 0
    for c in counts:
        start = round(n * acc / total)
        acc += c
        end = round(n * acc / total)
        parts.append(" ".join(words[start:end]))
    return parts


def build_ass(project: dict, width: int, height: int) -> str:
    style = project["style"]
    scale = width / REFERENCE_WIDTH
    fs = max(int(round(style["font_size"] * scale)), 8)
    t_fs = max(int(round(fs * style["translation_scale"])), 6)
    margin_v = int(round(style["margin_v"] * scale))
    outline = max(round(style["outline_width"] * scale, 1), 0)

    primary = _ass_color(style["primary_color"])
    highlight = _ass_color(style["highlight_color"])
    t_color = _ass_color(style["translation_color"])
    align = _alignment(style["position"])
    upper = style["uppercase"]
    hl_on = style.get("highlight_enabled", True)
    box_on = style.get("box_enabled", False)

    # A box (BorderStyle 3) paints an opaque rectangle behind the text using the
    # OutlineColour; without a box we use a normal text outline (BorderStyle 1).
    if box_on:
        border_style = 3
        outline_c = _ass_color(style["box_color"], style.get("box_opacity", 0.55))
        # libass box padding is the (uniform) Outline value; radius isn't
        # supported by libass, so box_radius only affects the browser preview.
        pad = (style.get("box_padding_x", 26) + style.get("box_padding_y", 10)) / 2
        border_w = max(round(pad * scale, 1), 1)
    else:
        border_style = 1
        outline_c = _ass_color(style["outline_color"])
        border_w = outline

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{style['font']},{fs},{primary},{primary},{outline_c},&H64000000,1,0,0,0,100,100,0,0,{border_style},{border_w},0,{align},60,60,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    t_pos = style.get("translation_position", "below")

    def styled_translation(text: str) -> str:
        text = text.strip()
        if not text:
            return ""
        t_txt = _escape(text.upper() if upper else text)
        return f"{{\\fs{t_fs}\\c{t_color}\\b0}}{t_txt}"

    def compose(main: str, trans: str) -> str:
        if not trans:
            return main
        return f"{trans}\\N{main}" if t_pos == "above" else f"{main}\\N{trans}"

    events: list[str] = []
    for seg in project["segments"]:
        blocks = blocks_for(seg.get("words", []), style)
        if not blocks:
            txt = _escape(seg["text"].upper() if upper else seg["text"])
            trans = styled_translation(seg.get("translation", ""))
            events.append(_dialogue(seg["start"], seg["end"], compose(txt, trans)))
            continue

        counts = [sum(len(line) for line in lines) for lines in blocks]
        parts = split_translation(seg.get("translation", ""), counts)
        for bi, lines in enumerate(blocks):
            flat = [w for line in lines for w in line]
            trans = styled_translation(parts[bi])
            block_start = flat[0]["start"]
            block_end = flat[-1]["end"]
            if not hl_on:
                main = _render_block(lines, -1, primary, highlight, upper)
                events.append(_dialogue(block_start, block_end, compose(main, trans)))
                continue
            for gi, word in enumerate(flat):
                start = word["start"]
                end = flat[gi + 1]["start"] if gi + 1 < len(flat) else block_end
                if end <= start:
                    end = start + 0.05
                main = _render_block(lines, gi, primary, highlight, upper)
                events.append(_dialogue(start, end, compose(main, trans)))

    return header + "\n".join(events) + "\n"


def _render_block(lines, active_gi, primary, highlight, upper) -> str:
    """Render a block (lines joined by \\N); word at global index active_gi is
    coloured with `highlight` (active_gi < 0 = no highlight)."""
    out_lines = []
    gi = 0
    for line in lines:
        parts = []
        for word in line:
            txt = _escape(word["text"].upper() if upper else word["text"])
            color = highlight if gi == active_gi else primary
            parts.append(f"{{\\c{color}}}{txt}")
            gi += 1
        out_lines.append(" ".join(parts))
    return "\\N".join(out_lines)


def _dialogue(start: float, end: float, text: str) -> str:
    return (f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},Default,,"
            f"0,0,0,,{text}")
