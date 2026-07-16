#!/usr/bin/env bash
set -euo pipefail

# Download a few punchy, OFL-licensed caption fonts from GitHub and place them
# where both the browser preview (frontend/public/fonts) and the libass export
# (fontconfig, ~/.local/share/fonts) can find them.
#
# Fonts & sources (all SIL Open Font License):
#   Anton       https://github.com/googlefonts/AntonFont
#   Bebas Neue  https://github.com/dharmatype/Bebas-Neue
#   Oswald      https://github.com/googlefonts/OswaldFont
#   Montserrat  https://github.com/JulietaUla/Montserrat

DEST="${DEST:-$(cd "$(dirname "$0")/.." && pwd)/frontend/public/fonts}"
USER_FONTS="${USER_FONTS:-$HOME/.local/share/fonts/video-editor}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$DEST" "$USER_FONTS"

clone() { git clone --depth 1 "https://github.com/$1.git" "$TMP/$2" >/dev/null 2>&1; }
grab()  { cp "$TMP/$1" "$DEST/$2"; }

echo "Cloning font repos…"
clone googlefonts/AntonFont anton
clone dharmatype/Bebas-Neue bebas
clone googlefonts/OswaldFont oswald
clone JulietaUla/Montserrat montserrat

echo "Copying TTFs…"
grab "anton/fonts/Anton-Regular.ttf"                              Anton-Regular.ttf
grab "bebas/fonts/BebasNeue(2018)ByDhamraType/ttf/BebasNeue-Regular.ttf" BebasNeue-Regular.ttf
grab "oswald/fonts/ttf/Oswald-SemiBold.ttf"                       Oswald-SemiBold.ttf
grab "oswald/fonts/ttf/Oswald-Bold.ttf"                           Oswald-Bold.ttf
grab "montserrat/fonts/ttf/Montserrat-Bold.ttf"                   Montserrat-Bold.ttf
grab "montserrat/fonts/ttf/Montserrat-Black.ttf"                  Montserrat-Black.ttf

# Make the same fonts visible to libass/ffmpeg for the burned-in export.
cp "$DEST"/*.ttf "$USER_FONTS"/
command -v fc-cache >/dev/null 2>&1 && fc-cache -f "$USER_FONTS" >/dev/null 2>&1 || true

echo "Done:"
ls -1 "$DEST"
echo "Also installed to $USER_FONTS (for export)."
