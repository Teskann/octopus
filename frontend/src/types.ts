export interface Word {
  start: number;
  end: number;
  text: string;
}

export interface Segment {
  id: string;
  start: number;
  end: number;
  text: string;
  translation: string;
  words: Word[];
}

export interface Style {
  font: string;
  font_size: number;
  primary_color: string;
  highlight_color: string;
  highlight_enabled: boolean;
  outline_color: string;
  outline_width: number;
  box_enabled: boolean;
  box_color: string;
  box_opacity: number;
  box_radius: number;
  box_padding_x: number;
  box_padding_y: number;
  position: "top" | "middle" | "bottom";
  margin_v: number;
  uppercase: boolean;
  translation_scale: number;
  translation_color: string;
  translation_position: "below" | "above";
  max_line_width_pct: number;
  max_lines: number;
}

export type ProjectStatus = "created" | "processing" | "ready" | "error";

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
  progress: number;
  message: string;
  error: string | null;
  duration: number;
  width: number;
  height: number;
  fps: number;
  language: string;
  translate_to: string | null;
  translate_status: "idle" | "running" | "done" | "error";
  translate_progress: number;
  segments: Segment[];
  style: Style;
  overlays: unknown[];
  clips: unknown[];
}
