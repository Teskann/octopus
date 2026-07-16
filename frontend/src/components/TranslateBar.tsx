import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Project } from "../types";

const TARGETS = [
  ["en", "Anglais"],
  ["fr", "Français"],
  ["es", "Espagnol"],
  ["de", "Allemand"],
  ["it", "Italien"],
  ["pt", "Portugais"],
  ["nl", "Néerlandais"],
];

export function TranslateBar({
  project,
  onUpdate,
}: {
  project: Project;
  onUpdate: (p: Project) => void;
}) {
  const [target, setTarget] = useState(project.translate_to || "en");
  const polling = useRef(false);

  const running = project.translate_status === "running";

  // Poll for translation progress while a run is in flight.
  useEffect(() => {
    if (!running || polling.current) return;
    polling.current = true;
    let stop = false;
    const tick = async () => {
      try {
        const p = await api.getProject(project.id);
        if (stop) return;
        onUpdate(p);
        if (p.translate_status === "running") {
          setTimeout(tick, 1000);
          return;
        }
      } catch {
        /* transient */
        if (!stop) setTimeout(tick, 1000);
        return;
      }
      polling.current = false;
    };
    tick();
    return () => {
      stop = true;
      polling.current = false;
    };
  }, [running, project.id, onUpdate]);

  async function translate() {
    await api.startTranslate(project.id, target);
    onUpdate({ ...project, translate_status: "running", translate_progress: 0 });
  }

  return (
    <div className="toolbar">
      <span className="tool-label">Traduction</span>
      <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={running}>
        {TARGETS.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
      <button className="btn" onClick={translate} disabled={running}>
        {running
          ? `Traduction… ${Math.round(project.translate_progress * 100)}%`
          : "Traduire les sous-titres"}
      </button>
      {project.translate_status === "done" && <span className="ok">✓ traduit</span>}
      {project.translate_status === "error" && <span className="error">échec</span>}
    </div>
  );
}
