"""Built-in caption-style presets, mirrored from frontend/src/presets.ts.

The frontend ships these looks for the human; the same data is exposed here at
GET /api/presets/builtin so an agent (via the MCP server) can "apply a preset" by
name and get exactly the same result. Each preset is a COMPLETE style — every
subtitle setting — so applying it is deterministic. Keep in sync with presets.ts.
"""
from __future__ import annotations

# Fields shared by every look, so each preset fully specifies the subtitles.
_COMMON = {
    "max_line_width_pct": 80,
    "max_lines": 2,
    "translation_enabled": True,
    "translation_scale": 0.5,
    "translation_color": "#B7C7FF",
    "translation_position": "below",
}

BUILTIN_PRESETS: list[dict] = [
    {"name": "TikTok classique", "style": {
        **_COMMON, "font": "Montserrat", "font_size": 56,
        "primary_color": "#FFFFFF", "highlight_color": "#FFE100",
        "highlight_enabled": True, "outline_color": "#000000", "outline_width": 6,
        "box_enabled": False, "box_color": "#000000", "box_opacity": 0.55,
        "box_radius": 14, "box_padding_x": 26, "box_padding_y": 10,
        "position": "bottom", "margin_v": 220, "uppercase": True,
    }},
    {"name": "Bold Anton", "style": {
        **_COMMON, "font": "Anton", "font_size": 72,
        "primary_color": "#FFFFFF", "highlight_color": "#00E5FF",
        "highlight_enabled": True, "outline_color": "#000000", "outline_width": 8,
        "box_enabled": False, "box_color": "#000000", "box_opacity": 0.55,
        "box_radius": 14, "box_padding_x": 26, "box_padding_y": 10,
        "position": "bottom", "margin_v": 260, "uppercase": True,
    }},
    {"name": "Boîte nette", "style": {
        **_COMMON, "font": "Oswald", "font_size": 52,
        "primary_color": "#FFFFFF", "highlight_color": "#FFD166",
        "highlight_enabled": True, "outline_color": "#000000", "outline_width": 0,
        "box_enabled": True, "box_color": "#000000", "box_opacity": 0.7,
        "box_radius": 12, "box_padding_x": 28, "box_padding_y": 12,
        "position": "bottom", "margin_v": 200, "uppercase": False,
    }},
    {"name": "Minimal doux", "style": {
        **_COMMON, "font": "Lexend Deca", "font_size": 48,
        "primary_color": "#FFFFFF", "highlight_color": "#FFFFFF",
        "highlight_enabled": False, "outline_color": "#000000", "outline_width": 4,
        "box_enabled": False, "box_color": "#000000", "box_opacity": 0.55,
        "box_radius": 14, "box_padding_x": 26, "box_padding_y": 10,
        "position": "bottom", "margin_v": 180, "uppercase": False,
    }},
]
