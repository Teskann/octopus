import type { SceneCut } from "./types";

/** The scene showing at time t: the last cut at or before t, else the main. */
export function activeSceneId(cuts: SceneCut[], t: number): string {
  let id = "main";
  let best = -Infinity;
  for (const c of cuts) {
    if (c.time <= t && c.time > best) {
      best = c.time;
      id = c.scene_id;
    }
  }
  return id;
}
