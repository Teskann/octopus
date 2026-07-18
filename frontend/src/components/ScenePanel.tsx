import { useRef, useState } from "react";
import { api } from "../api";
import { defaultFrameRect } from "../frame";
import { formatTime as fmt } from "../time";
import type { Aspect, Frame, Scene, SceneCut } from "../types";

const ASPECTS: { value: Aspect; label: string }[] = [
  { value: "original", label: "Original" },
  { value: "9:16", label: "9:16 — vertical (TikTok)" },
  { value: "1:1", label: "1:1 — carré" },
  { value: "4:5", label: "4:5 — portrait" },
  { value: "16:9", label: "16:9 — paysage" },
  { value: "free", label: "Libre (ratio déverrouillé)" },
];

export function ScenePanel({
  projectId,
  scenes,
  cuts,
  frame,
  sourceW,
  sourceH,
  selectedSceneId,
  onSelectScene,
  onReload,
  onScenesChange,
  onFrameChange,
  onCutsChange,
  onSeek,
}: {
  projectId: string;
  scenes: Scene[];
  cuts: SceneCut[];
  frame: Frame;
  sourceW: number;
  sourceH: number;
  selectedSceneId: string;
  onSelectScene: (id: string) => void;
  onReload: () => Promise<void>;
  onScenesChange: (scenes: Scene[]) => void;
  onFrameChange: (patch: Partial<Frame>) => void;
  onCutsChange: (cuts: SceneCut[]) => void;
  onSeek: (to: number) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);

  async function add(file: File) {
    setBusy(true);
    setUploadPct(0);
    try {
      await api.uploadScene(projectId, file, (f) => setUploadPct(Math.round(f * 100)));
      await onReload();
    } finally {
      setBusy(false);
      setUploadPct(null);
    }
  }
  async function del(id: string) {
    setBusy(true);
    try { await api.deleteScene(projectId, id); await onReload(); } finally { setBusy(false); }
  }
  function rename(id: string, name: string) {
    onScenesChange(scenes.map((s) => (s.id === id ? { ...s, name } : s)));
  }

  const selected = scenes.find((s) => s.id === selectedSceneId) || scenes[0];
  const selMode = selected?.is_main ? frame.mode : selected?.mode;

  function setSelMode(mode: "crop" | "fit") {
    if (!selected) return;
    if (selected.is_main) {
      onFrameChange({ mode, ...(mode === "fit" ? defaultFrameRect(frame.aspect, sourceW, sourceH) : {}) });
    } else {
      onScenesChange(scenes.map((s) => (s.id === selected.id ? { ...s, mode } : s)));
    }
  }

  const nameOf = (id: string) => scenes.find((s) => s.id === id)?.name ?? id;
  const sortedCuts = [...cuts].sort((a, b) => a.time - b.time);

  return (
    <div className="scene-panel">
      <h3>Cadrage</h3>
      <label className="ov-full">Format (tout le projet)
        <select
          value={frame.aspect}
          onChange={(e) => {
            const a = e.target.value as Aspect;
            onFrameChange({ aspect: a, ...defaultFrameRect(a, sourceW, sourceH) });
            // re-center every secondary scene's crop for the new aspect
            onScenesChange(scenes.map((s) => (s.is_main ? s : { ...s, crop: defaultFrameRect(a, s.width, s.height) })));
          }}
        >
          {ASPECTS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
      </label>

      <h3 style={{ marginTop: "0.8rem" }}>Scènes</h3>
      <p className="muted small">La principale porte le son. Les autres sont muettes et synchronisées.</p>
      <div className="scene-list">
        {scenes.map((s) => (
          <div
            key={s.id}
            className={`scene-item ${s.id === selected?.id ? "selected" : ""}`}
            onClick={() => onSelectScene(s.id)}
          >
            <span className="scene-swatch" style={{ background: s.color }} title={`Couleur de « ${s.name} »`} />
            <input
              className="scene-name-input"
              value={s.name}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => rename(s.id, e.target.value)}
              title="Renommer la scène"
            />
            {!s.is_main && (
              <button className="link danger" disabled={busy} onClick={(e) => { e.stopPropagation(); del(s.id); }}>
                Supprimer
              </button>
            )}
          </div>
        ))}
      </div>
      <button className="btn sm" disabled={busy} onClick={() => fileRef.current?.click()}>+ Ajouter une scène</button>
      {uploadPct !== null && (
        <div className="scene-upload">
          <div className="progress sm">
            <div className="bar" style={{ width: `${uploadPct}%` }} />
          </div>
          <span className="muted small">
            {uploadPct < 100 ? `Import… ${uploadPct}%` : "Analyse…"}
          </span>
        </div>
      )}
      <input ref={fileRef} type="file" accept="video/*" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) add(f); e.target.value = ""; }} />

      {selected && (
        <div className="scene-edit">
          <div className="mode-toggle">
            <button className={selMode === "crop" ? "on" : ""} onClick={() => setSelMode("crop")}>Recadrer</button>
            <button className={selMode === "fit" ? "on" : ""} onClick={() => setSelMode("fit")}>Ajuster (fond flou)</button>
          </div>
          {selected.is_main && frame.mode === "crop" && frame.aspect !== "original" && (
            <p className="muted small">
              Glissez le cadre sur la vidéo pour le déplacer, la poignée pour zoomer.
              <button className="link" onClick={() => onFrameChange(defaultFrameRect(frame.aspect, sourceW, sourceH))}>
                Réinitialiser
              </button>
            </p>
          )}
          {!selected.is_main && selected.mode === "crop" && frame.aspect !== "original" && (
            <p className="muted small">
              Glissez le cadre sur la vidéo pour le déplacer, la poignée pour zoomer — comme la scène principale.
            </p>
          )}
        </div>
      )}

      <h3 style={{ marginTop: "1rem" }}>Changements de scène</h3>
      <p className="muted small">Clic droit sur un sous-titre → « Montrer … ici ».</p>
      {sortedCuts.length === 0 && <p className="muted small">Aucun changement.</p>}
      <div className="cut-list">
        {sortedCuts.map((c) => (
          <div key={c.id} className="cut-item">
            <span className="link" onClick={() => onSeek(c.time)}>{fmt(c.time)}</span>
            <span>→ {nameOf(c.scene_id)}</span>
            <button className="link danger" onClick={() => onCutsChange(cuts.filter((x) => x.id !== c.id))}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}
