#!/usr/bin/env bash
set -euo pipefail

# Start the FastAPI web app. Single worker is required: jobs are held in memory.
cd "$(dirname "$0")/.."

# Prefer the repo virtualenv so this works without `source .venv/bin/activate`.
if [ -x ".venv/bin/uvicorn" ]; then
    UVICORN=".venv/bin/uvicorn"
else
    UVICORN="uvicorn"
fi

exec "$UVICORN" app.main:app --host 127.0.0.1 --port 8000 "$@"
