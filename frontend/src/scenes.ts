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

// Scene-switch crossfade timing (shared by export; preview can adopt it too).
// The fade *completes* TRANSITION_LEAD before the cut time, so the new scene is
// fully in slightly ahead of the word — anticipation without feeling detached.
export const TRANSITION_DUR = 0.35; // crossfade length, seconds
export const TRANSITION_LEAD = 0.1; // fade completes this long before the cut

export interface SceneLayer {
  sceneId: string;
  opacity: number;
  scale: number;
}

/** Drop cuts that don't actually change the active scene (incl. a revert that
 *  lands on the already-showing scene). This makes "switch to the current scene"
 *  a no-op — no flash, and never a transition from a scene to itself. */
export function cleanCuts(cuts: SceneCut[]): SceneCut[] {
  const sorted = [...cuts].sort((a, b) => a.time - b.time);
  const out: SceneCut[] = [];
  let active = "main";
  for (const c of sorted) {
    if (c.scene_id === active) continue;
    out.push(c);
    active = c.scene_id;
  }
  return out;
}

/** Visible scene layers at time t (bottom → top). Normally one opaque layer;
 *  during a crossfade the outgoing scene sits under the incoming one, which
 *  fades + zooms in (matching the preview's `.scene-overlay` punch). */
export function sceneLayersAt(
  cuts: SceneCut[],
  t: number,
  dur = TRANSITION_DUR,
  lead = TRANSITION_LEAD
): SceneLayer[] {
  const seg = cleanCuts(cuts);
  let base = "main";
  let bi = -1;
  for (let i = 0; i < seg.length; i++) {
    if (seg[i].time - lead <= t) {
      base = seg[i].scene_id;
      bi = i;
    } else break;
  }
  const next = seg[bi + 1];
  if (next) {
    const winStart = next.time - lead - dur;
    const winEnd = next.time - lead;
    if (t >= winStart && t < winEnd) {
      const p = Math.min(1, Math.max(0, (t - winStart) / dur));
      return [
        { sceneId: base, opacity: 1, scale: 1 },
        { sceneId: next.scene_id, opacity: p, scale: 1.08 - 0.08 * p },
      ];
    }
  }
  return [{ sceneId: base, opacity: 1, scale: 1 }];
}
