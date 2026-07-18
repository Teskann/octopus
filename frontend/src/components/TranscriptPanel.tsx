import { useEffect, useState } from "react";
import { api } from "../api";
import { isWordActive } from "../captions";
import { activeSceneId } from "../scenes";
import type { Scene, SceneCut, Segment } from "../types";

export function TranscriptPanel({
  projectId,
  segments,
  t,
  onSeek,
  reload,
  pendingClipStartId,
  onStartClip,
  onEndClip,
  scenes,
  cuts,
  onSceneCut,
}: {
  projectId: string;
  segments: Segment[];
  t: number;
  onSeek: (to: number) => void;
  reload: () => Promise<void>;
  pendingClipStartId: string | null;
  onStartClip: (seg: Segment) => void;
  onEndClip: (seg: Segment) => void;
  scenes: Scene[];
  cuts: SceneCut[];
  onSceneCut: (seg: Segment, sceneId: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftTrans, setDraftTrans] = useState("");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; seg: Segment } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  function startEdit(seg: Segment) {
    setEditingId(seg.id);
    setDraftText(seg.text);
    setDraftTrans(seg.translation);
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function save(seg: Segment) {
    await run(() =>
      api.patchSegment(projectId, seg.id, { text: draftText, translation: draftTrans })
    );
    setEditingId(null);
  }

  // Split at the word boundary nearest the playhead (else the middle).
  function splitIndex(seg: Segment): number {
    if (seg.words.length < 2) return 0;
    if (t > seg.start && t < seg.end) {
      const idx = seg.words.filter((w) => w.start <= t).length;
      return Math.min(Math.max(idx, 1), seg.words.length - 1);
    }
    return Math.floor(seg.words.length / 2);
  }

  return (
    <div className="transcript">
      <h3>Transcription</h3>
      <p className="muted small">Cliquez sur un segment pour le corriger.</p>
      <p className="muted small">Clic droit : démarrer / terminer un clip.</p>
      <div className="segments">
        {segments.map((s, i) => {
          const active = t >= s.start && t < s.end;
          const editing = editingId === s.id;
          const isStart = s.id === pendingClipStartId;
          return (
            <div
              key={s.id}
              className={`seg ${active ? "active" : ""} ${editing ? "editing" : ""} ${isStart ? "clip-start" : ""}`}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, seg: s });
              }}
            >
              <span className="ts" onClick={() => onSeek(s.start)}>
                {s.start.toFixed(1)}s
              </span>

              {editing ? (
                <div className="seg-edit">
                  <textarea
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    rows={2}
                    autoFocus
                  />
                  <input
                    className="trans-input"
                    placeholder="Traduction"
                    value={draftTrans}
                    onChange={(e) => setDraftTrans(e.target.value)}
                  />
                  <div className="seg-actions">
                    <button className="btn sm" disabled={busy} onClick={() => save(s)}>
                      Enregistrer
                    </button>
                    <button className="link" onClick={() => setEditingId(null)}>
                      Annuler
                    </button>
                    <button
                      className="link"
                      disabled={busy || s.words.length < 2}
                      onClick={() => run(() => api.splitSegment(projectId, s.id, splitIndex(s)))}
                    >
                      ✂ Diviser
                    </button>
                    <button
                      className="link"
                      disabled={busy || i === segments.length - 1}
                      onClick={() => run(() => api.mergeSegment(projectId, s.id))}
                    >
                      ⤵ Fusionner
                    </button>
                    <button
                      className="link danger"
                      disabled={busy}
                      onClick={() => run(() => api.deleteSegment(projectId, s.id))}
                    >
                      🗑 Supprimer
                    </button>
                  </div>
                </div>
              ) : (
                <span className="seg-text" onClick={() => startEdit(s)}>
                  {s.words.length > 0
                    ? s.words.map((w, j) => (
                        <span key={j} className={active && isWordActive(w, t) ? "word on" : "word"}>
                          {w.text}{" "}
                        </span>
                      ))
                    : s.text}
                  {s.translation && <span className="seg-trans"> — {s.translation}</span>}
                </span>
              )}
              {!editing && scenes.length > 1 && (
                <div className="seg-scenes" title="Scène affichée à partir d'ici">
                  {scenes.map((sc) => {
                    const on = activeSceneId(cuts, s.start) === sc.id;
                    return (
                      <button
                        key={sc.id}
                        className={`scene-dot ${on ? "on" : ""}`}
                        style={{ backgroundColor: on ? sc.color : "transparent", borderColor: sc.color }}
                        title={sc.name}
                        onClick={(e) => { e.stopPropagation(); onSceneCut(s, sc.id); }}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {menu && (
        <div className="tl-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { onStartClip(menu.seg); setMenu(null); }}>
            ▶ Démarrer un clip ici
          </button>
          {pendingClipStartId && (
            <button onClick={() => { onEndClip(menu.seg); setMenu(null); }}>
              ⏹ Terminer le clip ici
            </button>
          )}
          {scenes.length > 1 && (
            <>
              <div className="menu-sep" />
              {scenes.filter((s) => !s.is_main).map((sc) => (
                <button key={sc.id} onClick={() => { onSceneCut(menu.seg, sc.id); setMenu(null); }}>
                  🎥 Montrer « {sc.name} » ici
                </button>
              ))}
              <button onClick={() => { onSceneCut(menu.seg, "main"); setMenu(null); }}>
                🎬 Revenir à la principale
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
