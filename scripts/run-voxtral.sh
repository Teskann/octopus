#!/usr/bin/env bash
set -euo pipefail

# Start llama-server with Voxtral-Mini for audio transcription.
# `-hf` downloads both the model weights and the mmproj (audio encoder) on first
# run. `--alias voxtral` makes the model answer to the name the app sends
# (MODEL_NAME in app/config.py). `-ngl 99` offloads all layers to the GPU — the
# 3B model fits in the 6900 XT's 16 GB VRAM.

LLAMA_SERVER="${LLAMA_SERVER:-$HOME/llama.cpp/build/bin/llama-server}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8080}"
MODEL_HF="${MODEL_HF:-ggml-org/Voxtral-Mini-3B-2507-GGUF}"
NGL="${NGL:-99}"
CTX="${CTX:-16384}"   # ~750 audio tokens/min; 16k comfortably covers a 10-min chunk
FA="${FA:-off}"       # MUST stay off on gfx1030 (RDNA2): the HIP Flash-Attention
                      # kernel aborts (ggml_abort in launch_fattn) during decode.

exec "$LLAMA_SERVER" \
    -hf "$MODEL_HF" \
    --alias voxtral \
    --host "$HOST" --port "$PORT" \
    -ngl "$NGL" \
    -c "$CTX" \
    --flash-attn "$FA"
