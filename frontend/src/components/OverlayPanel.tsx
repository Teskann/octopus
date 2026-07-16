import { useRef } from "react";
import { api } from "../api";
import type { Clip, ImageOverlay, Overlay, TextOverlay } from "../types";

function uid(): string {
  return "ov" + Math.floor(performance.now() * 1000).toString(36);
}

// Same families offered for captions (StylePanel): bundled TikTok fonts + a few
// system families that fontconfig/the browser resolve.
const BUNDLED_FONTS = ["Anton", "Bebas Neue", "Oswald", "Montserrat"];
const SYSTEM_FONTS = ["DejaVu Sans", "Lato", "Open Sans", "Ubuntu", "Impact", "Liberation Sans"];

export function OverlayPanel({
  projectId,
  overlays,
  t,
  duration,
  selectedClip,
  selectedId,
  onSelect,
  onChange,
}: {
  projectId: string;
  overlays: Overlay[];
  t: number;
  duration: number;
  selectedClip: Clip | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (overlays: Overlay[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  function update(id: string, patch: Partial<Overlay>) {
    onChange(overlays.map((o) => (o.id === id ? ({ ...o, ...patch } as Overlay) : o)));
  }
  function remove(id: string) {
    onChange(overlays.filter((o) => o.id !== id));
    if (selectedId === id) onSelect(null);
  }
  const endFor = () => Math.min(t + 4, duration || t + 4);

  function addText() {
    const ov: TextOverlay = {
      id: uid(), type: "text", start: t, end: endFor(),
      x: 0.3, y: 0.35, text: "Texte", font_size: 64, color: "#FFFFFF", font: "Anton",
      shadow: true,
      box_enabled: false, box_color: "#000000", box_opacity: 0.55, box_radius: 12, box_padding: 12,
    };
    onChange([...overlays, ov]);
    onSelect(ov.id);
  }

  async function addImage(file: File) {
    const { name, url } = await api.uploadAsset(projectId, file);
    const ov: ImageOverlay = {
      id: uid(), type: "image", start: t, end: endFor(),
      x: 0.35, y: 0.3, asset: name, url, scale: 0.3,
    };
    onChange([...overlays, ov]);
    onSelect(ov.id);
  }

  return (
    <div className="overlay-panel">
      <h3>Incrustations</h3>
      <div className="ov-add">
        <button className="btn sm" onClick={addText}>+ Texte</button>
        <button className="btn sm" onClick={() => fileRef.current?.click()}>+ Image</button>
        <input
          ref={fileRef} type="file" accept="image/*" hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) addImage(f);
            e.target.value = "";
          }}
        />
      </div>

      {overlays.length === 0 && <p className="muted small">Aucune incrustation.</p>}

      <div className="ov-list">
        {overlays.map((o) => (
          <div
            key={o.id}
            className={`ov-item ${o.id === selectedId ? "selected" : ""}`}
            onClick={() => onSelect(o.id)}
          >
            <div className="ov-item-head">
              <strong>{o.type === "text" ? "Texte" : "Image"}</strong>
              <button className="link danger" onClick={(e) => { e.stopPropagation(); remove(o.id); }}>
                Supprimer
              </button>
            </div>

            {o.type === "text" ? (
              <>
                <input value={o.text} onChange={(e) => update(o.id, { text: e.target.value })} />
                <label className="ov-full">Police
                  <select value={o.font} onChange={(e) => update(o.id, { font: e.target.value })}>
                    <optgroup label="Incluses">
                      {BUNDLED_FONTS.map((f) => (
                        <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>{f}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Système">
                      {SYSTEM_FONTS.map((f) => (
                        <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>{f}</option>
                      ))}
                    </optgroup>
                  </select>
                </label>
                <div className="ov-row">
                  <label>Taille : {o.font_size}px
                    <input type="range" min={16} max={200} value={o.font_size}
                      onChange={(e) => update(o.id, { font_size: Number(e.target.value) })} />
                  </label>
                  <input type="color" value={o.color}
                    onChange={(e) => update(o.id, { color: e.target.value })} />
                </div>

                <label className="ov-check">
                  <input type="checkbox" checked={o.shadow !== false}
                    onChange={(e) => update(o.id, { shadow: e.target.checked })} />
                  Ombre du texte
                </label>
                <label className="ov-check">
                  <input type="checkbox" checked={o.box_enabled}
                    onChange={(e) => update(o.id, { box_enabled: e.target.checked })} />
                  Fond derrière le texte
                </label>
                {o.box_enabled && (
                  <>
                    <div className="ov-row">
                      <label>Couleur
                        <input type="color" value={o.box_color}
                          onChange={(e) => update(o.id, { box_color: e.target.value })} />
                      </label>
                      <label>Opacité : {Math.round(o.box_opacity * 100)}%
                        <input type="range" min={0} max={1} step={0.05} value={o.box_opacity}
                          onChange={(e) => update(o.id, { box_opacity: Number(e.target.value) })} />
                      </label>
                    </div>
                    <div className="ov-row">
                      <label>Coins : {o.box_radius}px
                        <input type="range" min={0} max={60} value={o.box_radius}
                          onChange={(e) => update(o.id, { box_radius: Number(e.target.value) })} />
                      </label>
                      <label>Marge : {o.box_padding}px
                        <input type="range" min={0} max={60} value={o.box_padding}
                          onChange={(e) => update(o.id, { box_padding: Number(e.target.value) })} />
                      </label>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="ov-row">
                <label>Taille : {Math.round(o.scale * 100)}%
                  <input type="range" min={0.05} max={1.5} step={0.01} value={o.scale}
                    onChange={(e) => update(o.id, { scale: Number(e.target.value) })} />
                </label>
              </div>
            )}

            <div className="ov-row times">
              <label>Début
                <input type="number" step={0.1} value={round(o.start)}
                  onChange={(e) => update(o.id, { start: Number(e.target.value) })} />
              </label>
              <label>Fin
                <input type="number" step={0.1} value={round(o.end)}
                  onChange={(e) => update(o.id, { end: Number(e.target.value) })} />
              </label>
            </div>
            <div className="ov-row">
              <button className="link" onClick={(e) => { e.stopPropagation(); update(o.id, { start: t }); }}>
                ⏱ début ici
              </button>
              <button className="link" onClick={(e) => { e.stopPropagation(); update(o.id, { start: 0, end: duration }); }}>
                ⛶ toute la vidéo
              </button>
              {selectedClip && (
                <button className="link" onClick={(e) => { e.stopPropagation(); update(o.id, { start: selectedClip.start, end: selectedClip.end }); }}>
                  ▭ tout le clip
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}
