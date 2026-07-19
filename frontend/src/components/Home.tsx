import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { formatTime } from "../time";
import type { ProjectSummary } from "../types";
import { Uploader } from "./Uploader";
import { useModal } from "./Modal";

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
  const modal = useModal();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const renameInput = useRef<HTMLInputElement>(null);

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

  function openRename(p: ProjectSummary) {
    setRenaming(p);
    setRenameValue(p.name);
  }

  useEffect(() => {
    if (renaming) renameInput.current?.select();
  }, [renaming]);

  async function submitRename() {
    if (!renaming) return;
    const name = renameValue.trim();
    if (!name || name === renaming.name) { setRenaming(null); return; }
    setRenameBusy(true);
    await api.renameProject(renaming.id, name).catch(() => {});
    setRenameBusy(false);
    setRenaming(null);
    refresh();
  }

  async function remove(p: ProjectSummary) {
    const ok = await modal.confirm({
      title: "Supprimer le projet",
      message: `Supprimer le projet « ${p.name} » ? Cette action est définitive.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    await api.deleteProject(p.id).catch(() => {});
    refresh();
  }

  return (
    <div className="home">
      <section className="home-new">
        <h2>Nouveau projet</h2>
        <Uploader onCreated={onNew} />
      </section>

      <section className="home-projects">
        <h2>Mes projets</h2>
        {projects === null ? (
          <p className="muted">Chargement…</p>
        ) : projects.length === 0 ? (
          <p className="muted">Aucun projet pour l’instant — importez une vidéo ci-dessus.</p>
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
                    {p.clip_count > 0 && (
                      <span className="project-clips">
                        ✂️ {p.clip_count} clip{p.clip_count > 1 ? "s" : ""}
                      </span>
                    )}
                  </span>
                </button>
                <div className="project-actions">
                  <button className="link" onClick={() => openRename(p)} title="Renommer">
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

      {renaming && (
        <div className="modal-backdrop" onClick={() => !renameBusy && setRenaming(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Renommer le projet</h3>
            <input
              ref={renameInput}
              className="modal-input"
              value={renameValue}
              autoFocus
              disabled={renameBusy}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename();
                else if (e.key === "Escape") setRenaming(null);
              }}
            />
            <div className="modal-actions">
              <button className="link" onClick={() => setRenaming(null)} disabled={renameBusy}>
                Annuler
              </button>
              <button className="btn sm" onClick={submitRename} disabled={renameBusy}>
                {renameBusy ? "…" : "Renommer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
