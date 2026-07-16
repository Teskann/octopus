"""One-shot diagnostic: what timing info does *this* whisper.cpp build emit?

Runs whisper-cli on the first 20 s of your most recent project's audio, using
the same paths/model/DTW preset the app uses, and dumps the raw token JSON so we
can see whether per-word timestamps (and t_dtw) are actually populated.

    .venv/bin/python scripts/diag_whisper.py
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import config  # noqa: E402

auds = sorted(config.PROJECTS_DIR.glob("*/audio.wav"))
if not auds:
    sys.exit("No data/projects/*/audio.wav found — process a video first.")
wav = auds[-1]

print("audio      :", wav)
print("whisper-cli:", config.WHISPER_BIN, "(exists:", config.WHISPER_BIN.exists(), ")")
print("model      :", config.WHISPER_MODEL, "(exists:", config.WHISPER_MODEL.exists(), ")")
print("dtw preset :", config.WHISPER_DTW)

out = Path("/tmp/diag_w")
cmd = [
    str(config.WHISPER_BIN),
    "-m", str(config.WHISPER_MODEL),
    "-f", str(wav),
    "-oj", "-ojf",
    "-of", str(out),
    "-t", str(config.WHISPER_THREADS),
    "-d", "20000",           # only the first 20 s, so it's quick
]
if config.WHISPER_DTW:
    cmd += ["--dtw", config.WHISPER_DTW]

print("\nRUN:", " ".join(cmd), "\n")
proc = subprocess.run(cmd, capture_output=True, text=True)
print("exit code  :", proc.returncode)
print("\n--- whisper-cli stderr (tail) ---\n", proc.stderr[-1800:])

jpath = out.with_suffix(".json")
if not jpath.exists():
    sys.exit("no JSON produced")
data = json.loads(jpath.read_text(encoding="utf-8"))
toks = data["transcription"][0]["tokens"]
print("\n--- first 10 tokens (ALL keys, verbatim) ---")
for t in toks[:10]:
    print(json.dumps(t, ensure_ascii=False))

# quick check: are the DTW help flags present?
print("\n--- whisper-cli --help : timestamp-related flags ---")
h = subprocess.run([str(config.WHISPER_BIN), "--help"], capture_output=True, text=True)
for line in (h.stdout + h.stderr).splitlines():
    if any(k in line.lower() for k in ("dtw", "timestamp", "max-len", "split-on-word", "word-thold")):
        print(line.rstrip())
