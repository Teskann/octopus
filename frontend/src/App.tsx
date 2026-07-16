import { useState } from "react";
import { Uploader } from "./components/Uploader";
import { ProcessingView } from "./components/ProcessingView";
import { Editor } from "./components/Editor";
import type { Project } from "./types";

type View =
  | { name: "home" }
  | { name: "processing"; id: string }
  | { name: "editor"; project: Project };

export function App() {
  const [view, setView] = useState<View>({ name: "home" });

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">🎬 Éditeur — sous-titres locaux</span>
        {view.name !== "home" && (
          <button className="link" onClick={() => setView({ name: "home" })}>
            ← Nouveau projet
          </button>
        )}
      </header>

      {view.name === "home" && (
        <Uploader onCreated={(id) => setView({ name: "processing", id })} />
      )}

      {view.name === "processing" && (
        <ProcessingView
          id={view.id}
          onReady={(project) => setView({ name: "editor", project })}
        />
      )}

      {view.name === "editor" && <Editor initial={view.project} />}
    </div>
  );
}
