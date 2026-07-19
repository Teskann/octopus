import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { api } from "../api";
import { isWordActive, segmentSeekStart } from "../captions";
import { activeSceneId, segCutTime } from "../scenes";
import { formatTime } from "../time";
import type { Scene, SceneCut, Segment } from "../types";

// One transcript line. Memoised so that during playback ONLY the line at the
// playhead re-renders (its `t`/`active` change); every other line keeps stable
// props and bails out of reconciliation. Without this the whole transcript —
// hundreds of segments × word spans for a long recording — re-rendered 60×/s,
// starving the video decoder and making the preview stutter (`conference_complet`).
type RowProps = {
  seg: Segment;
  isLast: boolean;
  active: boolean;
  editing: boolean;
  isStart: boolean;
  t: number; // live only for the active line, else 0 (so inactive props stay stable)
  draftText: string; // live only for the editing line, else ""
  draftTrans: string;
  busy: boolean;
  scenes: Scene[];
  cuts: SceneCut[];
  onSeek: (to: number) => void;
  onOpenMenu: (e: ReactMouseEvent, seg: Segment) => void;
  onStartEdit: (seg: Segment) => void;
  onCancelEdit: () => void;
  onDraftText: (v: string) => void;
  onDraftTrans: (v: string) => void;
  onSave: (seg: Segment) => void;
  onSplit: (seg: Segment) => void;
  onMerge: (seg: Segment) => void;
  onDelete: (seg: Segment) => void;
  onSceneCut: (seg: Segment, sceneId: string) => void;
};

const SegmentRow = memo(function SegmentRow({
  seg, isLast, active, editing, isStart, t, draftText, draftTrans, busy, scenes, cuts,
  onSeek, onOpenMenu, onStartEdit, onCancelEdit, onDraftText, onDraftTrans,
  onSave, onSplit, onMerge, onDelete, onSceneCut,
}: RowProps) {
  // Seek to (just before) the first word, not seg.start: whisper's segment offset
  // can sit up to ~1s before the first word, and the previous caption is "glued" on
  // screen right up to that first word — so seeking to seg.start lands inside the
  // previous cue (last word still highlighted) and makes clips start on a trailing
  // phrase. The small lead-in (WORD_LEAD) avoids eating the word's attack.
  const seekTarget = segmentSeekStart(seg);
  return (
    <div
      data-seg-id={seg.id}
      className={`seg ${active ? "active" : ""} ${editing ? "editing" : ""} ${isStart ? "clip-start" : ""}`}
      onContextMenu={(e) => onOpenMenu(e, seg)}
    >
      <span className="ts" onClick={() => onSeek(seekTarget)}>
        {formatTime(seg.start)}
      </span>

      {editing ? (
        <div className="seg-edit">
          <textarea value={draftText} onChange={(e) => onDraftText(e.target.value)} rows={2} autoFocus />
          <input
            className="trans-input"
            placeholder="Traduction"
            value={draftTrans}
            onChange={(e) => onDraftTrans(e.target.value)}
          />
          <div className="seg-actions">
            <button className="btn sm" disabled={busy} onClick={() => onSave(seg)}>
              Enregistrer
            </button>
            <button className="link" onClick={onCancelEdit}>
              Annuler
            </button>
            <button className="link" disabled={busy || seg.words.length < 2} onClick={() => onSplit(seg)}>
              ✂ Diviser
            </button>
            <button className="link" disabled={busy || isLast} onClick={() => onMerge(seg)}>
              ⤵ Fusionner
            </button>
            <button className="link danger" disabled={busy} onClick={() => onDelete(seg)}>
              🗑 Supprimer
            </button>
          </div>
        </div>
      ) : (
        <span
          className="seg-text"
          title="Clic : aller à ce passage · double-clic : corriger"
          onClick={() => onSeek(seekTarget)}
          onDoubleClick={() => onStartEdit(seg)}
        >
          {seg.words.length > 0
            ? seg.words.map((w, j) => (
                <span key={j} className={active && isWordActive(w, t) ? "word on" : "word"}>
                  {w.text}{" "}
                </span>
              ))
            : seg.text}
          {seg.translation && <span className="seg-trans"> — {seg.translation}</span>}
        </span>
      )}
      {!editing && scenes.length > 1 && (
        <div className="seg-scenes" title="Scène affichée à partir d'ici">
          {scenes.map((sc) => {
            const on = activeSceneId(cuts, segCutTime(seg)) === sc.id;
            return (
              <button
                key={sc.id}
                className={`scene-dot ${on ? "on" : ""}`}
                style={{ backgroundColor: on ? sc.color : "transparent", borderColor: sc.color }}
                title={sc.name}
                onClick={(e) => { e.stopPropagation(); onSceneCut(seg, sc.id); }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
});

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
  withSearch = false,
  follow = false,
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
  withSearch?: boolean;
  follow?: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftTrans, setDraftTrans] = useState("");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; seg: Segment } | null>(null);
  const [query, setQuery] = useState("");
  const segsRef = useRef<HTMLDivElement>(null);

  // Refs holding the latest live values, so the row-facing callbacks below stay
  // referentially STABLE (empty deps) even though Editor recreates onSeek/reload/
  // … every frame — otherwise SegmentRow's memo would never bail.
  const tRef = useRef(t); tRef.current = t;
  const draftRef = useRef({ text: draftText, trans: draftTrans });
  draftRef.current = { text: draftText, trans: draftTrans };
  const onSeekRef = useRef(onSeek); onSeekRef.current = onSeek;
  const onSceneCutRef = useRef(onSceneCut); onSceneCutRef.current = onSceneCut;
  const reloadRef = useRef(reload); reloadRef.current = reload;

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  const q = query.trim().toLowerCase();
  const shown = q
    ? segments.filter(
        (s) => s.text.toLowerCase().includes(q) || (s.translation || "").toLowerCase().includes(q)
      )
    : segments;
  // Active row: each segment owns the span from its OWN seek target (lead-in
  // included, so it matches where a click lands) up to the NEXT segment's seek
  // target. If we kept `t >= s.start` the lead-in could drop the playhead just
  // below seg.start and light up the previous row — the boundary must move with
  // the seek, exactly as the seek pulls the start back before the first word.
  let activeId: string | null = null;
  for (let i = 0; i < segments.length; i++) {
    const lo = segmentSeekStart(segments[i]);
    const hi = i + 1 < segments.length ? segmentSeekStart(segments[i + 1]) : segments[i].end;
    if (t >= lo && t < hi) { activeId = segments[i].id; break; }
  }
  const lastId = segments.length ? segments[segments.length - 1].id : null;

  // Auto-follow: keep the line at the playhead visible while playing (only when
  // not searching, so it doesn't fight the user browsing results). Query the DOM
  // by id instead of a ref, so rows don't need a per-row ref prop.
  useEffect(() => {
    if (!follow || q || !activeId) return;
    segsRef.current
      ?.querySelector(`[data-seg-id="${activeId}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId, follow, q]);

  const seekStable = useCallback((to: number) => onSeekRef.current(to), []);
  const sceneCutStable = useCallback((seg: Segment, sceneId: string) => onSceneCutRef.current(seg, sceneId), []);
  const openMenu = useCallback((e: ReactMouseEvent, seg: Segment) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, seg });
  }, []);
  const startEdit = useCallback((seg: Segment) => {
    setEditingId(seg.id);
    setDraftText(seg.text);
    setDraftTrans(seg.translation);
  }, []);
  const cancelEdit = useCallback(() => setEditingId(null), []);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await reloadRef.current();
    } finally {
      setBusy(false);
    }
  }, []);

  const onSave = useCallback((seg: Segment) => {
    run(() =>
      api.patchSegment(projectId, seg.id, {
        text: draftRef.current.text,
        translation: draftRef.current.trans,
      })
    ).then(() => setEditingId(null));
  }, [run, projectId]);

  const onSplit = useCallback((seg: Segment) => {
    // Split at the word boundary nearest the playhead (else the middle).
    const tt = tRef.current;
    let idx: number;
    if (seg.words.length < 2) idx = 0;
    else if (tt > seg.start && tt < seg.end) {
      idx = seg.words.filter((w) => w.start <= tt).length;
      idx = Math.min(Math.max(idx, 1), seg.words.length - 1);
    } else idx = Math.floor(seg.words.length / 2);
    run(() => api.splitSegment(projectId, seg.id, idx));
  }, [run, projectId]);

  const onMerge = useCallback((seg: Segment) => run(() => api.mergeSegment(projectId, seg.id)), [run, projectId]);
  const onDelete = useCallback((seg: Segment) => run(() => api.deleteSegment(projectId, seg.id)), [run, projectId]);

  return (
    <div className="transcript">
      <div className="transcript-head">
        <h3>Transcription</h3>
        {withSearch && (
          <input
            className="transcript-search"
            type="search"
            placeholder="Rechercher…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        <p className="muted small" title="Clic : aller · Double-clic : corriger · Clic droit : clip / scène">
          Clic : aller · double-clic : corriger
          {q ? ` · ${shown.length} résultat${shown.length > 1 ? "s" : ""}` : ""}
        </p>
      </div>
      <div className="segments" ref={segsRef}>
        {shown.map((s) => {
          const active = s.id === activeId;
          const editing = editingId === s.id;
          return (
            <SegmentRow
              key={s.id}
              seg={s}
              isLast={s.id === lastId}
              active={active}
              editing={editing}
              isStart={s.id === pendingClipStartId}
              t={active ? t : 0}
              draftText={editing ? draftText : ""}
              draftTrans={editing ? draftTrans : ""}
              busy={editing ? busy : false}
              scenes={scenes}
              cuts={cuts}
              onSeek={seekStable}
              onOpenMenu={openMenu}
              onStartEdit={startEdit}
              onCancelEdit={cancelEdit}
              onDraftText={setDraftText}
              onDraftTrans={setDraftTrans}
              onSave={onSave}
              onSplit={onSplit}
              onMerge={onMerge}
              onDelete={onDelete}
              onSceneCut={sceneCutStable}
            />
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
