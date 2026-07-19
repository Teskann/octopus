import { useEffect, useState } from "react";
import { api } from "../api";
import type { ContextPreset } from "../types";

/** Context/prompt given to whisper for (re)transcription — steers the spelling of
 *  names, jargon and acronyms. Value is owned by the Editor (debounce-saved with
 *  the rest); this panel also lets the user save/load named context presets,
 *  mirroring StylePanel's presets. Everything here is also reachable via MCP. */
export function ContextPanel({
  prompt,
  onChange,
}: {
  prompt: string;
  onChange: (value: string) => void;
}) {
  const [presets, setPresets] = useState<ContextPreset[]>([]);
  useEffect(() => {
    api.listContextPresets().then(setPresets).catch(() => {});
  }, []);

  async function saveCurrentAsPreset() {
    const name = window.prompt("Nom du préréglage de contexte ?")?.trim();
    if (!name) return;
    try {
      const preset = await api.saveContextPreset(name, prompt);
      setPresets((ps) => [...ps, preset]);
    } catch {
      /* ignore */
    }
  }

  async function removePreset(id: string) {
    try {
      await api.deleteContextPreset(id);
      setPresets((ps) => ps.filter((p) => p.id !== id));
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="context-panel">
      <label className="row col">
        Contexte (noms propres, jargon, acronymes…)
        <textarea
          className="context-input"
          rows={3}
          value={prompt}
          placeholder="Ex. : Vidéo sur le RGPD. Intervenants : Aurélie Nkemba, Jean-Loup Dié…"
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      <div className="presets">
        {presets.map((p) => (
          <span key={p.id} className="preset-chip user">
            <button
              type="button"
              className="preset-apply"
              title={`Charger « ${p.name} »`}
              onClick={() => onChange(p.prompt)}
            >
              {p.name}
            </button>
            <button
              type="button"
              className="preset-del"
              title="Supprimer ce préréglage"
              onClick={() => removePreset(p.id)}
            >
              ×
            </button>
          </span>
        ))}
        <button
          type="button"
          className="preset-save"
          onClick={saveCurrentAsPreset}
          disabled={!prompt.trim()}
        >
          + Enregistrer le contexte actuel
        </button>
      </div>
    </div>
  );
}
