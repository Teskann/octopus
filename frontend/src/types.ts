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
  translation_enabled: boolean;
  translation_scale: number;
  translation_color: string;
  translation_position: "below" | "above";
  max_line_width_pct: number;
  max_lines: number;
}

export interface OverlayBase {
  id: string;
  start: number;
  end: number;
  x: number; // normalized 0..1, top-left anchor
  y: number;
}
export interface TextOverlay extends OverlayBase {
  type: "text";
  text: string;
  font_size: number; // px against 1080-wide reference
  color: string;
  font: string;
  shadow: boolean;
  box_enabled: boolean;
  box_color: string;
  box_opacity: number;
  box_radius: number; // px @1080
  box_padding: number; // px @1080 (vertical; horizontal is 1.6x)
}
export interface ImageOverlay extends OverlayBase {
  type: "image";
  asset: string;
  url: string;
  scale: number; // width as a fraction of video width
}
export type Overlay = TextOverlay | ImageOverlay;

export type Aspect = "original" | "9:16" | "1:1" | "4:5" | "16:9" | "free";

/** Project-level output framing, shared by all clips. (x,y,w,h) is a normalized
 *  crop window of the source video that becomes the output frame. */
export type FitMode = "crop" | "fit";

export interface Frame {
  aspect: Aspect;
  mode: FitMode; // crop = fill/cover, fit = contain + blur behind
  x: number;
  y: number;
  w: number;
  h: number;
  blur_bg: boolean;
}

export interface Scene {
  id: string;
  name: string;
  filename: string;
  is_main: boolean;
  width: number;
  height: number;
  mode: FitMode;
  color: string;
  crop: { x: number; y: number; w: number; h: number };
}

export interface SceneCut {
  id: string;
  time: number;
  scene_id: string;
}

export interface Clip {
  id: string;
  name: string;
  start: number;
  end: number;
}

export interface RenderJob {
  id: string;
  clip_id: string;
  clip_name: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  progress: number;
  message: string;
  error: string | null;
  filename: string;
  created_at: string;
  download: string | null;
}

export type ProjectStatus = "created" | "processing" | "ready" | "error";

/** Lightweight row returned by GET /api/projects (the project list). */
export interface ProjectSummary {
  id: string;
  name: string;
  status: ProjectStatus;
  duration: number;
  created_at: string;
}

/** A saved caption-style preset (user-created, persisted on the backend). */
export interface Preset {
  id: string;
  name: string;
  style: Style;
}

export interface ContextPreset {
  id: string;
  name: string;
  prompt: string;
}

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
  whisper_prompt: string;
  translate_to: string | null;
  translate_status: "idle" | "running" | "done" | "error";
  translate_progress: number;
  segments: Segment[];
  style: Style;
  frame: Frame;
  scenes: Scene[];
  scene_cuts: SceneCut[];
  overlays: Overlay[];
  clips: Clip[];
}
