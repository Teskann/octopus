import { hugsPrev, hugsNext } from "./text";
import type { Segment, Style, Word } from "./types";

const REFERENCE_WIDTH = 1080; // widths are authored against this (matches backend)

// Max silent gap (seconds) bridged across a *sentence boundary* by holding the
// previous caption on screen instead of blanking it. Within one sentence we glue
// regardless of the gap. See the glue pass below.
const SENTENCE_GAP = 0.8;
// Reading tail (seconds): how long a caption lingers past its last word when it
// isn't glued to the next one, so it doesn't disappear before it can be read.
// Capped so it never overlaps the following caption.
const READ_TAIL = 0.5;

export interface Cue {
  lines: Word[][]; // block, split into lines of words
  text: string; // raw joined text of the whole block
  translation: string; // this block's slice of the segment translation
  start: number;
  end: number;
}

// One reusable canvas to measure real text width in the chosen font.
const _canvas = document.createElement("canvas");
const _ctx = _canvas.getContext("2d")!;
function measure(text: string, font: string, fontSize: number): number {
  _ctx.font = `800 ${fontSize}px "${font}"`;
  return _ctx.measureText(text).width;
}

/** Split a segment translation across its blocks proportionally to each block's
 *  word count. Mirrors app/subtitles.split_translation. */
function splitTranslation(translation: string, counts: number[]): string[] {
  const words = translation.trim() ? translation.trim().split(/\s+/) : [];
  const n = words.length;
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const parts: string[] = [];
  let acc = 0;
  for (const c of counts) {
    const start = Math.round((n * acc) / total);
    acc += c;
    const end = Math.round((n * acc) / total);
    parts.push(words.slice(start, end).join(" "));
  }
  return parts;
}

/** Group a segment's words into blocks -> lines by measuring text width: a line
 *  fills up to `max_line_width_pct`% of the video width (measured against the
 *  1080 reference), then wraps; after `max_lines` lines a new block starts. */
function blocksFor(words: Word[], style: Style): Word[][][] {
  if (words.length === 0) return [];
  const maxLines = Math.max(style.max_lines, 1);
  const maxLinePx = (style.max_line_width_pct / 100) * REFERENCE_WIDTH;
  const cap = (s: string) => (style.uppercase ? s.toUpperCase() : s);
  const lineText = (line: Word[]) => cap(line.map((w) => w.text).join(" "));

  // Group words into chunks that must never be split across a line break: a word
  // plus any French sign that hugs it (: ; ? ! » after it, « before the next), so
  // wrapping can only happen *between* chunks — a lone "?" or "»" can't head or
  // tail a line anymore.
  const chunks: Word[][] = [];
  for (const word of words) {
    const prev = chunks.length ? chunks[chunks.length - 1] : null;
    if (prev && (hugsPrev(word.text) || hugsNext(prev[prev.length - 1].text))) {
      prev.push(word);
    } else {
      chunks.push([word]);
    }
  }

  const blocks: Word[][][] = [];
  let block: Word[][] = [];
  let line: Word[] = [];
  for (const chunk of chunks) {
    const candidate = [...line, ...chunk];
    if (line.length && measure(lineText(candidate), style.font, style.font_size) > maxLinePx) {
      block.push(line);
      line = [...chunk];
      if (block.length >= maxLines) {
        blocks.push(block);
        block = [];
      }
    } else {
      line = candidate;
    }
  }
  if (line.length) block.push(line);
  if (block.length) blocks.push(block);
  return blocks;
}

export function buildCues(segments: Segment[], style: Style): Cue[] {
  const cues: Cue[] = [];
  for (const seg of segments) {
    if (seg.words.length === 0) {
      cues.push({
        lines: [],
        text: seg.text,
        translation: seg.translation || "",
        start: seg.start,
        end: seg.end,
      });
      continue;
    }
    const blocks = blocksFor(seg.words, style);
    const counts = blocks.map((lines) => lines.reduce((a, l) => a + l.length, 0));
    const parts = splitTranslation(seg.translation || "", counts);
    blocks.forEach((lines, bi) => {
      const flat = lines.flat();
      cues.push({
        lines,
        text: flat.map((w) => w.text).join(" "),
        translation: parts[bi],
        start: flat[0].start,
        end: flat[flat.length - 1].end,
      });
    });
  }
  // Hold each caption on screen past its last word so it doesn't vanish before
  // the viewer can finish reading, never overlapping the next caption:
  //  - "glue" (hold right up to the next caption's start) within one sentence
  //    (current cue doesn't end on . ! ? …) or across a short pause (≤ SENTENCE_GAP);
  //  - otherwise add a fixed reading tail of up to READ_TAIL seconds.
  // The last caption has no follower, so it just gets the reading tail.
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1];
    if (!next) {
      cues[i].end += READ_TAIL;
      continue;
    }
    const gap = next.start - cues[i].end;
    if (gap <= 0) continue; // already back-to-back (e.g. blocks of one segment)
    if (!endsSentence(cues[i].text) || gap <= SENTENCE_GAP) {
      cues[i].end = next.start; // glue: hold until the next caption begins
    } else {
      cues[i].end = Math.min(next.start, cues[i].end + READ_TAIL);
    }
  }
  // Keep each cue's LAST word highlighted until the caption itself disappears
  // (cue.end, glue included) instead of dropping the highlight at the word's own
  // end and leaving the block lit-nowhere while it lingers on screen. We swap in
  // a cloned Word so the shared segment data is left untouched.
  for (const cue of cues) {
    if (cue.lines.length === 0) continue;
    const line = cue.lines[cue.lines.length - 1];
    const wi = line.length - 1;
    if (wi >= 0 && cue.end > line[wi].end) line[wi] = { ...line[wi], end: cue.end };
  }
  return cues;
}

/** Does this block's text end a sentence? (ignoring trailing quotes/brackets) */
function endsSentence(text: string): boolean {
  return /[.!?…]$/u.test(text.replace(/["'»)\]]+$/u, "").trimEnd());
}

export function activeCueIndex(cues: Cue[], t: number): number {
  return cues.findIndex((c) => t >= c.start && t < c.end);
}

export function isWordActive(w: Word, t: number): boolean {
  return t >= w.start && t < w.end;
}
