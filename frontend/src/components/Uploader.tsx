import { useRef, useState } from "react";
import { api } from "../api";

const LANGS = [
  ["", "Détection auto"],
  ["fr", "Français"],
  ["en", "Anglais"],
  ["de", "Allemand"],
  ["es", "Espagnol"],
  ["it", "Italien"],
  ["pt", "Portugais"],
  ["nl", "Néerlandais"],
];

export function Uploader({ onCreated }: { onCreated: (id: string) => void }) {
  const [dragOver, setDragOver] = useState(false);
  const [language, setLanguage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit(file: File) {
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.createProject(file, language);
      onCreated(id);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  return (
    <div className="centered">
      <div
        className={`dropzone ${dragOver ? "over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) submit(file);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) submit(file);
          }}
        />
        {busy ? (
          <p>Téléversement…</p>
        ) : (
          <>
            <p className="big">Glissez-déposez une vidéo ici</p>
            <p className="muted">ou cliquez pour choisir un fichier</p>
          </>
        )}
      </div>

      <label className="field">
        Langue parlée&nbsp;
        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          {LANGS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="error">{error}</p>}
    </div>
  );
}
