const NBSP = String.fromCharCode(0xa0); // non-breaking space U+00A0
// French typography: NBSP before : ; ? ! » and after «. Only when preceded by a
// real character (not a space or another of these signs) so "?!" isn't split.
const BEFORE = /([^\s:;?!»«])[ \t]*([:;?!»])/g;
const AFTER = /(«)[ \t]*([^\s»])/g;

export function frenchSpacing(text: string): string {
  return text.replace(BEFORE, `$1${NBSP}$2`).replace(AFTER, `$1${NBSP}$2`);
}

// When whisper emits a French sign as its OWN word (it leads with a space, so it
// becomes a separate token), the NBSP inside frenchSpacing can't apply — the join
// between words is what must be non-breaking. These say which words must stay
// glued to a neighbour, both when wrapping (captions.ts) and rendering
// (CaptionBlock). Same signs as BEFORE/AFTER above.
export function hugsPrev(text: string): boolean {
  return /^[:;?!»]/.test(text); // : ; ? ! » hug the previous word
}
export function hugsNext(text: string): boolean {
  return text.endsWith("«"); // « hugs the next word
}
