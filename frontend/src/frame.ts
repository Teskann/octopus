import type { Aspect, Project } from "./types";

/** Output resolution of a project = the crop window in source pixels, rounded to
 *  even dimensions (H.264 needs even w/h). This is the canvas the export renders
 *  into; the page reports it so the backend never has to recompute geometry. */
export function outputSize(project: Project): { w: number; h: number } {
  const mw = project.width || 1920;
  const mh = project.height || 1080;
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  return { w: even(project.frame.w * mw), h: even(project.frame.h * mh) };
}

const PRESET: Record<"9:16" | "1:1" | "4:5" | "16:9", number> = {
  "9:16": 9 / 16,
  "1:1": 1,
  "4:5": 4 / 5,
  "16:9": 16 / 9,
};

/** Output width/height pixel ratio for an aspect, given source pixel dims. */
export function outputRatio(aspect: Aspect, sourceW: number, sourceH: number): number {
  if (aspect === "original" || aspect === "free") return sourceW / sourceH || 16 / 9;
  return PRESET[aspect];
}

/** Largest centered crop window (normalized) of the source with the given
 *  output aspect ratio. original/free use the whole frame. */
export function defaultFrameRect(aspect: Aspect, sourceW: number, sourceH: number) {
  if (aspect === "original" || aspect === "free" || !sourceW || !sourceH) {
    return { x: 0, y: 0, w: 1, h: 1 };
  }
  const R = PRESET[aspect];
  // crop pixel ratio (w*sourceW)/(h*sourceH) must equal R  =>  w/h = R*sourceH/sourceW
  const k = (R * sourceH) / sourceW;
  let w: number, h: number;
  if (k <= 1) {
    w = k;
    h = 1;
  } else {
    w = 1;
    h = 1 / k;
  }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}
