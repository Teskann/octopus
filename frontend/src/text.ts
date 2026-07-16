const NBSP = String.fromCharCode(0xa0); // non-breaking space U+00A0
// French typography: NBSP before : ; ? ! » and after «. Only when preceded by a
// real character (not a space or another of these signs) so "?!" isn't split.
const BEFORE = /([^\s:;?!»«])[ \t]*([:;?!»])/g;
const AFTER = /(«)[ \t]*([^\s»])/g;

export function frenchSpacing(text: string): string {
  return text.replace(BEFORE, `$1${NBSP}$2`).replace(AFTER, `$1${NBSP}$2`);
}
