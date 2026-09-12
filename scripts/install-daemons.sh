#!/bin/bash
# Installe deux agents de session : Ollama et le serveur Studio démarrent
# à l'ouverture de session et redémarrent s'ils tombent. L'application est
# alors disponible en permanence, y compris sans aucune connexion réseau.
#
# Désinstallation :
#   bash scripts/install-daemons.sh --uninstall
set -euo pipefail

PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/Studio"
OLLAMA_LABEL="fr.cm-it.lab.ollama"
STUDIO_LABEL="fr.cm-it.lab.studio"

if [ "${1:-}" = "--uninstall" ]; then
  for label in "$OLLAMA_LABEL" "$STUDIO_LABEL"; do
    launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
    rm -f "$AGENTS/$label.plist"
    echo "retiré : $label"
  done
  exit 0
fi

NODE_BIN="$(command -v node)"
OLLAMA_BIN="$(command -v ollama || echo /usr/local/bin/ollama)"
mkdir -p "$AGENTS" "$LOGS"

plist() { # label · programme · argument · clé/valeurs d'environnement
  local label="$1" program="$2" arg="$3"
  cat > "$AGENTS/$label.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$program</string>
    <string>$arg</string>
  </array>
  <key>WorkingDirectory</key><string>$PROJECT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOGS/$label.log</string>
  <key>StandardErrorPath</key><string>$LOGS/$label.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>OLLAMA_HOST</key><string>127.0.0.1:11434</string>
  </dict>
</dict>
</plist>
PLIST
}

plist "$OLLAMA_LABEL" "$OLLAMA_BIN" "serve"
plist "$STUDIO_LABEL" "$NODE_BIN" "$PROJECT/server.mjs"

for label in "$OLLAMA_LABEL" "$STUDIO_LABEL"; do
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$label.plist"
  echo "chargé : $label"
done

echo
echo "✓ Ollama et Studio démarrent désormais à l'ouverture de session."
echo "  Application : http://127.0.0.1:5300"
echo "  Journaux    : $LOGS"
