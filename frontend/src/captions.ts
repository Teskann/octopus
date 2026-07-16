import type { Segment, Style, Word } from "./types";

const REFERENCE_WIDTH = 1080; // widths are authored against this (matches backend)

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
  const lineText = (line: Word[], extra?: Word) =>
    cap([...line, ...(extra ? [extra] : [])].map((w) => w.text).join(" "));

  const blocks: Word[][][] = [];
  let block: Word[][] = [];
  let line: Word[] = [];
  for (const word of words) {
    if (line.length && measure(lineText(line, word), style.font, style.font_size) > maxLinePx) {
      block.push(line);
      line = [word];
      if (block.length >= maxLines) {
        blocks.push(block);
        block = [];
      }
    } else {
      line.push(word);
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
  return cues;
}

export function activeCueIndex(cues: Cue[], t: number): number {
  return cues.findIndex((c) => t >= c.start && t < c.end);
}

export function isWordActive(w: Word, t: number): boolean {
  return t >= w.start && t < w.end;
}
