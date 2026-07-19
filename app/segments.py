"""Segment editing: correct text, split, merge.

When a caption's text is corrected, its per-word timings must stay sensible so
the karaoke highlight keeps working. If the word count is unchanged (a typo
fix) we keep the original timings 1:1; otherwise we redistribute the segment's
time span evenly across the new words.
"""
from __future__ import annotations

import uuid


def _new_id() -> str:
    return "s" + uuid.uuid4().hex[:8]


def _redistribute(text: str, start: float, end: float) -> list[dict]:
    tokens = text.split()
    if not tokens:
        return []
    span = (end - start) / len(tokens)
    return [
        {"start": round(start + i * span, 3),
         "end": round(start + (i + 1) * span, 3),
         "text": tok}
        for i, tok in enumerate(tokens)
    ]


def set_segment_text(seg: dict, new_text: str) -> None:
    tokens = new_text.split()
    old = seg.get("words", [])
    if tokens and len(tokens) == len(old):
        for w, tok in zip(old, tokens):
            w["text"] = tok
    else:
        seg["words"] = _redistribute(new_text, seg["start"], seg["end"])
    seg["text"] = new_text.strip()


def find(segments: list[dict], seg_id: str) -> int:
    for i, s in enumerate(segments):
        if s["id"] == seg_id:
            return i
    return -1


def split(segments: list[dict], seg_id: str, word_index: int) -> None:
    """Split a segment before word `word_index` into two segments."""
    i = find(segments, seg_id)
    if i < 0:
        return
    seg = segments[i]
    words = seg.get("words", [])
    if word_index <= 0 or word_index >= len(words):
        return
    left, right = words[:word_index], words[word_index:]
    seg.update(
        words=left,
        end=left[-1]["end"],
        text=" ".join(w["text"] for w in left),
    )
    new_seg = {
        "id": _new_id(),
        "start": right[0]["start"],
        "end": right[-1]["end"],
        "text": " ".join(w["text"] for w in right),
        "translation": "",
        "words": right,
    }
    segments.insert(i + 1, new_seg)


_SENT_END = ".?!…"
_CLOSERS = "\"»)]'’”"


def _ends_sentence(text: str) -> bool:
    """True if `text` (a word) closes a sentence — ends in .?!… once trailing
    quotes/brackets are stripped."""
    return text.rstrip(_CLOSERS).rstrip()[-1:] in _SENT_END


def _starts_sentence(text: str) -> bool:
    """True if `text` (the next word) plausibly opens a new sentence — its first
    letter is uppercase (or it's a digit / non-letter). Guards against splitting
    on abbreviations like "etc." or "M." followed by a lowercase word."""
    for ch in text:
        if ch.isalpha():
            return ch.isupper()
        if ch.isdigit():
            return True
    return True


def split_sentences(segments: list[dict]) -> list[dict]:
    """Return a new segment list where no segment holds more than one sentence.

    Each segment's words are cut wherever a word ends a sentence (.?!…) and the
    following word opens a new one. Word timings are preserved 1:1; the extra
    pieces get fresh ids and empty translations (the split invalidates a
    translation that spanned several sentences)."""
    out: list[dict] = []
    for seg in segments:
        words = seg.get("words") or []
        if not words:
            out.append(seg)
            continue
        pieces: list[list[dict]] = []
        cur: list[dict] = []
        for i, w in enumerate(words):
            cur.append(w)
            last = i == len(words) - 1
            if _ends_sentence(w.get("text", "")) and (
                last or _starts_sentence(words[i + 1].get("text", ""))
            ):
                pieces.append(cur)
                cur = []
        if cur:
            pieces.append(cur)
        if len(pieces) <= 1:
            out.append(seg)
            continue
        for j, piece in enumerate(pieces):
            out.append({
                "id": seg["id"] if j == 0 else _new_id(),
                "start": piece[0]["start"],
                "end": piece[-1]["end"],
                "text": " ".join(x["text"] for x in piece),
                "translation": "",
                "words": piece,
            })
    return out


def merge_with_next(segments: list[dict], seg_id: str) -> None:
    """Merge a segment with the one after it."""
    i = find(segments, seg_id)
    if i < 0 or i + 1 >= len(segments):
        return
    a, b = segments[i], segments[i + 1]
    a["words"] = a.get("words", []) + b.get("words", [])
    a["end"] = b["end"]
    a["text"] = (a["text"] + " " + b["text"]).strip()
    trans = [t for t in (a.get("translation", ""), b.get("translation", "")) if t]
    a["translation"] = " ".join(trans)
    del segments[i + 1]
