#!/usr/bin/env bash
set -euo pipefail

# Build whisper.cpp with the ROCm/HIP backend for the RX 6900 XT (gfx1030) and
# download a model. whisper.cpp gives word-level timestamps (with --dtw), which
# is what the subtitle karaoke highlight needs. Same toolchain as llama.cpp.
# gfx1030 is natively supported by ROCm 7.x — no HSA_OVERRIDE_GFX_VERSION.

WHISPER_DIR="${WHISPER_DIR:-$HOME/whisper.cpp}"
GPU_TARGET="${GPU_TARGET:-gfx1030}"
MODEL="${MODEL:-large-v3-turbo}"   # good speed/quality; matches WHISPER_DTW default

if [ ! -d "$WHISPER_DIR" ]; then
    git clone https://github.com/ggml-org/whisper.cpp "$WHISPER_DIR"
fi
cd "$WHISPER_DIR"
git pull --ff-only || true

HIPCXX="$(hipconfig -l)/clang" HIP_PATH="$(hipconfig -R)" \
cmake -S . -B build \
    -DGGML_HIP=ON \
    -DAMDGPU_TARGETS="$GPU_TARGET" \
    -DCMAKE_BUILD_TYPE=Release

cmake --build build --config Release -j"$(nproc)" --target whisper-cli

# Download the ggml model (skips if already present).
./models/download-ggml-model.sh "$MODEL"

echo
echo "Built:  $WHISPER_DIR/build/bin/whisper-cli"
echo "Model:  $WHISPER_DIR/models/ggml-$MODEL.bin"
echo
echo "If you built a different model, point the app at it with:"
echo "  export WHISPER_MODEL=$WHISPER_DIR/models/ggml-$MODEL.bin"
echo "  export WHISPER_DTW=<dtw-alias>   # e.g. large.v3.turbo, medium, small"
