"""Translate a project's segments to a target language via llama-server.

Translation is done per whisper *segment* (a full sentence) so the model has
maximum context — translating tiny caption fragments produced garbage and
dropped words. The translation is stored on the segment; the display/export
splits it across that segment's caption blocks proportionally
(see app/subtitles.split_translation).

Reuses the existing llama-server (Voxtral/Mistral) with a plain text chat call.
"""
from __future__ import annotations

import re

import httpx

from . import config, store

LANGUAGE_NAMES = {
    "en": "English", "fr": "French", "de": "German", "es": "Spanish",
    "it": "Italian", "pt": "Portuguese", "nl": "Dutch", "hi": "Hindi",
}

# Instruct models (Voxtral/Mistral) like to wrap the answer in a preamble
# ("Here's the translation:"), quotes, or a literal placeholder like
# "<translated text>". Strip all of that off.
_PREAMBLE = re.compile(
    r"^\s*(sure[,!.]?\s*)?"
    r"(here(?:'s| is)?|voici|the translation(?: is)?|translation|traduction)"
    r"[^:\n]{0,40}:\s*",
    re.IGNORECASE,
)
_PLACEHOLDER = re.compile(r"<[^>\n]{0,60}>")  # e.g. <translated text>
# "The sentence '…' translates to '…'" / "… se traduit par '…'": keep the part
# after the connective.
_TRANSLATES = re.compile(
    r".*?\b(?:translate[sd]?\s+(?:to|as|into)|se\s+traduit\s+(?:par|en)|means)\b[:\s]*",
    re.IGNORECASE | re.DOTALL,
)
_QUOTES = "\"'«»“”‘’"


class TranslationError(RuntimeError):
    """Raised when the llama-server translation call fails."""


def _language_name(code: str) -> str:
    return LANGUAGE_NAMES.get(code, code)


def _clean(text: str) -> str:
    text = text.strip()
    text = _PREAMBLE.sub("", text)
    text = _TRANSLATES.sub("", text)
    text = _PLACEHOLDER.sub("", text).strip()
    # strip a single layer of wrapping quotes if the whole string is quoted
    if len(text) >= 2 and text[0] in _QUOTES and text[-1] in _QUOTES:
        text = text[1:-1].strip()
    return text


def translate_text(text: str, target: str) -> str:
    if not text.strip():
        return ""
    system = (
        f"You are a translation engine. Output ONLY the {_language_name(target)} "
        f"translation of the user's text. Do not explain. Do not repeat or quote "
        f"the source. Never write labels or phrases like 'the sentence', "
        f"'translates to', 'translation', or angle-bracket placeholders. Return "
        f"just the translated sentence, complete, with nothing left out."
    )
    payload = {
        "model": config.TRANSLATE_MODEL,
        "temperature": 0.1,
        "max_tokens": 512,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": text},
        ],
    }
    try:
        resp = httpx.post(
            f"{config.TRANSLATE_SERVER_URL}/v1/chat/completions",
            json=payload, timeout=config.REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"]["content"]
        return _clean(raw)
    except (httpx.HTTPError, KeyError, IndexError) as exc:
        raise TranslationError(f"translation request failed: {exc}") from exc


def translate_project(project_id: str, target: str) -> None:
    project = store.get(project_id)
    if project is None:
        return
    segments = project["segments"]
    project.update(translate_to=target, translate_status="running",
                   translate_progress=0.0)
    store.save(project)
    try:
        for i, seg in enumerate(segments):
            seg["translation"] = translate_text(seg["text"], target)
            project["translate_progress"] = (i + 1) / max(len(segments), 1)
            if i % 3 == 0:
                store.save(project)
        project.update(translate_status="done", translate_progress=1.0)
        store.save(project)
    except Exception as exc:  # noqa: BLE001 - report to client
        project.update(translate_status="error", error=str(exc))
        store.save(project)
