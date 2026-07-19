import { useState } from "react";
import { Home } from "./components/Home";
import { ProcessingView } from "./components/ProcessingView";
import { Editor } from "./components/Editor";
import { api } from "./api";
import type { Project, ProjectSummary } from "./types";

type View =
  | { name: "home" }
  | { name: "processing"; id: string }
  | { name: "editor"; project: Project };

export function App() {
  const [view, setView] = useState<View>({ name: "home" });

  async function openProject(p: ProjectSummary) {
    if (p.status === "ready") {
      try {
        const project = await api.getProject(p.id);
        setView({ name: "editor", project });
        return;
      } catch {
        /* fall through to processing view */
      }
    }
    setView({ name: "processing", id: p.id });
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">🎬 Éditeur — sous-titres locaux</span>
        {view.name !== "home" && (
          <button className="link" onClick={() => setView({ name: "home" })}>
            ← Mes projets
          </button>
        )}
      </header>

      {view.name === "home" && (
        <Home
          onNew={(id) => setView({ name: "processing", id })}
          onOpen={openProject}
        />
      )}

      {view.name === "processing" && (
        <ProcessingView
          id={view.id}
          onReady={(project) => setView({ name: "editor", project })}
        />
      )}

      {view.name === "editor" && (
        <Editor
          initial={view.project}
          onReprocess={(id) => setView({ name: "processing", id })}
        />
      )}
    </div>
  );
}
