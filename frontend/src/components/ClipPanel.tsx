import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { formatTime as fmt } from "../time";
import type { Clip, RenderJob } from "../types";

const round = (v: number) => Math.round(v * 10) / 10;

export function ClipPanel({
  projectId,
  clips,
  selectedId,
  onSelect,
  onChange,
  onPreview,
  flush,
}: {
  projectId: string;
  clips: Clip[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (clips: Clip[]) => void;
  onPreview: (clip: Clip) => void;
  flush: () => Promise<void>;
}) {
  const clip = clips.find((c) => c.id === selectedId) || null;
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number>();

  // Poll render jobs while any is in flight (they live in server memory).
  useEffect(() => {
    const anyActive = jobs.some((j) => j.status === "queued" || j.status === "running");
    if (!anyActive) return;
    pollRef.current = window.setInterval(async () => {
      try {
        setJobs(await api.listRenders(projectId));
      } catch {
        /* ignore */
      }
    }, 700);
    return () => window.clearInterval(pollRef.current);
  }, [jobs, projectId]);

  async function cancel(jobId: string) {
    try {
      await api.cancelRender(projectId, jobId);
      setJobs(await api.listRenders(projectId));
    } catch {
      /* ignore */
    }
  }

  async function exportClips(ids: string[]) {
    if (busy) return;
    setBusy(true);
    try {
      // The render reads the saved project.json, but edits are debounced — flush
      // everything (clips, style, frame, overlays, scenes) first.
      await flush();
      setJobs(await api.startRenders(projectId, ids));
    } catch (e) {
      alert(`Échec de l'export : ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

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

      {clips.length > 0 && (
        <button className="btn" disabled={busy} onClick={() => exportClips(clips.map((c) => c.id))}>
          ⬇ Exporter tous les clips
        </button>
      )}

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
            <button className="btn sm" disabled={busy} onClick={() => exportClips([clip.id])}>⬇ Exporter</button>
            <button className="link danger" onClick={() => remove(clip.id)}>Supprimer</button>
          </div>
        </div>
      )}

      {jobs.length > 0 && (
        <div className="render-jobs">
          <h4>Exports</h4>
          {jobs.map((j) => (
            <div key={j.id} className={`render-job ${j.status}`}>
              <span className="render-job-name">{j.clip_name}</span>
              {j.status === "done" && j.download ? (
                <a className="render-tag done" href={j.download} download>
                  Télécharger
                </a>
              ) : j.status === "error" ? (
                <span className="render-tag error" title={j.error || ""}>Échec</span>
              ) : j.status === "cancelled" ? (
                <span className="render-tag cancelled">Annulé</span>
              ) : (
                <>
                  <span className="render-bar">
                    <span className="render-bar-fill" style={{ width: `${Math.round(j.progress * 100)}%` }} />
                  </span>
                  <button className="link danger render-stop" onClick={() => cancel(j.id)} title="Arrêter le rendu">
                    ✕
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
