import type { Style } from "./types";

/** Built-in, read-only caption looks. Applying one merges these fields over the
 *  current style (see StylePanel). Each preset is a COMPLETE subtitle look —
 *  every subtitle setting (margin, position, translation, box…) — so applying it
 *  gives a predictable result rather than inheriting stray values. User-saved
 *  presets (api.listPresets) likewise store the full style. */
export interface BuiltinPreset {
  name: string;
  style: Partial<Style>;
}

// Fields shared by every look, so each preset fully specifies the subtitles.
const COMMON: Partial<Style> = {
  max_line_width_pct: 80,
  max_lines: 2,
  translation_enabled: true,
  translation_scale: 0.5,
  translation_color: "#B7C7FF",
  translation_position: "below",
};

export const BUILTIN_PRESETS: BuiltinPreset[] = [
  {
    name: "TikTok classique",
    style: {
      ...COMMON,
      font: "Montserrat",
      font_size: 56,
      primary_color: "#FFFFFF",
      highlight_color: "#FFE100",
      highlight_enabled: true,
      outline_color: "#000000",
      outline_width: 6,
      box_enabled: false,
      box_color: "#000000",
      box_opacity: 0.55,
      box_radius: 14,
      box_padding_x: 26,
      box_padding_y: 10,
      position: "bottom",
      margin_v: 220,
      uppercase: true,
    },
  },
  {
    name: "Bold Anton",
    style: {
      ...COMMON,
      font: "Anton",
      font_size: 72,
      primary_color: "#FFFFFF",
      highlight_color: "#00E5FF",
      highlight_enabled: true,
      outline_color: "#000000",
      outline_width: 8,
      box_enabled: false,
      box_color: "#000000",
      box_opacity: 0.55,
      box_radius: 14,
      box_padding_x: 26,
      box_padding_y: 10,
      position: "bottom",
      margin_v: 260,
      uppercase: true,
    },
  },
  {
    name: "Boîte nette",
    style: {
      ...COMMON,
      font: "Oswald",
      font_size: 52,
      primary_color: "#FFFFFF",
      highlight_color: "#FFD166",
      highlight_enabled: true,
      outline_color: "#000000",
      outline_width: 0,
      box_enabled: true,
      box_color: "#000000",
      box_opacity: 0.7,
      box_radius: 12,
      box_padding_x: 28,
      box_padding_y: 12,
      position: "bottom",
      margin_v: 200,
      uppercase: false,
    },
  },
  {
    name: "Minimal doux",
    style: {
      ...COMMON,
      font: "Lexend Deca",
      font_size: 48,
      primary_color: "#FFFFFF",
      highlight_color: "#FFFFFF",
      highlight_enabled: false,
      outline_color: "#000000",
      outline_width: 4,
      box_enabled: false,
      box_color: "#000000",
      box_opacity: 0.55,
      box_radius: 14,
      box_padding_x: 26,
      box_padding_y: 10,
      position: "bottom",
      margin_v: 180,
      uppercase: false,
    },
  },
];
