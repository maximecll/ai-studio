
URL="http://127.0.0.1:$PORT"
LOG="$HOME/Library/Logs/Studio"
mkdir -p "$LOG"

notify() { osascript -e "display notification \"$1\" with title \"$APP_NAME\"" >/dev/null 2>&1; }

# Une chaîne AppleScript n'admet ni guillemet nu, ni antislash, ni retour à la
# ligne littéral : sans cette conversion, un extrait de journal casserait la
# boîte de dialogue au lieu de s'y afficher.
applescript_string() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'BEGIN{ORS=""} NR>1{print "\\n"} {print}'
}

fail() {
  local body
  body="$(applescript_string "$1")"
  osascript -e "display dialog \"$body\" with title \"$APP_NAME\" buttons {\"OK\"} default button 1 with icon caution" >/dev/null 2>&1
  exit 1
}

# Dernières lignes utiles d'un journal, pour dire ce qui a réellement échoué.
why() {
  [ -f "$1" ] || return 0
  tail -5 "$1" 2>/dev/null | grep -v '^[[:space:]]*$' | tail -3
}
alive() { curl -fsS --max-time 2 "$1" >/dev/null 2>&1; }
listening() { nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; }

# ── Node ──────────────────────────────────────────────────────────────
#
# Le chemin figé à l'installation survit mal à un gestionnaire de versions :
# `nvm install` puis `nvm uninstall` le fait disparaître. Plutôt que d'échouer,
# on cherche un remplaçant aux endroits habituels — la version la plus récente
# d'abord — et on n'abandonne que s'il n'y a vraiment rien.
if [ ! -x "$NODE" ]; then
  for candidate in \
    "$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)" \
    "$HOME/.volta/bin/node" \
    /opt/homebrew/bin/node \
    /usr/local/bin/node
  do
    [ -n "$candidate" ] && [ -x "$candidate" ] || continue
    NODE="$candidate"
    [ -x "$(dirname "$NODE")/npm" ] && NPM="$(dirname "$NODE")/npm"
    break
  done
fi

[ -x "$NODE" ] || fail "Node.js est introuvable.

Le chemin figé à l'installation n'existe plus, et aucune autre installation n'a été trouvée.

Installez Node, puis relancez : bash scripts/install-app.sh"

# Les chemins absolus ci-dessus ne suffisent pas.
#
# `npm` est un lien vers `npm-cli.js`, dont la première ligne est
# `#!/usr/bin/env node` : npm relance donc node lui-même, en le cherchant dans
# le PATH. Or une application lancée depuis le Finder n'hérite pas du shell —
# elle reçoit /usr/bin:/bin:/usr/sbin:/sbin, sans nvm ni Homebrew. D'où
# « env: node: No such file or directory », et un serveur qui ne démarre jamais.
#
# Vite, esbuild et les scripts npm du projet dépendent tous de cette résolution.
PATH="$(dirname "$NODE"):$PATH"
export PATH

cd "$PROJECT" || fail "Dossier du projet introuvable : $PROJECT"

PROFILE="$HOME/Library/Application Support/Studio/$MODE"
LOCK="$HOME/Library/Application Support/Studio/$MODE.pid"
mkdir -p "$(dirname "$LOCK")"

# ── Instance unique ───────────────────────────────────────────────────
# Ce contrôle précède l'armement du nettoyage : une seconde instance qui
# s'arrête ne doit surtout pas couper le serveur de la première.
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
  # On ramène la fenêtre existante au premier plan plutôt que d'en ouvrir une.
  osascript -e "tell application \"System Events\" to set frontmost of (first process whose unix id is $(cat "$LOCK")) to true" >/dev/null 2>&1
  for browser in "Google Chrome" "Brave Browser" "Microsoft Edge" "Chromium"; do
    [ -d "/Applications/$browser.app" ] && open -a "$browser" >/dev/null 2>&1 && break
  done
  # « giving up » évite une boîte modale bloquée si personne n'est devant l'écran.
  [ -z "${STUDIO_HEADLESS:-}" ] && osascript -e \
    "display dialog \"$APP_NAME est déjà lancé.\" with title \"$APP_NAME\" buttons {\"OK\"} default button 1 with icon note giving up after 30" >/dev/null 2>&1
  exit 0
fi

echo $$ > "$LOCK"

# Ce que NOUS avons démarré — et donc ce que nous devons arrêter en partant.
OLLAMA_PID=""
STARTED_SERVER=""

cleanup() {
  trap - EXIT INT TERM
  rm -f "$LOCK"
  if [ -n "$STARTED_SERVER" ]; then
    # Vite est lancé via npm : on vise le processus qui tient réellement le
    # port, sinon l'enfant survit à son parent.
    lsof -ti "tcp:$PORT" 2>/dev/null | xargs -I{} kill {} 2>/dev/null
  fi
  # Ferme notre propre fenêtre de navigateur — identifiée par son profil dédié,
  # donc sans toucher aux autres fenêtres ouvertes.
  pkill -f "user-data-dir=$PROFILE" 2>/dev/null
  # Ollama n'est arrêté que s'il n'existait pas avant nous : un agent de session
  # ou un autre usage ne doit pas être coupé au passage.
  [ -n "$OLLAMA_PID" ] && kill "$OLLAMA_PID" 2>/dev/null
  exit 0
}
trap cleanup EXIT INT TERM

# 1 ── Ollama
#
# Ollama sonde le GPU au démarrage en lançant un sous-processus, sous chien de
# garde. Si la mémoire est saturée à cet instant, la sonde expire et le démon
# retombe sur le processeur — **définitivement**, car il ne re-sonde jamais.
# Tout tourne alors cinq fois plus lentement, sans le moindre message.
#
# On vérifie donc ce qu'il a trouvé, et on recommence si besoin.

# Vrai si le démon a bien vu le GPU. La ligne « inference compute » est la
# seule source d'information : l'API ne l'expose pas.
#
# Le journal s'accumule d'une session à l'autre : on ne lit que ce qui suit le
# repère écrit juste avant ce démarrage-ci, sans quoi une réussite d'hier
# passerait pour la réussite d'aujourd'hui.
metal_found() {
  awk '/^--- démarrage /{ buf = "" ; next } { buf = buf $0 "\n" } END { printf "%s", buf }' \
    "$LOG/ollama.log" 2>/dev/null | grep -q 'library=Metal'
}

start_ollama() {
  nohup "$OLLAMA" serve >> "$LOG/ollama.log" 2>&1 &
  OLLAMA_PID=$!
  for _ in $(seq 1 60); do
    alive "http://127.0.0.1:11434/api/version" && return 0
    sleep 0.5
  done
  return 1
}

if ! alive "http://127.0.0.1:11434/api/version"; then
  [ -x "$OLLAMA" ] || fail "Ollama est introuvable ($OLLAMA)."
  notify "Démarrage d'Ollama…"

  attempt=1
  while :; do
    echo "--- démarrage $(date '+%F %T') (tentative $attempt) ---" >> "$LOG/ollama.log"
    start_ollama || fail "Ollama n'a pas démarré.

$(why "$LOG/ollama.log")

Journal : ~/Library/Logs/Studio/ollama.log"

    # Laisser la sonde se terminer avant de juger.
    sleep 3
    metal_found && break

    [ "$attempt" -ge 2 ] && {
      notify "Ollama tourne sur le processeur — cinq fois plus lent."
      break
    }
    # La sonde a échoué : on laisse la mémoire retomber, puis on recommence.
    kill "$OLLAMA_PID" 2>/dev/null
    OLLAMA_PID=""
    attempt=$((attempt + 1))
    sleep 6
  done
fi

# 2 ── Dépendances
if [ ! -d node_modules ]; then
  notify "Première installation, patientez…"
  "$NPM" install >> "$LOG/build.log" 2>&1 || fail "npm install a échoué. Détails : ~/Library/Logs/Studio/build.log"
fi

# 3 ── Serveur — relancé seulement s'il ne tourne pas déjà
if ! listening; then
  STARTED_SERVER=1
  if [ "$MODE" = "dev" ]; then
    notify "Démarrage du serveur…"
    nohup "$NPM" run dev >> "$LOG/dev.log" 2>&1 &
  else
    # En production, on reconstruit si les sources ont bougé depuis le dernier build.
    needs_build=0
    [ -f dist/index.html ] || needs_build=1
    if [ "$needs_build" = 0 ] && [ -n "$(find src index.html package.json vite.config.ts -newer dist/index.html -print -quit 2>/dev/null)" ]; then
      needs_build=1
    fi
    if [ "$needs_build" = 1 ]; then
      notify "Mise à jour de l'interface…"
      "$NPM" run build >> "$LOG/build.log" 2>&1 || fail "La construction de l'interface a échoué.

$(why "$LOG/build.log")

Journal : ~/Library/Logs/Studio/build.log"
    fi
    # Boucle de supervision : sortie 75 = mise à jour appliquée, on repart.
    nohup sh -c 'while :; do AI_STUDIO_SUPERVISED=1 "$1" "$2" >> "$3" 2>&1; [ $? -eq 75 ] || break; done' \
      _ "$NODE" "$PROJECT/server.mjs" "$LOG/server.log" >/dev/null 2>&1 &
  fi

  # Vite met quelques secondes à se lever la première fois.
  for _ in $(seq 1 120); do
    listening && break
    sleep 0.25
  done
  if ! listening; then
    log_file="$LOG/dev.log"
    [ "$MODE" = "dev" ] || log_file="$LOG/server.log"
    fail "Le serveur n'a pas démarré après 30 secondes.

$(why "$log_file")

Journal : ~/Library/Logs/Studio/"
  fi
fi

# 4 ── Fenêtre dédiée, puis attente.
#
# Le lanceur reste vivant tant que la fenêtre est ouverte : c'est ce qui permet
# de tout arrêter à la fermeture. `open -W` attend la fin de l'instance, et le
# profil dédié garantit qu'il s'agit bien de la nôtre, même si le navigateur
# tourne déjà par ailleurs.
# STUDIO_HEADLESS : tout démarrer sans ouvrir de fenêtre, et rester en vie.
# Le nettoyage reste armé : un Ctrl-C ou un TERM arrête ce qui a été lancé.
# `wait` plutôt qu'un `sleep` de premier plan : bash diffère les signaux tant
# qu'une commande bloquante tourne, et le nettoyage ne partirait jamais.
idle() { while :; do sleep 3600 & wait $!; done; }

if [ -n "${STUDIO_HEADLESS:-}" ]; then
  idle
fi

for browser in "Google Chrome" "Brave Browser" "Microsoft Edge" "Chromium"; do
  if [ -d "/Applications/$browser.app" ]; then
    open -W -na "$browser" --args --app="$URL" \
      --user-data-dir="$PROFILE" \
      --no-first-run --no-default-browser-check &
    wait $!
    cleanup
  fi
done

# Aucun navigateur Chromium : on ouvre dans le navigateur par défaut. Impossible
# alors de détecter la fermeture de l'onglet — l'application reste dans le Dock,
# et c'est en la quittant (⌘Q) que tout s'arrête.
open "$URL"
idle
