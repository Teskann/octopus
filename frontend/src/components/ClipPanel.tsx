import type { Clip } from "../types";

const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
const round = (v: number) => Math.round(v * 10) / 10;

export function ClipPanel({
  clips,
  selectedId,
  onSelect,
  onChange,
  onPreview,
}: {
  clips: Clip[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (clips: Clip[]) => void;
  onPreview: (clip: Clip) => void;
}) {
  const clip = clips.find((c) => c.id === selectedId) || null;

  function update(id: string, patch: Partial<Clip>) {
    onChange(clips.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function remove(id: string) {
    onChange(clips.filter((c) => c.id !== id));
    if (selectedId === id) onSelect(null);
  }

  return (
    <div className="clip-panel">
      <h3>Clips</h3>
      {clips.length === 0 && (
        <p className="muted small">
          Clic droit sur un sous-titre → « Démarrer un clip », puis plus loin → « Terminer le clip ».
        </p>
      )}

      <div className="clip-list">
        {clips.map((c) => (
          <div
            key={c.id}
            className={`clip-item ${c.id === selectedId ? "selected" : ""}`}
            onClick={() => onSelect(c.id)}
          >
            <span className="clip-name">{c.name}</span>
            <span className="muted">{fmt(c.start)}–{fmt(c.end)}</span>
          </div>
        ))}
      </div>

      {clip && (
        <div className="clip-edit">
          <input value={clip.name} onChange={(e) => update(clip.id, { name: e.target.value })} />
          <div className="ov-row times">
            <label>Début
              <input type="number" step={0.1} value={round(clip.start)}
                onChange={(e) => update(clip.id, { start: Number(e.target.value) })} />
            </label>
            <label>Fin
              <input type="number" step={0.1} value={round(clip.end)}
                onChange={(e) => update(clip.id, { end: Number(e.target.value) })} />
            </label>
          </div>
          <div className="clip-actions">
            <button className="btn sm" onClick={() => onPreview(clip)}>▶ Aperçu</button>
            <button className="link danger" onClick={() => remove(clip.id)}>Supprimer</button>
          </div>
        </div>
      )}
    </div>
  );
}
