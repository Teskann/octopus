import { useEffect, useState } from "react";
import { api } from "../api";
import type { Project } from "../types";

export function ProcessingView({
  id,
  onReady,
}: {
  id: string;
  onReady: (project: Project) => void;
}) {
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const p = await api.getProject(id);
        if (stop) return;
        setProject(p);
        if (p.status === "ready") {
          onReady(p);
          return;
        }
        if (p.status === "error") return;
      } catch {
        /* keep polling; transient */
      }
      if (!stop) setTimeout(poll, 800);
    }
    poll();
    return () => {
      stop = true;
    };
  }, [id, onReady]);

  const pct = Math.round((project?.progress ?? 0) * 100);

  return (
    <div className="centered">
      <div className="processing">
        <h2>Analyse de la vidéo…</h2>
        <div className="progress">
          <div className="bar" style={{ width: `${pct}%` }} />
        </div>
        <p className="muted">{project?.message || "Démarrage…"}</p>
        {project?.status === "error" && (
          <p className="error">Échec : {project.error}</p>
        )}
      </div>
    </div>
  );
}
