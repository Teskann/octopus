#!/usr/bin/env bash
# Set up the clip-export renderer (app/render.py): Playwright + real Chrome.
#
# Export works by loading the frontend's preview route in a headless browser and
# screenshotting it frame by frame, so the MP4 matches the preview exactly.
# Google Chrome (not Playwright's bundled open-source Chromium) is required
# because the source videos are H.264/AAC, which Chromium can't decode.
set -euo pipefail
cd "$(dirname "$0")/.."

# Install into the SAME environment that runs the app (run-app.sh uses .venv).
if [ -x ".venv/bin/python" ]; then
    PY=".venv/bin/python"
else
    PY="python3"
fi
echo "Using Python: $PY"

"$PY" -m pip install -r requirements.txt

# Downloads a pinned Google Chrome build that Playwright can drive (channel=chrome).
"$PY" -m playwright install chrome

echo
echo "Renderer ready. Export needs the frontend reachable at RENDER_BASE_URL"
echo "(default http://127.0.0.1:5173 — the Vite dev server). Start it with:"
echo "    cd frontend && npm run dev"
