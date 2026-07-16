#!/usr/bin/env bash
set -euo pipefail

# Build llama.cpp with the ROCm/HIP backend for the RX 6900 XT (gfx1030).
# Requires the ROCm toolchain (hipcc/hipconfig), cmake, git and build-essential.
# gfx1030 is natively supported by ROCm 7.x, so no HSA_OVERRIDE_GFX_VERSION is needed.

LLAMA_DIR="${LLAMA_DIR:-$HOME/llama.cpp}"
GPU_TARGET="${GPU_TARGET:-gfx1030}"

if [ ! -d "$LLAMA_DIR" ]; then
    git clone https://github.com/ggml-org/llama.cpp "$LLAMA_DIR"
fi
cd "$LLAMA_DIR"
git pull --ff-only || true

HIPCXX="$(hipconfig -l)/clang" HIP_PATH="$(hipconfig -R)" \
cmake -S . -B build \
    -DGGML_HIP=ON \
    -DAMDGPU_TARGETS="$GPU_TARGET" \
    -DCMAKE_BUILD_TYPE=Release

cmake --build build --config Release -j"$(nproc)" --target llama-server llama-mtmd-cli

echo
echo "Built: $LLAMA_DIR/build/bin/llama-server"
echo "       $LLAMA_DIR/build/bin/llama-mtmd-cli"
