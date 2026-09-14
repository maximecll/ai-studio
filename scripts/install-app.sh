#!/bin/bash
# Génère Studio.app sur le Bureau.
#
# Un double-clic : démarre Ollama si besoin, lance le serveur de développement
# (Vite, rechargement à chaud, port 5273) en arrière-plan, puis ouvre
# l'interface dans une fenêtre dédiée. Idempotent : relançable à volonté.
#
# Pour installer ailleurs : bash scripts/install-app.sh ~/Applications
set -euo pipefail

PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Les applications lancées depuis le Finder n'héritent pas du PATH du shell :
# on fige les chemins absolus au moment de l'installation. Le lanceur remet
# ensuite le dossier de Node en tête du PATH, sans quoi npm — qui se relance
# via `#!/usr/bin/env node` — ne retrouverait pas son propre interpréteur.
NODE_BIN="$(command -v node)"
NPM_BIN="$(command -v npm)"
OLLAMA_BIN="$(command -v ollama || echo /usr/local/bin/ollama)"

[ -n "$NODE_BIN" ] || { echo "Node.js est introuvable. Installez-le, puis relancez." >&2; exit 1; }

echo "Projet : $PROJECT"
echo "Node   : $NODE_BIN  ($("$NODE_BIN" --version))"
echo "Ollama : $OLLAMA_BIN"

# Un gestionnaire de versions déplace Node à chaque mise à jour : le chemin figé
# ici cesserait alors d'exister. Autant le dire maintenant que le découvrir un
# matin, devant une application qui refuse de démarrer.
case "$NODE_BIN" in
  */.nvm/*|*/.volta/*|*/.fnm/*|*/fnm_multishells/*)
    echo
    echo "Note : ce Node vient d'un gestionnaire de versions."
    echo "       Après un changement de version, relancez ce script."
    ;;
esac
echo

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# make_app <chemin.app> <nom> <identifiant> <mode> <port> <teinte1> <teinte2> <marque>
make_app() {
  local app="$1" name="$2" bundle="$3" mode="$4" port="$5" from="$6" to="$7" mark="${8:-}"

  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"

  # ── Icône ─────────────────────────────────────────────────────────
  "$NODE_BIN" "$PROJECT/scripts/make-icon.mjs" "$TMP/$mode.png" "$from" "$to" "$mark" >/dev/null
  local iconset="$TMP/$mode.iconset"
  mkdir -p "$iconset"
  for size in 16 32 64 128 256 512; do
    sips -z $size $size "$TMP/$mode.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null 2>&1
    sips -z $((size * 2)) $((size * 2)) "$TMP/$mode.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null 2>&1
  done
  iconutil -c icns "$iconset" -o "$app/Contents/Resources/icon.icns"

  # ── Info.plist ────────────────────────────────────────────────────
  cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$name</string>
  <key>CFBundleDisplayName</key><string>$name</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIdentifier</key><string>$bundle</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

  # ── Exécutable ────────────────────────────────────────────────────
  {
    echo '#!/bin/bash'
    echo "# Lanceur $name — généré par scripts/install-app.sh, ne pas modifier à la main."
    echo "PROJECT=\"$PROJECT\""
    echo "NODE=\"$NODE_BIN\""
    echo "NPM=\"$NPM_BIN\""
    echo "OLLAMA=\"$OLLAMA_BIN\""
    echo "MODE=\"$mode\""
    echo "PORT=$port"
    echo "APP_NAME=\"$name\""
    cat "$PROJECT/scripts/launcher.sh"
  } > "$app/Contents/MacOS/launcher"

  chmod +x "$app/Contents/MacOS/launcher"
  touch "$app"
  echo "✓ $app"
}

DEST="${1:-$HOME/Desktop}"
make_app "$DEST/Studio.app" "Studio" "fr.cm-it.lab.studio" dev 5273 "#2f5fd8" "#1b3a8f" dev

echo
echo "Double-cliquez, ou glissez l'icône dans le Dock."
echo "Journaux : ~/Library/Logs/Studio"
