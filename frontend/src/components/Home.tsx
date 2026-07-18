import { useEffect, useState } from "react";
import { api } from "../api";
import { formatTime } from "../time";
import type { ProjectSummary } from "../types";
import { Uploader } from "./Uploader";

const STATUS_LABEL: Record<ProjectSummary["status"], string> = {
  created: "En attente",
  processing: "Analyse…",
  ready: "Prêt",
  error: "Erreur",
};

const fmtDuration = (s: number): string => (s ? formatTime(s) : "");

export function Home({
  onNew,
  onOpen,
}: {
  onNew: (id: string) => void;
  onOpen: (summary: ProjectSummary) => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);

  async function refresh() {
    try {
      setProjects(await api.listProjects());
    } catch {
      setProjects([]);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function rename(p: ProjectSummary) {
    const name = window.prompt("Nouveau nom du projet ?", p.name)?.trim();
    if (!name || name === p.name) return;
    await api.renameProject(p.id, name).catch(() => {});
    refresh();
  }

  async function remove(p: ProjectSummary) {
    if (!window.confirm(`Supprimer le projet « ${p.name} » ? Cette action est définitive.`))
      return;
    await api.deleteProject(p.id).catch(() => {});
    refresh();
  }

  return (
    <div className="home">
      <section className="home-projects">
        <h2>Mes projets</h2>
        {projects === null ? (
          <p className="muted">Chargement…</p>
        ) : projects.length === 0 ? (
          <p className="muted">Aucun projet pour l’instant — importez une vidéo ci-dessous.</p>
        ) : (
          <ul className="project-grid">
            {projects.map((p) => (
              <li key={p.id} className={`project-card status-${p.status}`}>
                <button
                  className="project-open"
                  onClick={() => onOpen(p)}
                  title="Ouvrir le projet"
                >
                  <span className="project-name">{p.name}</span>
                  <span className="project-meta">
                    <span className={`badge badge-${p.status}`}>{STATUS_LABEL[p.status]}</span>
                    {fmtDuration(p.duration) && (
                      <span className="project-dur">{fmtDuration(p.duration)}</span>
                    )}
                  </span>
                </button>
                <div className="project-actions">
                  <button className="link" onClick={() => rename(p)} title="Renommer">
                    ✏️
                  </button>
                  <button className="link danger" onClick={() => remove(p)} title="Supprimer">
                    🗑
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="home-new">
        <h2>Nouveau projet</h2>
        <Uploader onCreated={onNew} />
      </section>
    </div>
  );
}
